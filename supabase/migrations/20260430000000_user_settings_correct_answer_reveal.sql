ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS correct_answer_reveal_ms INTEGER NOT NULL DEFAULT 1000;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_correct_answer_reveal_ms_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_correct_answer_reveal_ms_check
      CHECK (correct_answer_reveal_ms IN (800, 1000, 1500, 2000));
  END IF;
END $$;
