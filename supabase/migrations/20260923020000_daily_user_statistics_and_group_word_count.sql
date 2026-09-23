-- 20260923020000_daily_user_statistics_and_group_word_count.sql
-- 1. Daily User Statistics table for fast O(1) home overview and activity heatmap queries
CREATE TABLE IF NOT EXISTS daily_user_statistics (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             TEXT NOT NULL,
  date_key            DATE NOT NULL,
  review_word_count   INTEGER NOT NULL DEFAULT 0,
  learned_word_count  INTEGER NOT NULL DEFAULT 0,
  attempt_count       INTEGER NOT NULL DEFAULT 0,
  correct_count       INTEGER NOT NULL DEFAULT 0,
  is_routine_finished BOOLEAN NOT NULL DEFAULT false,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_user_stats_lookup
  ON daily_user_statistics (user_id, date_key DESC);

ALTER TABLE daily_user_statistics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_user_statistics_owner_select" ON daily_user_statistics
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "daily_user_statistics_owner_insert" ON daily_user_statistics
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_user_statistics_owner_update" ON daily_user_statistics
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_user_statistics_owner_delete" ON daily_user_statistics
  FOR DELETE USING (auth.uid()::text = user_id);

-- 2. Add word_count column to learning_groups to eliminate cross-table word counts
ALTER TABLE learning_groups ADD COLUMN IF NOT EXISTS word_count INTEGER DEFAULT 0;

-- Backfill word_count for existing groups
UPDATE learning_groups lg
SET word_count = sub.cnt
FROM (
  SELECT learning_group_id, COUNT(*) AS cnt
  FROM learning_group_words
  GROUP BY learning_group_id
) sub
WHERE lg.id = sub.learning_group_id
  AND (lg.word_count IS NULL OR lg.word_count = 0);

-- 3. Update create_learning_group_exclusive to store word_count on creation
CREATE OR REPLACE FUNCTION public.create_learning_group_exclusive(
  p_user_id TEXT,
  p_group_name TEXT,
  p_source_type TEXT DEFAULT 'custom',
  p_library_id TEXT DEFAULT NULL,
  p_vocabulary_item_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_request_user_id TEXT := (SELECT auth.uid())::TEXT;
  v_request_role TEXT := COALESCE((SELECT auth.role()), '');
  v_user_id TEXT := NULLIF(BTRIM(COALESCE(p_user_id, '')), '');
  v_source_type TEXT := COALESCE(NULLIF(BTRIM(COALESCE(p_source_type, '')), ''), 'custom');
  v_library_id TEXT := NULLIF(BTRIM(COALESCE(p_library_id, '')), '');
  v_group_id UUID;
  v_word_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF v_request_role <> 'service_role' AND v_request_user_id IS DISTINCT FROM v_user_id THEN
    RAISE EXCEPTION 'authenticated user does not match p_user_id';
  END IF;

  IF v_source_type NOT IN ('custom', 'system') THEN
    RAISE EXCEPTION 'p_source_type must be custom or system';
  END IF;

  IF v_source_type = 'system' AND v_library_id IS NULL THEN
    RAISE EXCEPTION 'p_library_id is required for system learning groups';
  END IF;

  IF v_source_type = 'custom' THEN
    v_library_id := NULL;
  END IF;

  v_word_count := COALESCE(cardinality(p_vocabulary_item_ids), 0);
  IF v_word_count = 0 THEN
    RAISE EXCEPTION 'p_vocabulary_item_ids must not be empty';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
    WHERE item.vocabulary_item_id IS NULL
  ) THEN
    RAISE EXCEPTION 'p_vocabulary_item_ids must not contain nulls';
  END IF;

  IF (
    SELECT COUNT(*)
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
  ) <> (
    SELECT COUNT(DISTINCT item.vocabulary_item_id)
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
  ) THEN
    RAISE EXCEPTION 'p_vocabulary_item_ids must not contain duplicates';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id)::BIGINT);

  INSERT INTO public.learning_groups (
    user_id,
    group_name,
    source_type,
    library_id,
    word_count
  )
  VALUES (
    v_user_id,
    NULLIF(BTRIM(COALESCE(p_group_name, '')), ''),
    v_source_type,
    v_library_id,
    v_word_count
  )
  RETURNING id INTO v_group_id;

  INSERT INTO public.learning_group_words (
    learning_group_id,
    vocabulary_item_id,
    sequence_no
  )
  SELECT
    v_group_id,
    item.vocabulary_item_id,
    item.ordinality::INTEGER - 1
  FROM unnest(p_vocabulary_item_ids) WITH ORDINALITY AS item(vocabulary_item_id, ordinality);

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) TO service_role;
