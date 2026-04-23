ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS reinforcement_round3_enabled BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS reinforcement_article_enabled BOOLEAN NOT NULL DEFAULT true;
