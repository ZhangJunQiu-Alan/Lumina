ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ielts_target_score NUMERIC(2,1) NOT NULL DEFAULT 7.0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_ielts_target_score_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_ielts_target_score_check
      CHECK (ielts_target_score IN (5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0));
  END IF;
END $$;
