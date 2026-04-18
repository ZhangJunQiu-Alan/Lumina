CREATE TABLE IF NOT EXISTS user_settings (
  user_id                        TEXT PRIMARY KEY,
  default_pronunciation_locale   TEXT NOT NULL DEFAULT 'uk',
  auto_play_enabled              BOOLEAN NOT NULL DEFAULT true,
  auto_play_repeat_count         INTEGER NOT NULL DEFAULT 1,
  auto_play_repeat_gap_ms        INTEGER NOT NULL DEFAULT 800,
  wrong_answer_reveal_ms         INTEGER NOT NULL DEFAULT 5000,
  updated_at                     TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_default_pronunciation_locale_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_default_pronunciation_locale_check
      CHECK (default_pronunciation_locale IN ('uk', 'us'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_auto_play_repeat_count_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_auto_play_repeat_count_check
      CHECK (auto_play_repeat_count IN (1, 2, 3));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_auto_play_repeat_gap_ms_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_auto_play_repeat_gap_ms_check
      CHECK (auto_play_repeat_gap_ms IN (800, 1200, 1800));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_settings_wrong_answer_reveal_ms_check'
  ) THEN
    ALTER TABLE user_settings
      ADD CONSTRAINT user_settings_wrong_answer_reveal_ms_check
      CHECK (wrong_answer_reveal_ms IN (3000, 5000, 8000));
  END IF;
END $$;

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_settings_owner_select" ON user_settings;
DROP POLICY IF EXISTS "user_settings_owner_insert" ON user_settings;
DROP POLICY IF EXISTS "user_settings_owner_update" ON user_settings;
DROP POLICY IF EXISTS "user_settings_owner_delete" ON user_settings;

CREATE POLICY "user_settings_owner_select" ON user_settings
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "user_settings_owner_insert" ON user_settings
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_settings_owner_update" ON user_settings
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "user_settings_owner_delete" ON user_settings
  FOR DELETE USING (auth.uid()::text = user_id);
