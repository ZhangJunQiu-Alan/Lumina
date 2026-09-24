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
  audio_uk_url  TEXT,
  audio_us_url  TEXT,
  round2_choice_distractors JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_type   TEXT DEFAULT 'custom',  -- 'system' | 'custom'
  enrichment_level TEXT NOT NULL DEFAULT 'full',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(word),
  CHECK (enrichment_level IN ('lite', 'full')),
  CHECK (jsonb_typeof(round2_choice_distractors) = 'array')
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

-- Click-to-lookup misses waiting for later vocabulary enrichment
CREATE TABLE IF NOT EXISTS vocabulary_lookup_misses (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word                        TEXT NOT NULL,
  source                      TEXT NOT NULL DEFAULT 'reading_popup',
  status                      TEXT NOT NULL DEFAULT 'pending',
  first_requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_requested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count               INTEGER NOT NULL DEFAULT 1,
  last_user_id                TEXT,
  inserted_vocabulary_item_id UUID REFERENCES vocabulary_items(id) ON DELETE SET NULL,
  note                        TEXT,
  UNIQUE(word),
  CHECK (word <> ''),
  CHECK (source IN ('reading_popup', 'manual', 'import', 'api')),
  CHECK (status IN ('pending', 'processing', 'inserted', 'ignored')),
  CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS vocabulary_lookup_misses_status_idx
  ON vocabulary_lookup_misses (status, last_requested_at DESC);

CREATE INDEX IF NOT EXISTS vocabulary_lookup_misses_last_requested_idx
  ON vocabulary_lookup_misses (last_requested_at DESC);

CREATE OR REPLACE FUNCTION record_vocabulary_lookup_miss(
  p_word TEXT,
  p_user_id TEXT,
  p_source TEXT DEFAULT 'reading_popup'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_word TEXT := LOWER(TRIM(REGEXP_REPLACE(COALESCE(p_word, ''), '\s+', ' ', 'g')));
  normalized_source TEXT := COALESCE(NULLIF(TRIM(p_source), ''), 'reading_popup');
BEGIN
  IF normalized_word = '' THEN
    RETURN;
  END IF;

  IF normalized_source NOT IN ('reading_popup', 'manual', 'import', 'api') THEN
    normalized_source := 'reading_popup';
  END IF;

  INSERT INTO vocabulary_lookup_misses (
    word,
    source,
    last_user_id
  )
  VALUES (
    normalized_word,
    normalized_source,
    p_user_id
  )
  ON CONFLICT (word) DO UPDATE
  SET
    source = EXCLUDED.source,
    last_user_id = EXCLUDED.last_user_id,
    last_requested_at = NOW(),
    request_count = vocabulary_lookup_misses.request_count + 1,
    status = CASE
      WHEN vocabulary_lookup_misses.status = 'inserted' THEN vocabulary_lookup_misses.status
      ELSE 'pending'
    END;
END;
$$;

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

-- Study groups
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
  session_round1_confirmed_word_ids JSONB,
  session_last_active_at TIMESTAMPTZ,
  word_count    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  CHECK (session_round IS NULL OR session_round IN ('round1', 'round2', 'round3', 'article'))
);

-- Words inside each group (preserves order)
CREATE TABLE IF NOT EXISTS learning_group_words (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  learning_group_id     UUID NOT NULL REFERENCES learning_groups(id) ON DELETE CASCADE,
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  sequence_no           INTEGER,
  round1_confirmed_at   TIMESTAMPTZ,
  round2_completed_at   TIMESTAMPTZ,
  round3_completed_at   TIMESTAMPTZ,
  learned_at            TIMESTAMPTZ,
  round2_required       BOOLEAN NOT NULL DEFAULT TRUE,
  round3_required       BOOLEAN NOT NULL DEFAULT TRUE
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
  CHECK (source IN ('round2', 'round3', 'review', 'manual_mastered')),
  CHECK (previous_state IS NULL OR previous_state IN ('new', 'fuzzy', 'slow_recall', 'stable_recall', 'mastered')),
  CHECK (next_state IN ('new', 'fuzzy', 'slow_recall', 'stable_recall', 'mastered'))
);

CREATE TABLE IF NOT EXISTS vocabulary_issue_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  vocabulary_item_id UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  word_snapshot      TEXT,
  learning_group_id  UUID REFERENCES learning_groups(id) ON DELETE SET NULL,
  session_round      TEXT,
  issue_type         TEXT NOT NULL,
  note               TEXT,
  route_path         TEXT,
  user_agent         TEXT,
  status             TEXT NOT NULL DEFAULT 'open',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (issue_type IN ('definition', 'example', 'pronunciation', 'other')),
  CHECK (status IN ('open', 'reviewing', 'resolved', 'ignored')),
  CHECK (session_round IS NULL OR session_round IN ('review', 'round1', 'round2', 'round3', 'article'))
);

CREATE INDEX IF NOT EXISTS vocabulary_issue_reports_status_idx
  ON vocabulary_issue_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS vocabulary_issue_reports_user_idx
  ON vocabulary_issue_reports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vocabulary_issue_reports_vocabulary_item_idx
  ON vocabulary_issue_reports (vocabulary_item_id, created_at DESC);

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

-- IELTS Listening practice content imported from local private PDFs/audio
CREATE TABLE IF NOT EXISTS ielts_listening_books (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_number  INTEGER NOT NULL,
  title        TEXT NOT NULL,
  source_label TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_number)
);

CREATE TABLE IF NOT EXISTS ielts_listening_tests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id     UUID NOT NULL REFERENCES ielts_listening_books(id) ON DELETE CASCADE,
  test_number INTEGER NOT NULL,
  title       TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(book_id, test_number),
  CHECK (test_number BETWEEN 1 AND 4)
);

