-- Move official-library word order into the DB and select the next learning batch
-- server-side via an anti-join, so batch selection no longer ships the user's full
-- learned-word set to the browser (which silently truncated at PostgREST's 1000-row
-- cap once a user had learned >1000 words, causing already-learned words like
-- "course" to be re-served forever).

CREATE TABLE IF NOT EXISTS official_vocab (
  library_id TEXT    NOT NULL,
  position   INTEGER NOT NULL,          -- index in the src/data ordered array
  word       TEXT    NOT NULL,          -- original array value (passed downstream to enrich)
  word_key   TEXT    NOT NULL,          -- word.trim().toLowerCase(), matches client compare
  PRIMARY KEY (library_id, position)
);

-- Anti-join lookup key; unique because no library has normalized-duplicate words.
CREATE UNIQUE INDEX IF NOT EXISTS official_vocab_key_idx
  ON official_vocab (library_id, word_key);

ALTER TABLE official_vocab ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "official_vocab_authenticated_select" ON official_vocab;
CREATE POLICY "official_vocab_authenticated_select" ON official_vocab
  FOR SELECT TO authenticated USING (true);

-- Returns up to p_limit official words for p_library_id that the user has NOT yet
-- "learned", where learned = (words in any of the user's system groups for this
-- library) UNION (words with a non-'new' review_state). This is the exact predicate
-- the client used to compute in JS, now run in Postgres and capped to p_limit rows.
--
-- SECURITY DEFINER + strict p_user_id scoping: only reveals which official words a
-- given (UUID) user has not grouped yet — low sensitivity — and keeps the result
-- deterministic for service-role parity testing. GRANTed to authenticated only.
CREATE OR REPLACE FUNCTION official_next_batch(
  p_user_id    TEXT,
  p_library_id TEXT,
  p_mode       TEXT DEFAULT 'sequential',
  p_limit      INT  DEFAULT 40
)
RETURNS TABLE (word TEXT, word_position INT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH learned AS (
    SELECT lower(btrim(vi.word)) AS word_key
    FROM learning_group_words gw
    JOIN learning_groups g    ON g.id  = gw.learning_group_id
    JOIN vocabulary_items  vi ON vi.id = gw.vocabulary_item_id
    WHERE g.user_id     = p_user_id
      AND g.source_type = 'system'
      AND g.library_id  = p_library_id
    UNION
    SELECT lower(btrim(vi.word)) AS word_key
    FROM review_states    rs
    JOIN vocabulary_items vi ON vi.id = rs.vocabulary_item_id
    WHERE rs.user_id      = p_user_id
      AND rs.memory_state <> 'new'
  )
  SELECT ov.word, ov.position AS word_position
  FROM official_vocab ov
  WHERE ov.library_id = p_library_id
    AND NOT EXISTS (SELECT 1 FROM learned l WHERE l.word_key = ov.word_key)
  ORDER BY
    CASE WHEN p_mode = 'shuffle' THEN NULL ELSE ov.position END ASC,
    CASE WHEN p_mode = 'shuffle' THEN random() ELSE NULL END ASC
  LIMIT GREATEST(COALESCE(p_limit, 40), 0);
$$;

REVOKE ALL ON FUNCTION official_next_batch(TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION official_next_batch(TEXT, TEXT, TEXT, INT) TO authenticated;
