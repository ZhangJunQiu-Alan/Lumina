-- ============================================================
-- Lumina — Database Schema
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
  morphology_summary_zh TEXT,
  memory_tip    TEXT,
  source_type   TEXT DEFAULT 'custom',  -- 'system' | 'custom'
  enrichment_level TEXT NOT NULL DEFAULT 'full',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(word),
  CHECK (enrichment_level IN ('lite', 'full'))
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

-- Word forms mapped back to their canonical vocabulary item
CREATE TABLE IF NOT EXISTS vocabulary_item_forms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  form                  TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(form)
);

CREATE INDEX IF NOT EXISTS vocabulary_item_forms_form_idx
  ON vocabulary_item_forms (form);

-- Cached TTS audio for example sentences
CREATE TABLE IF NOT EXISTS example_audio_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentence_hash TEXT NOT NULL,
  sentence_text TEXT NOT NULL,
  locale        TEXT NOT NULL CHECK (locale IN ('uk', 'us')),
  voice_name    TEXT NOT NULL,
  audio_url     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sentence_hash, locale, voice_name)
);

CREATE INDEX IF NOT EXISTS example_audio_cache_lookup_idx
  ON example_audio_cache (sentence_hash, locale, voice_name);

-- Morphology / affix breakdown for memory
CREATE TABLE IF NOT EXISTS vocabulary_morphology_parts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  part_text             TEXT,
  part_kind             TEXT,
  meaning_zh            TEXT,
  note_zh               TEXT,
  sort_order            INTEGER DEFAULT 0,
  CHECK (part_kind IN ('prefix', 'root', 'suffix'))
);

-- Related words grouped by relationship type
CREATE TABLE IF NOT EXISTS vocabulary_relations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  relation_type         TEXT NOT NULL,
  related_word          TEXT,
  meaning_zh            TEXT,
  note_zh               TEXT,
  sort_order            INTEGER DEFAULT 0,
  CHECK (relation_type IN ('derived', 'synonym', 'antonym'))
);

-- Confused word pairs
CREATE TABLE IF NOT EXISTS confused_words (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  confused_word         TEXT,
  difference_note_zh    TEXT,
  sort_order            INTEGER DEFAULT 0
);

-- 30-word study groups
CREATE TABLE IF NOT EXISTS learning_groups (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       TEXT DEFAULT 'demo',
  group_name    TEXT,
  source_type   TEXT DEFAULT 'custom',
  library_id    TEXT,
  status        TEXT DEFAULT 'active',   -- 'active' | 'completed'
  session_round TEXT,                    -- 'round1' | 'round2' | 'round3' | 'article'
  session_current_index INTEGER,
  session_queue_word_ids JSONB,
  session_passed_queue_indices JSONB,
  session_last_active_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  CHECK (session_round IS NULL OR session_round IN ('round1', 'round2', 'round3', 'article'))
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
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(learning_group_id)
);

-- IELTS Academic reading practice content imported from local private PDFs
CREATE TABLE IF NOT EXISTS ielts_reading_books (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_number  INTEGER NOT NULL,
  title        TEXT NOT NULL,
  source_label TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_number)
);

CREATE TABLE IF NOT EXISTS ielts_reading_tests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     UUID NOT NULL REFERENCES ielts_reading_books(id) ON DELETE CASCADE,
  test_number INTEGER NOT NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, test_number),
  CHECK (test_number BETWEEN 1 AND 4)
);

CREATE TABLE IF NOT EXISTS ielts_reading_passages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id        UUID NOT NULL REFERENCES ielts_reading_tests(id) ON DELETE CASCADE,
  passage_number INTEGER NOT NULL,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  word_count     INTEGER NOT NULL DEFAULT 0,
  sort_order     INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id, passage_number),
  CHECK (passage_number BETWEEN 1 AND 3),
  CHECK (word_count >= 0)
);

CREATE TABLE IF NOT EXISTS ielts_reading_passage_figures (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_id    UUID NOT NULL REFERENCES ielts_reading_passages(id) ON DELETE CASCADE,
  figure_key    TEXT NOT NULL,
  title         TEXT NOT NULL,
  caption       TEXT NOT NULL DEFAULT '',
  image_url     TEXT,
  storage_path  TEXT,
  pdf_page      INTEGER,
  crop_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  anchor_text   TEXT,
  fallback_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(passage_id, figure_key),
  CHECK (figure_key <> ''),
  CHECK (title <> ''),
  CHECK (pdf_page IS NULL OR pdf_page > 0)
);

