-- Keep official learning groups scoped to the committed study batch.
-- Future-batch preload must not create group-word rows or empty review states.

CREATE OR REPLACE FUNCTION official_next_batch(
  p_user_id    TEXT,
  p_library_id TEXT,
  p_mode       TEXT DEFAULT 'sequential',
  p_limit      INT  DEFAULT 30
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
  LIMIT GREATEST(COALESCE(p_limit, 30), 0);
$$;

REVOKE ALL ON FUNCTION official_next_batch(TEXT, TEXT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION official_next_batch(TEXT, TEXT, TEXT, INT) TO authenticated;

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

  IF COALESCE(cardinality(p_vocabulary_item_ids), 0) = 0 THEN
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
    library_id
  )
  VALUES (
    v_user_id,
    NULLIF(BTRIM(COALESCE(p_group_name, '')), ''),
    v_source_type,
    v_library_id
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

WITH removed_group_words AS (
  DELETE FROM public.learning_group_words AS lgw
  USING public.learning_groups AS lg
  WHERE lg.id = lgw.learning_group_id
    AND lg.source_type = 'system'
    AND lg.library_id IS NOT NULL
    AND COALESCE(lgw.sequence_no, -1) >= 30
    AND lgw.round1_confirmed_at IS NULL
    AND lgw.round2_completed_at IS NULL
    AND lgw.round3_completed_at IS NULL
    AND lgw.learned_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.review_events AS re
      WHERE re.user_id = lg.user_id
        AND re.learning_group_id = lg.id
        AND re.vocabulary_item_id = lgw.vocabulary_item_id
    )
  RETURNING lg.id AS group_id, lg.user_id, lgw.vocabulary_item_id
),
groups_to_repair AS (
  SELECT DISTINCT group_id
  FROM removed_group_words
),
session_replacements AS (
  SELECT
    lg.id AS group_id,
    CASE
      WHEN jsonb_typeof(lg.session_queue_word_ids) = 'array' THEN
        COALESCE((
          SELECT jsonb_agg(queue_item.value ORDER BY queue_item.ordinality)
          FROM jsonb_array_elements_text(lg.session_queue_word_ids)
            WITH ORDINALITY AS queue_item(value, ordinality)
          WHERE NOT EXISTS (
            SELECT 1
            FROM removed_group_words AS removed
            WHERE removed.group_id = lg.id
              AND removed.vocabulary_item_id::TEXT = queue_item.value
          )
        ), '[]'::jsonb)
      ELSE lg.session_queue_word_ids
    END AS next_queue_word_ids,
    CASE
      WHEN jsonb_typeof(lg.session_round1_confirmed_word_ids) = 'array' THEN
        COALESCE((
          SELECT jsonb_agg(confirmed_item.value ORDER BY confirmed_item.ordinality)
          FROM jsonb_array_elements_text(lg.session_round1_confirmed_word_ids)
            WITH ORDINALITY AS confirmed_item(value, ordinality)
          WHERE NOT EXISTS (
            SELECT 1
            FROM removed_group_words AS removed
            WHERE removed.group_id = lg.id
              AND removed.vocabulary_item_id::TEXT = confirmed_item.value
          )
        ), '[]'::jsonb)
      ELSE lg.session_round1_confirmed_word_ids
    END AS next_round1_confirmed_word_ids
  FROM public.learning_groups AS lg
  JOIN groups_to_repair AS repair ON repair.group_id = lg.id
),
repaired_sessions AS (
  UPDATE public.learning_groups AS lg
  SET
    session_queue_word_ids = replacements.next_queue_word_ids,
    session_round1_confirmed_word_ids = replacements.next_round1_confirmed_word_ids,
    session_current_index = CASE
      WHEN lg.session_current_index IS NULL THEN NULL
      WHEN jsonb_typeof(replacements.next_queue_word_ids) = 'array' THEN
        LEAST(GREATEST(lg.session_current_index, 0), jsonb_array_length(replacements.next_queue_word_ids))
      ELSE lg.session_current_index
    END
  FROM session_replacements AS replacements
  WHERE lg.id = replacements.group_id
  RETURNING lg.id
),
orphaned_review_state_candidates AS (
  SELECT DISTINCT user_id, vocabulary_item_id
  FROM removed_group_words
)
DELETE FROM public.review_states AS rs
USING orphaned_review_state_candidates AS candidate
WHERE rs.user_id = candidate.user_id
  AND rs.vocabulary_item_id = candidate.vocabulary_item_id
  AND rs.memory_state = 'new'
  AND rs.interval_days IS NULL
  AND rs.last_reviewed_at IS NULL
  AND rs.next_review_at IS NULL
  AND COALESCE(rs.review_count, 0) = 0
  AND COALESCE(rs.lapse_count, 0) = 0
  AND rs.last_result IS NULL
  AND rs.last_elapsed_ms IS NULL
  AND rs.last_assessed_at IS NULL
  AND rs.graduated_at IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.review_events AS re
    WHERE re.user_id = candidate.user_id
      AND re.vocabulary_item_id = candidate.vocabulary_item_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.user_saved_words AS usw
    WHERE usw.user_id = candidate.user_id
      AND usw.vocabulary_item_id = candidate.vocabulary_item_id
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.learning_group_words AS remaining_lgw
    JOIN public.learning_groups AS remaining_lg ON remaining_lg.id = remaining_lgw.learning_group_id
    WHERE remaining_lg.user_id = candidate.user_id
      AND remaining_lgw.vocabulary_item_id = candidate.vocabulary_item_id
  );
