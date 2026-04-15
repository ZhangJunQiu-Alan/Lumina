-- ============================================================
-- Lumina IELTS — Database Schema
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New query)
-- ============================================================

-- Core word data (one row per unique word)
CREATE TABLE IF NOT EXISTS vocabulary_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word          TEXT NOT NULL,
  lemma         TEXT,
  ipa_uk        TEXT,
  ipa_us        TEXT,
  primary_meaning_zh TEXT,
  ner_label     TEXT,          -- null for common words; e.g. 'LOCATION' for London
  memory_tip    TEXT,
  source_type   TEXT DEFAULT 'custom',  -- 'system' | 'custom'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(word)
);

-- Per-POS senses (one word → many senses)
CREATE TABLE IF NOT EXISTS vocabulary_senses (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  pos                   TEXT,   -- 'n' | 'v' | 'adj' | 'adv' | 'phr'
  meaning_zh            TEXT,
  usage_note            TEXT,
  example_sentence      TEXT,
  example_translation_zh TEXT
);

-- Confused word pairs
CREATE TABLE IF NOT EXISTS confused_words (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  confused_word         TEXT,
  difference_note_zh    TEXT
);

-- 30-word study groups
CREATE TABLE IF NOT EXISTS learning_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT DEFAULT 'demo',
  group_name    TEXT,
  source_type   TEXT DEFAULT 'custom',
  status        TEXT DEFAULT 'active',   -- 'active' | 'completed'
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

-- Words inside each group (preserves order)
CREATE TABLE IF NOT EXISTS learning_group_words (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_group_id     UUID NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  sequence_no           INTEGER
);

-- SRS review scheduling (one row per user×word)
CREATE TABLE IF NOT EXISTS review_states (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT DEFAULT 'demo',
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  ease_factor           FLOAT DEFAULT 2.5,
  interval_days         INTEGER,
  last_reviewed_at      TIMESTAMPTZ,
  next_review_at        TIMESTAMPTZ,
  review_count          INTEGER DEFAULT 0,
  lapse_count           INTEGER DEFAULT 0,
  memory_state          TEXT NOT NULL DEFAULT 'new',
  last_result           TEXT,
  last_elapsed_ms       INTEGER,
  last_assessed_at      TIMESTAMPTZ,
  graduated_at          TIMESTAMPTZ,
  CHECK (memory_state IN ('new', 'fuzzy', 'slow_recall', 'stable_recall', 'mastered')),
  CHECK (last_result IS NULL OR last_result IN ('wrong', 'slow_correct', 'fast_correct')),
  UNIQUE(user_id, vocabulary_item_id)
);

-- Every assessed attempt, preserved as history for tuning and analytics
CREATE TABLE IF NOT EXISTS review_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT DEFAULT 'demo',
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  learning_group_id     UUID REFERENCES learning_groups(id) ON DELETE SET NULL,
  source                TEXT NOT NULL,
  was_correct           BOOLEAN NOT NULL,
  elapsed_ms            INTEGER NOT NULL,
  previous_state        TEXT,
  next_state            TEXT NOT NULL,
  next_review_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (source IN ('round2', 'review')),
  CHECK (previous_state IS NULL OR previous_state IN ('new', 'fuzzy', 'slow_recall', 'stable_recall', 'mastered')),
  CHECK (next_state IN ('new', 'fuzzy', 'slow_recall', 'stable_recall', 'mastered'))
);

-- AI-generated reading articles (one per learning group)
CREATE TABLE IF NOT EXISTS generated_articles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT DEFAULT 'demo',
  learning_group_id     UUID NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  title                 TEXT,
  content               TEXT,
  target_words_json     JSONB,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (open for demo — tighten when auth is added)
-- ============================================================
ALTER TABLE vocabulary_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_senses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE confused_words         ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_group_words   ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_states          ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_articles     ENABLE ROW LEVEL SECURITY;

-- Allow all access for now (replace with user-scoped policies when auth lands)
CREATE POLICY "public_all" ON vocabulary_items       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON vocabulary_senses      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON confused_words         FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "learning_groups_owner_select" ON learning_groups
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "learning_groups_owner_insert" ON learning_groups
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "learning_groups_owner_update" ON learning_groups
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "learning_groups_owner_delete" ON learning_groups
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "learning_group_words_owner_select" ON learning_group_words
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );
CREATE POLICY "learning_group_words_owner_insert" ON learning_group_words
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );
CREATE POLICY "learning_group_words_owner_update" ON learning_group_words
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );
CREATE POLICY "learning_group_words_owner_delete" ON learning_group_words
  FOR DELETE USING (
    EXISTS (
      SELECT 1
      FROM learning_groups lg
      WHERE lg.id = learning_group_words.learning_group_id
        AND lg.user_id = auth.uid()::text
    )
  );

CREATE POLICY "review_states_owner_select" ON review_states
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "review_states_owner_insert" ON review_states
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_states_owner_update" ON review_states
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_states_owner_delete" ON review_states
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "review_events_owner_select" ON review_events
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "review_events_owner_insert" ON review_events
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_events_owner_update" ON review_events
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "review_events_owner_delete" ON review_events
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "generated_articles_owner_select" ON generated_articles
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "generated_articles_owner_insert" ON generated_articles
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "generated_articles_owner_update" ON generated_articles
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "generated_articles_owner_delete" ON generated_articles
  FOR DELETE USING (auth.uid()::text = user_id);