CREATE TABLE IF NOT EXISTS ielts_reading_question_groups (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_id           UUID NOT NULL REFERENCES ielts_reading_passages(id) ON DELETE CASCADE,
  question_type        TEXT NOT NULL,
  prompt               TEXT,
  instructions         TEXT,
  options_json         JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_range_start INTEGER,
  question_range_end   INTEGER,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  CHECK (question_type IN (
    'true_false_not_given',
    'yes_no_not_given',
    'multiple_choice_single',
    'multiple_choice_multi',
    'matching_headings',
    'matching_information',
    'matching_features',
    'matching_sentence_endings',
    'summary_completion',
    'note_completion',
    'table_completion',
    'flow_chart_completion',
    'sentence_completion',
    'short_answer',
    'diagram_label',
    'other'
  )),
  CHECK (
    question_range_start IS NULL
    OR question_range_end IS NULL
    OR question_range_start <= question_range_end
  )
);

CREATE TABLE IF NOT EXISTS ielts_reading_questions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id         UUID NOT NULL REFERENCES ielts_reading_tests(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES ielts_reading_question_groups(id) ON DELETE CASCADE,
  question_number INTEGER NOT NULL,
  prompt          TEXT,
  options_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_json     JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_note     TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id, question_number),
  CHECK (question_number BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS ielts_reading_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  test_id         UUID NOT NULL REFERENCES ielts_reading_tests(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'submitted',
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ,
  elapsed_seconds INTEGER NOT NULL DEFAULT 0,
  score           INTEGER NOT NULL DEFAULT 0,
  total_questions INTEGER NOT NULL DEFAULT 40,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (status IN ('submitted')),
  CHECK (elapsed_seconds >= 0),
  CHECK (score >= 0),
  CHECK (total_questions BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS ielts_reading_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          UUID NOT NULL REFERENCES ielts_reading_attempts(id) ON DELETE CASCADE,
  question_id         UUID NOT NULL REFERENCES ielts_reading_questions(id) ON DELETE CASCADE,
  question_number     INTEGER NOT NULL,
  response_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_correct          BOOLEAN NOT NULL DEFAULT false,
  correct_answer_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS ielts_reading_tests_book_idx
  ON ielts_reading_tests (book_id, test_number);
CREATE INDEX IF NOT EXISTS ielts_reading_passages_test_idx
  ON ielts_reading_passages (test_id, passage_number);
CREATE INDEX IF NOT EXISTS ielts_reading_figures_passage_idx
  ON ielts_reading_passage_figures (passage_id, sort_order);
CREATE INDEX IF NOT EXISTS ielts_reading_groups_passage_idx
  ON ielts_reading_question_groups (passage_id, sort_order);
CREATE INDEX IF NOT EXISTS ielts_reading_questions_test_idx
  ON ielts_reading_questions (test_id, question_number);
CREATE INDEX IF NOT EXISTS ielts_reading_attempts_user_idx
  ON ielts_reading_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ielts_reading_responses_attempt_idx
  ON ielts_reading_responses (attempt_id, question_number);

-- Per-user saved words library, independent from active SRS groups
CREATE TABLE IF NOT EXISTS user_saved_words (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  source                TEXT NOT NULL DEFAULT 'manual',
  saved_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, vocabulary_item_id),
  CHECK (source IN ('import', 'reading_popup', 'manual', 'migration'))
);

CREATE INDEX IF NOT EXISTS user_saved_words_user_idx
  ON user_saved_words (user_id, saved_at DESC);

-- Consumed streak protection cards, tracked per natural day
CREATE TABLE IF NOT EXISTS streak_protection_events (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT DEFAULT 'demo',
  protected_date        DATE NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, protected_date)
);

-- Per-user daily routine progress for the home flow card
CREATE TABLE IF NOT EXISTS daily_routine_progress (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT DEFAULT 'demo',
  local_date            DATE NOT NULL,
  timezone              TEXT NOT NULL DEFAULT 'UTC',
  day_kind              TEXT NOT NULL,
  starting_due_count    INTEGER NOT NULL DEFAULT 0,
  main_learning_group_id UUID REFERENCES learning_groups(id) ON DELETE SET NULL,
  step_order_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_steps_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  status                TEXT NOT NULL DEFAULT 'not_started',
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  CHECK (day_kind IN ('review_day', 'learning_day')),
  CHECK (status IN ('not_started', 'in_progress', 'completed')),
  UNIQUE(user_id, local_date)
);

-- Per-user learning preferences
CREATE TABLE IF NOT EXISTS user_settings (
  user_id                        TEXT PRIMARY KEY,
  default_pronunciation_locale   TEXT NOT NULL DEFAULT 'uk',
  speech_playback_rate           NUMERIC(2,1) NOT NULL DEFAULT 1.0,
  auto_play_enabled              BOOLEAN NOT NULL DEFAULT true,
  auto_play_repeat_count         INTEGER NOT NULL DEFAULT 3,
  auto_play_repeat_gap_ms        INTEGER NOT NULL DEFAULT 1500,
  correct_answer_reveal_ms       INTEGER NOT NULL DEFAULT 1000,
  wrong_answer_reveal_ms         INTEGER NOT NULL DEFAULT 8000,
  reinforcement_round3_enabled   BOOLEAN NOT NULL DEFAULT true,
  reinforcement_article_enabled  BOOLEAN NOT NULL DEFAULT true,
  popover_auto_play_enabled      BOOLEAN NOT NULL DEFAULT false,
  cloze_sentence_auto_play_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at                     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (default_pronunciation_locale IN ('uk', 'us')),
  CHECK (speech_playback_rate IN (0.6, 0.8, 1.0)),
  CHECK (auto_play_repeat_count IN (1, 2, 3)),
  CHECK (auto_play_repeat_gap_ms IN (1000, 1500, 2500)),
  CHECK (correct_answer_reveal_ms IN (800, 1000, 1500, 2000)),
  CHECK (wrong_answer_reveal_ms IN (3000, 5000, 8000))
);

-- ============================================================
-- Row Level Security (open for demo — tighten when auth is added)
-- ============================================================
ALTER TABLE vocabulary_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_senses      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_item_forms  ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_morphology_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_relations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE confused_words         ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_group_words   ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_states          ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_articles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_books    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_tests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_passage_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_words       ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_protection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_routine_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings          ENABLE ROW LEVEL SECURITY;

-- Allow all access for now (replace with user-scoped policies when auth lands)
CREATE POLICY "public_all" ON vocabulary_items       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON vocabulary_senses      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON vocabulary_item_forms  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON vocabulary_morphology_parts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public_all" ON vocabulary_relations   FOR ALL USING (true) WITH CHECK (true);
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

CREATE POLICY "ielts_reading_books_authenticated_select" ON ielts_reading_books
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ielts_reading_tests_authenticated_select" ON ielts_reading_tests
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ielts_reading_passages_authenticated_select" ON ielts_reading_passages
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ielts_reading_figures_authenticated_select" ON ielts_reading_passage_figures
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ielts_reading_question_groups_authenticated_select" ON ielts_reading_question_groups
  FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "ielts_reading_questions_authenticated_select" ON ielts_reading_questions
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "ielts_reading_attempts_owner_select" ON ielts_reading_attempts
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "ielts_reading_attempts_owner_insert" ON ielts_reading_attempts
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "ielts_reading_responses_owner_select" ON ielts_reading_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM ielts_reading_attempts attempts
      WHERE attempts.id = ielts_reading_responses.attempt_id
        AND attempts.user_id = auth.uid()::text
    )
  );
