ALTER TABLE user_settings
  DROP CONSTRAINT IF EXISTS user_settings_auto_play_repeat_gap_ms_check;

UPDATE user_settings
SET auto_play_repeat_gap_ms = CASE auto_play_repeat_gap_ms
  WHEN 800 THEN 1000
  WHEN 1200 THEN 1500
  WHEN 1800 THEN 2500
  WHEN 1000 THEN 1000
  WHEN 1500 THEN 1500
  WHEN 2500 THEN 2500
  ELSE 1500
END
WHERE auto_play_repeat_gap_ms NOT IN (1000, 1500, 2500);

ALTER TABLE user_settings
  ALTER COLUMN auto_play_repeat_count SET DEFAULT 3,
  ALTER COLUMN auto_play_repeat_gap_ms SET DEFAULT 1500,
  ALTER COLUMN wrong_answer_reveal_ms SET DEFAULT 8000,
  ADD CONSTRAINT user_settings_auto_play_repeat_gap_ms_check
    CHECK (auto_play_repeat_gap_ms IN (1000, 1500, 2500));