CREATE TABLE IF NOT EXISTS ielts_listening_sections (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id               UUID NOT NULL REFERENCES ielts_listening_tests(id) ON DELETE CASCADE,
  section_number        INTEGER NOT NULL,
  title                 TEXT NOT NULL,
  instructions          TEXT NOT NULL DEFAULT '',
  audio_url             TEXT,
  audio_storage_path    TEXT,
  source_audio_filename TEXT,
  paper_pages_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id, section_number),
  CHECK (section_number BETWEEN 1 AND 4)
);

CREATE TABLE IF NOT EXISTS ielts_listening_question_groups (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id           UUID NOT NULL REFERENCES ielts_listening_sections(id) ON DELETE CASCADE,
  question_type        TEXT NOT NULL,
  prompt               TEXT,
  instructions         TEXT,
  options_json         JSONB NOT NULL DEFAULT '[]'::jsonb,
  question_range_start INTEGER,
  question_range_end   INTEGER,
  sort_order           INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  CHECK (question_type IN (
    'form_completion',
    'note_completion',
    'table_completion',
    'sentence_completion',
    'multiple_choice_single',
    'matching',
    'diagram_label',
    'other'
  )),
  CHECK (
    question_range_start IS NULL
    OR question_range_end IS NULL
    OR question_range_start <= question_range_end
  )
);

CREATE TABLE IF NOT EXISTS ielts_listening_questions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id            UUID NOT NULL REFERENCES ielts_listening_tests(id) ON DELETE CASCADE,
  section_id         UUID NOT NULL REFERENCES ielts_listening_sections(id) ON DELETE CASCADE,
  group_id           UUID NOT NULL REFERENCES ielts_listening_question_groups(id) ON DELETE CASCADE,
  question_number    INTEGER NOT NULL,
  prompt             TEXT,
  options_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_json        JSONB NOT NULL DEFAULT '[]'::jsonb,
  answer_note        TEXT,
  paper_hotspot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(test_id, question_number),
  CHECK (question_number BETWEEN 1 AND 40)
);

CREATE TABLE IF NOT EXISTS ielts_listening_attempts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         TEXT NOT NULL,
  test_id         UUID NOT NULL REFERENCES ielts_listening_tests(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS ielts_listening_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id          UUID NOT NULL REFERENCES ielts_listening_attempts(id) ON DELETE CASCADE,
  question_id         UUID NOT NULL REFERENCES ielts_listening_questions(id) ON DELETE CASCADE,
  question_number     INTEGER NOT NULL,
  response_json       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_correct          BOOLEAN NOT NULL DEFAULT false,
  correct_answer_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(attempt_id, question_id)
);

CREATE INDEX IF NOT EXISTS ielts_listening_tests_book_idx
  ON ielts_listening_tests (book_id, test_number);
CREATE INDEX IF NOT EXISTS ielts_listening_sections_test_idx
  ON ielts_listening_sections (test_id, section_number);
CREATE INDEX IF NOT EXISTS ielts_listening_groups_section_idx
  ON ielts_listening_question_groups (section_id, sort_order);
CREATE INDEX IF NOT EXISTS ielts_listening_questions_test_idx
  ON ielts_listening_questions (test_id, question_number);
CREATE INDEX IF NOT EXISTS ielts_listening_attempts_user_idx
  ON ielts_listening_attempts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ielts_listening_responses_attempt_idx
  ON ielts_listening_responses (attempt_id, question_number);

