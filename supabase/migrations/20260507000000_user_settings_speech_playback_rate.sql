ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS speech_playback_rate NUMERIC(2,1) NOT NULL DEFAULT 1.0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_speech_playback_rate_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_speech_playback_rate_check
      CHECK (speech_playback_rate IN (0.6, 0.8, 1.0));
  END IF;
END $$;
