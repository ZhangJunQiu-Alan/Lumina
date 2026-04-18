ALTER TABLE learning_groups
  ADD COLUMN IF NOT EXISTS session_round TEXT,
  ADD COLUMN IF NOT EXISTS session_current_index INTEGER,
  ADD COLUMN IF NOT EXISTS session_queue_word_ids JSONB,
  ADD COLUMN IF NOT EXISTS session_last_active_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'learning_groups_session_round_check'
  ) THEN
    ALTER TABLE learning_groups
      ADD CONSTRAINT learning_groups_session_round_check
      CHECK (session_round IS NULL OR session_round IN ('round1', 'round2', 'round3', 'article'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS generated_articles_learning_group_id_key
  ON generated_articles (learning_group_id);
