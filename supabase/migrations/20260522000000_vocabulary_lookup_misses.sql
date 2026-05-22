CREATE TABLE IF NOT EXISTS vocabulary_lookup_misses (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  word                        TEXT NOT NULL,
  source                      TEXT NOT NULL DEFAULT 'reading_popup',
  status                      TEXT NOT NULL DEFAULT 'pending',
  first_requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_requested_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  request_count               INTEGER NOT NULL DEFAULT 1,
  last_user_id                TEXT,
  inserted_vocabulary_item_id UUID REFERENCES vocabulary_items(id) ON DELETE SET NULL,
  note                        TEXT,
  UNIQUE(word),
  CHECK (word <> ''),
  CHECK (source IN ('reading_popup', 'manual', 'import', 'api')),
  CHECK (status IN ('pending', 'processing', 'inserted', 'ignored')),
  CHECK (request_count > 0)
);

CREATE INDEX IF NOT EXISTS vocabulary_lookup_misses_status_idx
  ON vocabulary_lookup_misses (status, last_requested_at DESC);

CREATE INDEX IF NOT EXISTS vocabulary_lookup_misses_last_requested_idx
  ON vocabulary_lookup_misses (last_requested_at DESC);

ALTER TABLE vocabulary_lookup_misses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION record_vocabulary_lookup_miss(
  p_word TEXT,
  p_user_id TEXT,
  p_source TEXT DEFAULT 'reading_popup'
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  normalized_word TEXT := LOWER(TRIM(REGEXP_REPLACE(COALESCE(p_word, ''), '\s+', ' ', 'g')));
  normalized_source TEXT := COALESCE(NULLIF(TRIM(p_source), ''), 'reading_popup');
BEGIN
  IF normalized_word = '' THEN
    RETURN;
  END IF;

  IF normalized_source NOT IN ('reading_popup', 'manual', 'import', 'api') THEN
    normalized_source := 'reading_popup';
  END IF;

  INSERT INTO vocabulary_lookup_misses (
    word,
    source,
    last_user_id
  )
  VALUES (
    normalized_word,
    normalized_source,
    p_user_id
  )
  ON CONFLICT (word) DO UPDATE
  SET
    source = EXCLUDED.source,
    last_user_id = EXCLUDED.last_user_id,
    last_requested_at = NOW(),
    request_count = vocabulary_lookup_misses.request_count + 1,
    status = CASE
      WHEN vocabulary_lookup_misses.status = 'inserted' THEN vocabulary_lookup_misses.status
      ELSE 'pending'
    END;
END;
$$;
