ALTER TABLE review_states
  ALTER COLUMN next_review_at DROP DEFAULT,
  ALTER COLUMN interval_days DROP DEFAULT;

ALTER TABLE review_states
  ADD COLUMN IF NOT EXISTS memory_state TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS last_result TEXT,
  ADD COLUMN IF NOT EXISTS last_elapsed_ms INTEGER,
  ADD COLUMN IF NOT EXISTS last_assessed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS graduated_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_states_memory_state_check'
  ) THEN
    ALTER TABLE review_states
      ADD CONSTRAINT review_states_memory_state_check
      CHECK (memory_state IN ('new', 'fuzzy', 'slow_recall', 'stable_recall', 'mastered'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'review_states_last_result_check'
  ) THEN
    ALTER TABLE review_states
      ADD CONSTRAINT review_states_last_result_check
      CHECK (last_result IS NULL OR last_result IN ('wrong', 'slow_correct', 'fast_correct'));
  END IF;
END
$$;

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

ALTER TABLE review_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'review_events'
      AND policyname = 'public_all'
  ) THEN
    CREATE POLICY "public_all" ON review_events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END
$$;