CREATE POLICY "ielts_reading_responses_owner_insert" ON ielts_reading_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ielts_reading_attempts attempts
      WHERE attempts.id = ielts_reading_responses.attempt_id
        AND attempts.user_id = auth.uid()::text
    )
  );

CREATE POLICY "ielts_reading_figure_objects_authenticated_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'ielts-reading-figures'
    AND auth.uid() IS NOT NULL
  );

CREATE POLICY "user_saved_words_owner_select" ON user_saved_words
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "user_saved_words_owner_insert" ON user_saved_words
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_saved_words_owner_update" ON user_saved_words
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_saved_words_owner_delete" ON user_saved_words
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "streak_protection_events_owner_select" ON streak_protection_events
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "streak_protection_events_owner_insert" ON streak_protection_events
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "streak_protection_events_owner_update" ON streak_protection_events
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "streak_protection_events_owner_delete" ON streak_protection_events
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "daily_routine_progress_owner_select" ON daily_routine_progress
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "daily_routine_progress_owner_insert" ON daily_routine_progress
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_routine_progress_owner_update" ON daily_routine_progress
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_routine_progress_owner_delete" ON daily_routine_progress
  FOR DELETE USING (auth.uid()::text = user_id);

CREATE POLICY "user_settings_owner_select" ON user_settings
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "user_settings_owner_insert" ON user_settings
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_settings_owner_update" ON user_settings
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_settings_owner_delete" ON user_settings
  FOR DELETE USING (auth.uid()::text = user_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vocabulary_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vocabulary_items;
  END IF;
END $$;