CREATE OR REPLACE FUNCTION public.persist_vocabulary_entries(
  p_entries JSONB,
  p_source_type TEXT DEFAULT 'custom'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  v_item_id UUID;
  v_word TEXT;
  v_source_type TEXT := CASE WHEN p_source_type = 'system' THEN 'system' ELSE 'custom' END;
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_entries) AS entries(value)
    WHERE jsonb_typeof(entries.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_entries must contain only JSON objects';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_word := lower(trim(regexp_replace(coalesce(entry->>'word', ''), '\s+', ' ', 'g')));

    IF v_word = '' THEN
      RAISE EXCEPTION 'Vocabulary entry word is required';
    END IF;

    INSERT INTO public.vocabulary_items (
      word,
      ipa_uk,
      ipa_us,
      primary_meaning_zh,
      ner_label,
      morphology_summary_zh,
      memory_tip,
      source_type,
      enrichment_level
    )
    VALUES (
      v_word,
      entry->>'ipa_uk',
      entry->>'ipa_us',
      entry->>'primary_meaning_zh',
      entry->>'ner_label',
      entry #>> '{morphology,summary_zh}',
      entry->>'memory_tip',
      v_source_type,
      'full'
    )
    ON CONFLICT (word) DO UPDATE
    SET
      ipa_uk = EXCLUDED.ipa_uk,
      ipa_us = EXCLUDED.ipa_us,
      primary_meaning_zh = EXCLUDED.primary_meaning_zh,
      ner_label = EXCLUDED.ner_label,
      morphology_summary_zh = EXCLUDED.morphology_summary_zh,
      memory_tip = EXCLUDED.memory_tip,
      source_type = COALESCE(public.vocabulary_items.source_type, EXCLUDED.source_type),
      enrichment_level = 'full'
    RETURNING id INTO v_item_id;

    DELETE FROM public.vocabulary_senses
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.vocabulary_senses (
      vocabulary_item_id,
      pos,
      meaning_zh,
      usage_note,
      example_sentence,
      example_translation_zh
    )
    SELECT
      v_item_id,
      NULLIF(trim(sense.value->>'pos'), ''),
      NULLIF(trim(sense.value->>'meaning_zh'), ''),
      NULLIF(trim(sense.value->>'usage_note'), ''),
      NULLIF(trim(sense.value->>'example_sentence'), ''),
      NULLIF(trim(sense.value->>'example_translation_zh'), '')
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry->'senses') = 'array' THEN entry->'senses' ELSE '[]'::jsonb END
    ) AS sense(value);

    DELETE FROM public.vocabulary_morphology_parts
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.vocabulary_morphology_parts (
      vocabulary_item_id,
      part_text,
      part_kind,
      meaning_zh,
      note_zh,
      sort_order
    )
    SELECT
      v_item_id,
      NULLIF(trim(part.value->>'text'), ''),
      NULLIF(trim(part.value->>'kind'), ''),
      NULLIF(trim(part.value->>'meaning_zh'), ''),
      NULLIF(trim(part.value->>'note_zh'), ''),
      part.ordinality::INTEGER - 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry #> '{morphology,parts}') = 'array' THEN entry #> '{morphology,parts}' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS part(value, ordinality);

    DELETE FROM public.vocabulary_relations
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.vocabulary_relations (
      vocabulary_item_id,
      relation_type,
      related_word,
      meaning_zh,
      note_zh,
      sort_order
    )
    SELECT
      v_item_id,
      relation_type,
      NULLIF(trim(relation.value->>'word'), ''),
      NULLIF(trim(relation.value->>'meaning_zh'), ''),
      NULLIF(trim(relation.value->>'note_zh'), ''),
      relation.ordinality::INTEGER - 1
    FROM (
      SELECT 'derived'::TEXT AS relation_type, value, ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(entry->'derived_words') = 'array' THEN entry->'derived_words' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
      UNION ALL
      SELECT 'synonym'::TEXT AS relation_type, value, ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(entry->'synonyms') = 'array' THEN entry->'synonyms' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
      UNION ALL
      SELECT 'antonym'::TEXT AS relation_type, value, ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(entry->'antonyms') = 'array' THEN entry->'antonyms' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
    ) AS relation;

    DELETE FROM public.confused_words
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.confused_words (
      vocabulary_item_id,
      confused_word,
      difference_note_zh,
      sort_order
    )
    SELECT
      v_item_id,
      NULLIF(trim(confusion.value->>'word'), ''),
      NULLIF(trim(confusion.value->>'difference_zh'), ''),
      confusion.ordinality::INTEGER - 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry->'confusions') = 'array' THEN entry->'confusions' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS confusion(value, ordinality);

    INSERT INTO public.vocabulary_item_forms (
      vocabulary_item_id,
      form
    )
    SELECT DISTINCT
      v_item_id,
      lower(trim(regexp_replace(form.value #>> '{}', '\s+', ' ', 'g'))) AS form
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry->'forms') = 'array' THEN entry->'forms' ELSE '[]'::jsonb END
    ) AS form(value)
    WHERE lower(trim(regexp_replace(form.value #>> '{}', '\s+', ' ', 'g'))) <> ''
      AND lower(trim(regexp_replace(form.value #>> '{}', '\s+', ' ', 'g'))) <> v_word
    ON CONFLICT (form) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_vocabulary_entries(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_vocabulary_entries(JSONB, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_ielts_reading_attempt(
  p_user_id TEXT,
  p_test_id UUID,
  p_started_at TIMESTAMPTZ,
  p_submitted_at TIMESTAMPTZ,
  p_elapsed_seconds INTEGER,
  p_score INTEGER,
  p_total_questions INTEGER,
  p_responses JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
BEGIN
  IF nullif(trim(coalesce(p_user_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'p_responses must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_responses) AS responses(value)
    WHERE jsonb_typeof(responses.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_responses must contain only JSON objects';
  END IF;

  INSERT INTO public.ielts_reading_attempts (
    user_id,
    test_id,
    status,
    started_at,
    submitted_at,
    elapsed_seconds,
    score,
    total_questions
  )
  VALUES (
    p_user_id,
    p_test_id,
    'submitted',
    p_started_at,
    p_submitted_at,
    p_elapsed_seconds,
    p_score,
    p_total_questions
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.ielts_reading_responses (
    attempt_id,
    question_id,
    question_number,
    response_json,
    is_correct,
    correct_answer_json
  )
  SELECT
    v_attempt_id,
    (response.value->>'questionId')::UUID,
    (response.value->>'questionNumber')::INTEGER,
    COALESCE(response.value->'response', '[]'::jsonb),
    COALESCE((response.value->>'isCorrect')::BOOLEAN, false),
    COALESCE(response.value->'correctAnswer', '[]'::jsonb)
  FROM jsonb_array_elements(p_responses) AS response(value);

  RETURN v_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_ielts_reading_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_ielts_reading_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_ielts_listening_attempt(
  p_user_id TEXT,
  p_test_id UUID,
  p_started_at TIMESTAMPTZ,
  p_submitted_at TIMESTAMPTZ,
  p_elapsed_seconds INTEGER,
  p_score INTEGER,
  p_total_questions INTEGER,
  p_responses JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
BEGIN
  IF nullif(trim(coalesce(p_user_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'p_responses must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_responses) AS responses(value)
    WHERE jsonb_typeof(responses.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_responses must contain only JSON objects';
  END IF;

  INSERT INTO public.ielts_listening_attempts (
    user_id,
    test_id,
    status,
    started_at,
    submitted_at,
    elapsed_seconds,
    score,
    total_questions
  )
  VALUES (
    p_user_id,
    p_test_id,
    'submitted',
    p_started_at,
    p_submitted_at,
    p_elapsed_seconds,
    p_score,
    p_total_questions
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.ielts_listening_responses (
    attempt_id,
    question_id,
    question_number,
    response_json,
    is_correct,
    correct_answer_json
  )
  SELECT
    v_attempt_id,
    (response.value->>'questionId')::UUID,
    (response.value->>'questionNumber')::INTEGER,
    COALESCE(response.value->'response', '[]'::jsonb),
    COALESCE((response.value->>'isCorrect')::BOOLEAN, false),
    COALESCE(response.value->'correctAnswer', '[]'::jsonb)
  FROM jsonb_array_elements(p_responses) AS response(value);

  RETURN v_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_ielts_listening_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_ielts_listening_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.create_learning_group_exclusive(
  p_user_id TEXT,
  p_group_name TEXT,
  p_source_type TEXT DEFAULT 'custom',
  p_library_id TEXT DEFAULT NULL,
  p_vocabulary_item_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_user_id TEXT := (SELECT auth.uid())::TEXT;
  v_request_role TEXT := COALESCE((SELECT auth.role()), '');
  v_user_id TEXT := NULLIF(BTRIM(COALESCE(p_user_id, '')), '');
  v_source_type TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_source_type, '')), ''), 'custom');
  v_library_id TEXT := NULLIF(BTRIM(COALESCE(p_library_id, '')), '');
  v_group_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF v_request_role <> 'service_role' AND v_request_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'authenticated user does not match p_user_id';
  END IF;

  IF v_source_type NOT IN ('custom', 'system') THEN
    RAISE EXCEPTION 'p_source_type must be custom or system';
  END IF;

  IF v_source_type = 'system' AND v_library_id IS NULL THEN
    RAISE EXCEPTION 'p_library_id is required for system learning groups';
  END IF;

  IF v_source_type = 'custom' THEN
    v_library_id := NULL;
  END IF;

  IF COALESCE(cardinality(p_vocabulary_item_ids), 0) = 0 THEN
    RAISE EXCEPTION 'p_vocabulary_item_ids must not be empty';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
    WHERE item.vocabulary_item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'p_vocabulary_item_ids must not contain nulls';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
  ) <> (
    SELECT COUNT(DISTINCT item.vocabulary_item_id)
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
  ) THEN
    RAISE EXCEPTION 'p_vocabulary_item_ids must not contain duplicates';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id)::BIGINT);

  INSERT INTO public.learning_groups (
    user_id,
    group_name,
    source_type,
    library_id,
    word_count
  )
  VALUES (
    v_user_id,
    NULLIF(BTRIM(COALESCE(p_group_name, '')), ''),
    v_source_type,
    v_library_id,
    COALESCE(cardinality(p_vocabulary_item_ids), 0)
  )
  RETURNING id INTO v_group_id;

  INSERT INTO public.learning_group_words (
    learning_group_id,
    vocabulary_item_id,
    sequence_no
  )
  SELECT
    v_group_id,
    item.vocabulary_item_id,
    item.ordinality::INTEGER - 1
  FROM unnest(p_vocabulary_item_ids) WITH ORDINALITY AS item(vocabulary_item_id, ordinality);

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_learning_group_word_progress(
  p_learning_group_id UUID,
  p_vocabulary_item_ids UUID[],
  p_round TEXT,
  p_round2_required BOOLEAN DEFAULT TRUE,
  p_round3_required BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT := auth.uid()::TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_next_review_at TIMESTAMPTZ := v_now + INTERVAL '1 day';
  v_expected_count INTEGER;
  v_updated_count INTEGER;
  v_learned_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_round NOT IN ('round1', 'round2', 'round3') THEN
    RAISE EXCEPTION 'Invalid learning round: %', p_round;
  END IF;

  SELECT COUNT(DISTINCT item.vocabulary_item_id)
  INTO v_expected_count
  FROM unnest(COALESCE(p_vocabulary_item_ids, ARRAY[]::UUID[])) AS item(vocabulary_item_id)
  WHERE item.vocabulary_item_id IS NOT NULL;

  IF v_expected_count = 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.learning_groups AS lg
    WHERE lg.id = p_learning_group_id
      AND lg.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Learning group not found';
  END IF;

  WITH input_ids AS (
    SELECT DISTINCT item.vocabulary_item_id
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
    WHERE item.vocabulary_item_id IS NOT NULL
  ),
  updated AS (
    UPDATE public.learning_group_words AS lgw
    SET
      round1_confirmed_at = CASE
        WHEN p_round = 'round1' THEN COALESCE(lgw.round1_confirmed_at, v_now)
        ELSE lgw.round1_confirmed_at
      END,
      round2_completed_at = CASE
        WHEN p_round = 'round2' THEN COALESCE(lgw.round2_completed_at, v_now)
        ELSE lgw.round2_completed_at
      END,
      round3_completed_at = CASE
        WHEN p_round = 'round3' THEN COALESCE(lgw.round3_completed_at, v_now)
        ELSE lgw.round3_completed_at
      END,
      round2_required = CASE
        WHEN p_round = 'round1' THEN p_round2_required
        ELSE lgw.round2_required
      END,
      round3_required = CASE
        WHEN p_round = 'round1' THEN p_round3_required
        ELSE lgw.round3_required
      END
    FROM input_ids
    WHERE lgw.learning_group_id = p_learning_group_id
      AND lgw.vocabulary_item_id = input_ids.vocabulary_item_id
    RETURNING lgw.vocabulary_item_id
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  IF v_updated_count <> v_expected_count THEN
    RAISE EXCEPTION 'Some vocabulary items do not belong to this learning group';
  END IF;

  WITH input_ids AS (
    SELECT DISTINCT item.vocabulary_item_id
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
    WHERE item.vocabulary_item_id IS NOT NULL
  ),
  learned AS (
    UPDATE public.learning_group_words AS lgw
    SET learned_at = COALESCE(lgw.learned_at, v_now)
    FROM input_ids
    WHERE lgw.learning_group_id = p_learning_group_id
      AND lgw.vocabulary_item_id = input_ids.vocabulary_item_id
      AND lgw.round1_confirmed_at IS NOT NULL
      AND (lgw.round2_required = FALSE OR lgw.round2_completed_at IS NOT NULL)
      AND (lgw.round3_required = FALSE OR lgw.round3_completed_at IS NOT NULL)
    RETURNING lgw.vocabulary_item_id
  ),
  activated_existing AS (
    UPDATE public.review_states AS rs
    SET
      memory_state = 'fuzzy',
      interval_days = 1,
      next_review_at = v_next_review_at,
      last_reviewed_at = COALESCE(rs.last_reviewed_at, v_now),
      graduated_at = NULL
    FROM learned
    WHERE rs.user_id = v_user_id
      AND rs.vocabulary_item_id = learned.vocabulary_item_id
      AND rs.memory_state = 'new'
      AND rs.next_review_at IS NULL
    RETURNING rs.vocabulary_item_id
  ),
  inserted AS (
    INSERT INTO public.review_states (
      user_id,
      vocabulary_item_id,
      memory_state,
      interval_days,
      next_review_at,
      last_reviewed_at,
      graduated_at
    )
    SELECT
      v_user_id,
      learned.vocabulary_item_id,
      'fuzzy',
      1,
      v_next_review_at,
      v_now,
      NULL
    FROM learned
    ON CONFLICT (user_id, vocabulary_item_id) DO NOTHING
    RETURNING vocabulary_item_id
  )
  SELECT COUNT(*) INTO v_learned_count FROM learned;

  RETURN COALESCE(v_learned_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_learning_group_word_progress(UUID, UUID[], TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_learning_group_word_progress(UUID, UUID[], TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_learning_group_word_progress(UUID, UUID[], TEXT, BOOLEAN, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.learning_group_library_key(
  p_source_type TEXT,
  p_library_id TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_source_type = 'system'
      THEN 'official:' || COALESCE(NULLIF(BTRIM(COALESCE(p_library_id, '')), ''), '__legacy__')
    ELSE 'custom'
  END;
$$;

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

-- Per-user daily aggregated statistics for fast home overview and activity heatmap
CREATE TABLE IF NOT EXISTS daily_user_statistics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  date_key              DATE NOT NULL,
  review_word_count     INTEGER NOT NULL DEFAULT 0,
  learned_word_count    INTEGER NOT NULL DEFAULT 0,
  attempt_count         INTEGER NOT NULL DEFAULT 0,
  correct_count         INTEGER NOT NULL DEFAULT 0,
  is_routine_finished   BOOLEAN NOT NULL DEFAULT false,
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_stats_lookup
  ON daily_user_statistics (user_id, date_key DESC);

-- Per-user learning preferences
CREATE TABLE IF NOT EXISTS user_settings (
  user_id                        TEXT PRIMARY KEY,
  default_pronunciation_locale   TEXT NOT NULL DEFAULT 'uk',
  ielts_target_score             NUMERIC(2,1) NOT NULL DEFAULT 7.0,
  speech_playback_rate           NUMERIC(2,1) NOT NULL DEFAULT 1.0,
  auto_play_enabled              BOOLEAN NOT NULL DEFAULT true,
  auto_play_repeat_count         INTEGER NOT NULL DEFAULT 3,
  auto_play_repeat_gap_ms        INTEGER NOT NULL DEFAULT 1500,
  correct_answer_reveal_ms       INTEGER NOT NULL DEFAULT 1000,
  wrong_answer_reveal_ms         INTEGER NOT NULL DEFAULT 8000,
  round2_enabled                 BOOLEAN NOT NULL DEFAULT true,
  reinforcement_round3_enabled   BOOLEAN NOT NULL DEFAULT true,
  reinforcement_article_enabled  BOOLEAN NOT NULL DEFAULT true,
  popover_auto_play_enabled      BOOLEAN NOT NULL DEFAULT false,
  cloze_sentence_auto_play_enabled BOOLEAN NOT NULL DEFAULT true,
  memory_tip_enabled             BOOLEAN NOT NULL DEFAULT true,
  updated_at                     TIMESTAMPTZ DEFAULT NOW(),
  CHECK (default_pronunciation_locale IN ('uk', 'us')),
  CHECK (ielts_target_score IN (5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0)),
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
ALTER TABLE vocabulary_lookup_misses ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_morphology_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_relations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE confused_words         ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_group_words   ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_states          ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_issue_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE generated_articles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_books    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_tests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_passage_figures ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_reading_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_books ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_saved_words       ENABLE ROW LEVEL SECURITY;
ALTER TABLE streak_protection_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_routine_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_user_statistics ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_settings          ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vocabulary_items_authenticated_select" ON vocabulary_items
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "vocabulary_senses_authenticated_select" ON vocabulary_senses
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "vocabulary_item_forms_authenticated_select" ON vocabulary_item_forms
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "vocabulary_morphology_parts_authenticated_select" ON vocabulary_morphology_parts
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "vocabulary_relations_authenticated_select" ON vocabulary_relations
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "confused_words_authenticated_select" ON confused_words
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

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

CREATE POLICY "vocabulary_issue_reports_owner_select" ON vocabulary_issue_reports
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "vocabulary_issue_reports_owner_insert" ON vocabulary_issue_reports
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "vocabulary_issue_reports_owner_update" ON vocabulary_issue_reports
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "vocabulary_issue_reports_owner_delete" ON vocabulary_issue_reports
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

CREATE POLICY "ielts_listening_books_authenticated_select" ON ielts_listening_books
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ielts_listening_tests_authenticated_select" ON ielts_listening_tests
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ielts_listening_sections_authenticated_select" ON ielts_listening_sections
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ielts_listening_groups_authenticated_select" ON ielts_listening_question_groups
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);
CREATE POLICY "ielts_listening_questions_authenticated_select" ON ielts_listening_questions
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE POLICY "ielts_listening_attempts_owner_select" ON ielts_listening_attempts
  FOR SELECT USING ((SELECT auth.uid())::text = user_id);
CREATE POLICY "ielts_listening_attempts_owner_insert" ON ielts_listening_attempts
  FOR INSERT WITH CHECK ((SELECT auth.uid())::text = user_id);

CREATE POLICY "ielts_listening_responses_owner_select" ON ielts_listening_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM ielts_listening_attempts attempts
      WHERE attempts.id = ielts_listening_responses.attempt_id
        AND attempts.user_id = (SELECT auth.uid())::text
    )
  );
CREATE POLICY "ielts_listening_responses_owner_insert" ON ielts_listening_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ielts_listening_attempts attempts
      WHERE attempts.id = ielts_listening_responses.attempt_id
        AND attempts.user_id = (SELECT auth.uid())::text
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

CREATE POLICY "daily_user_statistics_owner_select" ON daily_user_statistics
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "daily_user_statistics_owner_insert" ON daily_user_statistics
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_user_statistics_owner_update" ON daily_user_statistics
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_user_statistics_owner_delete" ON daily_user_statistics
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

-- 1. record_review_attempt_atomic
CREATE OR REPLACE FUNCTION public.record_review_attempt_atomic(
  p_user_id TEXT,
  p_vocabulary_item_id UUID,
  p_learning_group_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'review',
  p_was_correct BOOLEAN DEFAULT FALSE,
  p_elapsed_ms INTEGER DEFAULT 0,
  p_next_state TEXT DEFAULT 'fuzzy',
  p_next_review_at TIMESTAMPTZ DEFAULT NULL,
  p_should_increment_review_counters BOOLEAN DEFAULT TRUE,
  p_result TEXT DEFAULT 'wrong',
  p_ease_factor REAL DEFAULT 2.5,
  p_interval_days INTEGER DEFAULT 1,
  p_routine_date DATE DEFAULT CURRENT_DATE,
  p_assessed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_state TEXT;
  v_review_count INTEGER;
  v_lapse_count INTEGER;
  v_last_assessed_at TIMESTAMPTZ;
  v_existing_next_review_at TIMESTAMPTZ;
  v_graduated_at TIMESTAMPTZ;
  v_new_review_count INTEGER;
  v_new_lapse_count INTEGER;
  v_new_last_reviewed_at TIMESTAMPTZ;
  v_new_graduated_at TIMESTAMPTZ;
  v_is_graduated BOOLEAN;
  v_new_event_id UUID := gen_random_uuid();
  v_event_prev TEXT;
  v_event_next TEXT;
  v_event_source TEXT;
  v_event_correct BOOLEAN;
  v_event_elapsed INTEGER;
  v_event_next_review TIMESTAMPTZ;
BEGIN
  -- Security check: when called by an authenticated user, prevent impersonation
  IF auth.uid() IS NOT NULL AND auth.uid()::TEXT <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user ID mismatch';
  END IF;

  -- Acquire user-level transaction advisory lock to serialize attempts for this user
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id)::BIGINT);

  SELECT
    memory_state,
    review_count,
    lapse_count,
    last_assessed_at,
    next_review_at,
    graduated_at
  INTO
    v_current_state,
    v_review_count,
    v_lapse_count,
    v_last_assessed_at,
    v_existing_next_review_at,
    v_graduated_at
  FROM public.review_states
  WHERE user_id = p_user_id AND vocabulary_item_id = p_vocabulary_item_id;

  -- Stale attempt guard: database already has a strictly newer assessment
  IF v_last_assessed_at IS NOT NULL AND v_last_assessed_at > p_assessed_at THEN
    RETURN jsonb_build_object(
      'success', true,
      'ignored', true,
      'memory_state', v_current_state,
      'next_review_at', v_existing_next_review_at,
      'graduated', false,
      'transition', jsonb_build_object(
        'from', v_current_state,
        'to', v_current_state,
        'source', p_source,
        'result', p_result,
        'graduated', false,
        'nextReviewAt', v_existing_next_review_at
      )
    );
  END IF;

  -- Duplicate attempt guard: if database already processed this exact assessment timestamp
  IF v_last_assessed_at IS NOT NULL AND v_last_assessed_at = p_assessed_at THEN
    SELECT previous_state, next_state, source, was_correct, elapsed_ms, next_review_at
    INTO v_event_prev, v_event_next, v_event_source, v_event_correct, v_event_elapsed, v_event_next_review
    FROM public.review_events
    WHERE user_id = p_user_id
      AND vocabulary_item_id = p_vocabulary_item_id
      AND created_at = p_assessed_at
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_is_graduated := (COALESCE(v_event_prev, '') <> 'mastered' AND v_event_next = 'mastered');
      RETURN jsonb_build_object(
        'success', true,
        'ignored', false,
        'memory_state', v_current_state,
        'next_review_at', v_existing_next_review_at,
        'graduated', v_is_graduated,
        'transition', jsonb_build_object(
          'from', v_event_prev,
          'to', v_event_next,
          'source', v_event_source,
          'result', p_result,
          'graduated', v_is_graduated,
          'nextReviewAt', v_event_next_review
        )
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'ignored', true,
        'memory_state', v_current_state,
        'next_review_at', v_existing_next_review_at,
        'graduated', false,
        'transition', jsonb_build_object(
          'from', v_current_state,
          'to', v_current_state,
          'source', p_source,
          'result', p_result,
          'graduated', false,
          'nextReviewAt', v_existing_next_review_at
        )
      );
    END IF;
  END IF;

  -- Compute updated counters and fields
  v_new_review_count := COALESCE(v_review_count, 0) + (CASE WHEN p_should_increment_review_counters THEN 1 ELSE 0 END);
  v_new_lapse_count := COALESCE(v_lapse_count, 0) + (CASE WHEN p_should_increment_review_counters AND p_result = 'wrong' THEN 1 ELSE 0 END);
  v_is_graduated := (COALESCE(v_current_state, 'new') <> 'mastered' AND p_next_state = 'mastered');

  v_new_graduated_at := CASE
    WHEN p_next_state = 'mastered' THEN COALESCE(v_graduated_at, p_assessed_at)
    ELSE NULL
  END;

  v_new_last_reviewed_at := CASE
    WHEN p_should_increment_review_counters THEN p_assessed_at
    ELSE NULL
  END;

  -- 1. Atomic UPSERT review_states
  INSERT INTO public.review_states (
    user_id,
    vocabulary_item_id,
    memory_state,
    review_count,
    lapse_count,
    last_reviewed_at,
    next_review_at,
    ease_factor,
    interval_days,
    last_result,
    last_elapsed_ms,
    last_assessed_at,
    graduated_at
  )
  VALUES (
    p_user_id,
    p_vocabulary_item_id,
    p_next_state,
    v_new_review_count,
    v_new_lapse_count,
    v_new_last_reviewed_at,
    p_next_review_at,
    p_ease_factor,
    p_interval_days,
    p_result,
    p_elapsed_ms,
    p_assessed_at,
    v_new_graduated_at
  )
  ON CONFLICT (user_id, vocabulary_item_id) DO UPDATE SET
    memory_state = EXCLUDED.memory_state,
    review_count = EXCLUDED.review_count,
    lapse_count = EXCLUDED.lapse_count,
    last_reviewed_at = COALESCE(EXCLUDED.last_reviewed_at, public.review_states.last_reviewed_at),
    next_review_at = EXCLUDED.next_review_at,
    ease_factor = EXCLUDED.ease_factor,
    interval_days = EXCLUDED.interval_days,
    last_result = EXCLUDED.last_result,
    last_elapsed_ms = EXCLUDED.last_elapsed_ms,
    last_assessed_at = EXCLUDED.last_assessed_at,
    graduated_at = EXCLUDED.graduated_at;

  -- 2. Atomic INSERT review_events audit log
  INSERT INTO public.review_events (
    id,
    user_id,
    vocabulary_item_id,
    learning_group_id,
    source,
    was_correct,
    elapsed_ms,
    previous_state,
    next_state,
    next_review_at,
    created_at
  )
  VALUES (
    v_new_event_id,
    p_user_id,
    p_vocabulary_item_id,
    p_learning_group_id,
    p_source,
    p_was_correct,
    p_elapsed_ms,
    v_current_state,
    p_next_state,
    p_next_review_at,
    p_assessed_at
  );

  -- 3. Atomic UPSERT daily_user_statistics
  INSERT INTO public.daily_user_statistics (
    user_id,
    date_key,
    review_word_count,
    attempt_count,
    correct_count,
    updated_at
  )
  VALUES (
    p_user_id,
    p_routine_date,
    CASE WHEN p_source = 'review' THEN 1 ELSE 0 END,
    1,
    CASE WHEN p_was_correct THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user_id, date_key) DO UPDATE SET
    review_word_count = public.daily_user_statistics.review_word_count + (
      CASE
        WHEN p_source = 'review' AND NOT EXISTS (
          SELECT 1 FROM public.review_events
          WHERE user_id = p_user_id
            AND vocabulary_item_id = p_vocabulary_item_id
            AND source = 'review'
            AND id <> v_new_event_id
            AND created_at::DATE = p_routine_date
        ) THEN 1
        ELSE 0
      END
    ),
    attempt_count = public.daily_user_statistics.attempt_count + 1,
    correct_count = public.daily_user_statistics.correct_count + (CASE WHEN p_was_correct THEN 1 ELSE 0 END),
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'ignored', false,
    'memory_state', p_next_state,
    'next_review_at', p_next_review_at,
    'graduated', v_is_graduated,
    'transition', jsonb_build_object(
      'from', v_current_state,
      'to', p_next_state,
      'source', p_source,
      'result', p_result,
      'graduated', v_is_graduated,
      'nextReviewAt', p_next_review_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_review_attempt_atomic(
  TEXT, UUID, UUID, TEXT, BOOLEAN, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, REAL, INTEGER, DATE, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_review_attempt_atomic(
  TEXT, UUID, UUID, TEXT, BOOLEAN, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, REAL, INTEGER, DATE, TIMESTAMPTZ
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_review_attempt_atomic(
  TEXT, UUID, UUID, TEXT, BOOLEAN, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, REAL, INTEGER, DATE, TIMESTAMPTZ
) TO service_role;


-- 2. complete_learning_group_atomic
CREATE OR REPLACE FUNCTION public.complete_learning_group_atomic(
  p_user_id TEXT,
  p_learning_group_id UUID,
  p_completed_word_ids UUID[],
  p_time_zone TEXT DEFAULT 'UTC',
  p_local_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_local_date DATE;
  v_total_updated_words INTEGER := 0;
  v_newly_learned_words INTEGER := 0;
  v_group_status TEXT;
  v_routine_id UUID;
  v_step_order JSONB;
  v_completed_steps JSONB;
  v_new_routine_status TEXT;
  v_starting_due_count INTEGER;
  v_day_kind TEXT;
  v_all_steps_done BOOLEAN;
BEGIN
  -- Security check: when called by an authenticated user, prevent impersonation
  IF auth.uid() IS NOT NULL AND auth.uid()::TEXT <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user ID mismatch';
  END IF;

  -- Acquire user-level transaction advisory lock to serialize group completion
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id)::BIGINT);

  -- Verify group existence and ownership
  SELECT status INTO v_group_status
  FROM public.learning_groups
  WHERE id = p_learning_group_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning group % not found for user %', p_learning_group_id, p_user_id;
  END IF;

  -- Determine local date from timezone if not provided
  v_local_date := COALESCE(p_local_date, (v_now AT TIME ZONE COALESCE(p_time_zone, 'UTC'))::DATE);

  -- 1. Batch update learning_group_words and count newly learned words
  IF p_completed_word_ids IS NOT NULL AND cardinality(p_completed_word_ids) > 0 THEN
    WITH target_words AS (
      SELECT DISTINCT item.id
      FROM unnest(p_completed_word_ids) AS item(id)
      WHERE item.id IS NOT NULL
    ),
    newly_learned AS (
      SELECT lgw.vocabulary_item_id
      FROM public.learning_group_words lgw
      JOIN target_words tw ON lgw.vocabulary_item_id = tw.id
      WHERE lgw.learning_group_id = p_learning_group_id
        AND lgw.learned_at IS NULL
    ),
    updated AS (
      UPDATE public.learning_group_words lgw
      SET
        round1_confirmed_at = COALESCE(lgw.round1_confirmed_at, v_now),
        round2_completed_at = COALESCE(lgw.round2_completed_at, v_now),
        round3_completed_at = COALESCE(lgw.round3_completed_at, v_now),
        learned_at = COALESCE(lgw.learned_at, v_now)
      FROM target_words
      WHERE lgw.learning_group_id = p_learning_group_id
        AND lgw.vocabulary_item_id = target_words.id
      RETURNING lgw.vocabulary_item_id
    )
    SELECT
      (SELECT COUNT(*) FROM updated),
      (SELECT COUNT(*) FROM newly_learned)
    INTO v_total_updated_words, v_newly_learned_words;

    -- Activate review_states for learned words
    INSERT INTO public.review_states (
      user_id,
      vocabulary_item_id,
      memory_state,
      interval_days,
      next_review_at,
      last_reviewed_at,
      graduated_at
    )
    SELECT
      p_user_id,
      w.id,
      'fuzzy',
      1,
      v_now + INTERVAL '1 day',
      v_now,
      NULL
    FROM unnest(p_completed_word_ids) AS w(id)
    WHERE w.id IS NOT NULL
    ON CONFLICT (user_id, vocabulary_item_id) DO UPDATE SET
      memory_state = CASE WHEN public.review_states.memory_state = 'new' THEN 'fuzzy' ELSE public.review_states.memory_state END,
      interval_days = CASE WHEN public.review_states.memory_state = 'new' THEN 1 ELSE public.review_states.interval_days END,
      next_review_at = CASE WHEN public.review_states.next_review_at IS NULL THEN v_now + INTERVAL '1 day' ELSE public.review_states.next_review_at END,
      last_reviewed_at = COALESCE(public.review_states.last_reviewed_at, v_now);

    -- Cascade remove from user_saved_words
    DELETE FROM public.user_saved_words
    WHERE user_id = p_user_id
      AND vocabulary_item_id = ANY(p_completed_word_ids);
  END IF;

  -- 2. Mark learning group completed and clear session pointers
  UPDATE public.learning_groups
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, v_now),
    session_round = NULL,
    session_current_index = NULL,
    session_queue_word_ids = NULL,
    session_passed_queue_indices = NULL,
    session_round1_confirmed_word_ids = NULL,
    session_last_active_at = NULL
  WHERE id = p_learning_group_id AND user_id = p_user_id;

  -- 3. Atomically update daily_routine_progress
  SELECT id, step_order_json, completed_steps_json, status
  INTO v_routine_id, v_step_order, v_completed_steps, v_new_routine_status
  FROM public.daily_routine_progress
  WHERE user_id = p_user_id AND local_date = v_local_date;

  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_starting_due_count
    FROM public.review_states
    WHERE user_id = p_user_id
      AND memory_state <> 'mastered'
      AND next_review_at IS NOT NULL
      AND next_review_at <= v_now;

    IF v_starting_due_count > 0 THEN
      v_day_kind := 'review_day';
      v_step_order := '["review", "round1", "round2", "round3"]'::jsonb;
      v_completed_steps := '["round1", "round2", "round3"]'::jsonb;
      v_new_routine_status := 'in_progress';
    ELSE
      v_day_kind := 'learning_day';
      v_step_order := '["round1", "round2", "round3"]'::jsonb;
      v_completed_steps := '["round1", "round2", "round3"]'::jsonb;
      v_new_routine_status := 'completed';
    END IF;

    INSERT INTO public.daily_routine_progress (
      user_id,
      local_date,
      timezone,
      day_kind,
      starting_due_count,
      main_learning_group_id,
      step_order_json,
      completed_steps_json,
      status
    )
    VALUES (
      p_user_id,
      v_local_date,
      COALESCE(p_time_zone, 'UTC'),
      v_day_kind,
      v_starting_due_count,
      p_learning_group_id,
      v_step_order,
      v_completed_steps,
      v_new_routine_status
    );
  ELSE
    -- Merge completed steps preserving step_order sequence
    WITH current_completed AS (
      SELECT jsonb_array_elements_text(COALESCE(v_completed_steps, '[]'::jsonb)) AS step
    ),
    target_completed AS (
      SELECT step FROM current_completed
      UNION
      SELECT unnest(ARRAY['round1', 'round2', 'round3']) AS step
    ),
    ordered_steps AS (
      SELECT s.step
      FROM jsonb_array_elements_text(v_step_order) WITH ORDINALITY AS s(step, ord)
      WHERE s.step IN (SELECT step FROM target_completed)
      ORDER BY s.ord
    )
    SELECT COALESCE(jsonb_agg(step), '[]'::jsonb)
    INTO v_completed_steps
    FROM ordered_steps;

    -- Check if all steps in step_order are completed
    SELECT (jsonb_array_length(v_step_order) = jsonb_array_length(v_completed_steps))
    INTO v_all_steps_done;

    IF v_all_steps_done THEN
      v_new_routine_status := 'completed';
    ELSE
      v_new_routine_status := 'in_progress';
    END IF;

    UPDATE public.daily_routine_progress
    SET
      completed_steps_json = v_completed_steps,
      main_learning_group_id = COALESCE(main_learning_group_id, p_learning_group_id),
      status = v_new_routine_status,
      updated_at = v_now
    WHERE id = v_routine_id;
  END IF;

  -- 4. Atomically upsert daily_user_statistics
  INSERT INTO public.daily_user_statistics (
    user_id,
    date_key,
    learned_word_count,
    is_routine_finished,
    updated_at
  )
  VALUES (
    p_user_id,
    v_local_date,
    v_newly_learned_words,
    (v_new_routine_status = 'completed'),
    v_now
  )
  ON CONFLICT (user_id, date_key) DO UPDATE SET
    learned_word_count = public.daily_user_statistics.learned_word_count + EXCLUDED.learned_word_count,
    is_routine_finished = public.daily_user_statistics.is_routine_finished OR EXCLUDED.is_routine_finished,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_learning_group_id,
    'updated_count', v_total_updated_words,
    'newly_learned_count', v_newly_learned_words,
    'routine_status', v_new_routine_status,
    'is_routine_finished', (v_new_routine_status = 'completed')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_learning_group_atomic(TEXT, UUID, UUID[], TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_learning_group_atomic(TEXT, UUID, UUID[], TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_learning_group_atomic(TEXT, UUID, UUID[], TEXT, DATE) TO service_role;

