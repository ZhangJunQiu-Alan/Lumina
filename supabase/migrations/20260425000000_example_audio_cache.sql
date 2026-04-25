CREATE TABLE IF NOT EXISTS example_audio_cache (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sentence_hash TEXT NOT NULL,
  sentence_text TEXT NOT NULL,
  locale        TEXT NOT NULL CHECK (locale IN ('uk', 'us')),
  voice_name    TEXT NOT NULL,
  audio_url     TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sentence_hash, locale, voice_name)
);

CREATE INDEX IF NOT EXISTS example_audio_cache_lookup_idx
  ON example_audio_cache (sentence_hash, locale, voice_name);
