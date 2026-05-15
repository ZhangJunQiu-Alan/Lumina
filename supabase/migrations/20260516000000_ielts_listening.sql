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
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id         UUID NOT NULL REFERENCES ielts_listening_tests(id) ON DELETE CASCADE,
  section_id      UUID NOT NULL REFERENCES ielts_listening_sections(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL REFERENCES ielts_listening_question_groups(id) ON DELETE CASCADE,
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

ALTER TABLE ielts_listening_books           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_tests           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_sections        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_questions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_attempts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ielts_listening_responses       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ielts_listening_books_authenticated_select" ON ielts_listening_books;
CREATE POLICY "ielts_listening_books_authenticated_select" ON ielts_listening_books
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "ielts_listening_tests_authenticated_select" ON ielts_listening_tests;
CREATE POLICY "ielts_listening_tests_authenticated_select" ON ielts_listening_tests
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "ielts_listening_sections_authenticated_select" ON ielts_listening_sections;
CREATE POLICY "ielts_listening_sections_authenticated_select" ON ielts_listening_sections
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "ielts_listening_groups_authenticated_select" ON ielts_listening_question_groups;
CREATE POLICY "ielts_listening_groups_authenticated_select" ON ielts_listening_question_groups
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "ielts_listening_questions_authenticated_select" ON ielts_listening_questions;
CREATE POLICY "ielts_listening_questions_authenticated_select" ON ielts_listening_questions
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "ielts_listening_attempts_owner_select" ON ielts_listening_attempts;
CREATE POLICY "ielts_listening_attempts_owner_select" ON ielts_listening_attempts
  FOR SELECT USING ((SELECT auth.uid())::text = user_id);
DROP POLICY IF EXISTS "ielts_listening_attempts_owner_insert" ON ielts_listening_attempts;
CREATE POLICY "ielts_listening_attempts_owner_insert" ON ielts_listening_attempts
  FOR INSERT WITH CHECK ((SELECT auth.uid())::text = user_id);

DROP POLICY IF EXISTS "ielts_listening_responses_owner_select" ON ielts_listening_responses;
CREATE POLICY "ielts_listening_responses_owner_select" ON ielts_listening_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM ielts_listening_attempts attempts
      WHERE attempts.id = ielts_listening_responses.attempt_id
        AND attempts.user_id = (SELECT auth.uid())::text
    )
  );
DROP POLICY IF EXISTS "ielts_listening_responses_owner_insert" ON ielts_listening_responses;
CREATE POLICY "ielts_listening_responses_owner_insert" ON ielts_listening_responses
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM ielts_listening_attempts attempts
      WHERE attempts.id = ielts_listening_responses.attempt_id
        AND attempts.user_id = (SELECT auth.uid())::text
    )
  );
