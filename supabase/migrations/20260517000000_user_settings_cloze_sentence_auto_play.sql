ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS cloze_sentence_auto_play_enabled BOOLEAN NOT NULL DEFAULT TRUE;
