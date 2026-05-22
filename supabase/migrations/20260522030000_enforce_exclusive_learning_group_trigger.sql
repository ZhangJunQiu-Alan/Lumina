CREATE OR REPLACE FUNCTION public.learning_group_library_key(
  p_source_type TEXT,
  p_library_id TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_source_type = 'system'
      THEN 'official:' || COALESCE(NULLIF(BTRIM(COALESCE(p_library_id, '')), ''), '__legacy__')
    ELSE 'custom'
  END;
$$;

CREATE OR REPLACE FUNCTION public.discard_conflicting_active_learning_groups(
  p_user_id TEXT,
  p_target_source_type TEXT,
  p_target_library_id TEXT DEFAULT NULL,
  p_excluded_group_id UUID DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT := NULLIF(BTRIM(COALESCE(p_user_id, '')), '');
  v_target_library_key TEXT := public.learning_group_library_key(p_target_source_type, p_target_library_id);
  v_conflicting_group_ids UUID[] := ARRAY[]::UUID[];
  v_conflicting_word_ids UUID[] := ARRAY[]::UUID[];
  v_orphan_word_ids UUID[] := ARRAY[]::UUID[];
  v_deleted_count INTEGER := 0;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id)::BIGINT);

  SELECT COALESCE(array_agg(group_id), ARRAY[]::UUID[])
  INTO v_conflicting_group_ids
  FROM (
    SELECT id AS group_id
    FROM public.learning_groups
    WHERE user_id = v_user_id
      AND completed_at IS NULL
      AND status IS DISTINCT FROM 'completed'
      AND (p_excluded_group_id IS NULL OR id <> p_excluded_group_id)
      AND public.learning_group_library_key(source_type, library_id) <> v_target_library_key
    FOR UPDATE
  ) AS locked_groups;

  IF cardinality(v_conflicting_group_ids) = 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(array_agg(DISTINCT vocabulary_item_id), ARRAY[]::UUID[])
  INTO v_conflicting_word_ids
  FROM public.learning_group_words
  WHERE learning_group_id = ANY(v_conflicting_group_ids);

  SELECT COALESCE(array_agg(conflicted.vocabulary_item_id), ARRAY[]::UUID[])
  INTO v_orphan_word_ids
  FROM unnest(v_conflicting_word_ids) AS conflicted(vocabulary_item_id)
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.learning_group_words AS shared_words
    INNER JOIN public.learning_groups AS shared_groups
      ON shared_groups.id = shared_words.learning_group_id
    WHERE shared_groups.user_id = v_user_id
      AND shared_words.vocabulary_item_id = conflicted.vocabulary_item_id
      AND NOT (shared_groups.id = ANY(v_conflicting_group_ids))
  );

  IF cardinality(v_orphan_word_ids) > 0 THEN
    DELETE FROM public.review_events
    WHERE user_id = v_user_id
      AND vocabulary_item_id = ANY(v_orphan_word_ids);

    DELETE FROM public.review_states
    WHERE user_id = v_user_id
      AND vocabulary_item_id = ANY(v_orphan_word_ids);
  END IF;

  WITH affected AS (
    SELECT
      id,
      step_order_json,
      CASE
        WHEN jsonb_typeof(step_order_json) = 'array'
          AND jsonb_typeof(completed_steps_json) = 'array'
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(step_order_json) AS step(value)
            WHERE step.value = 'review'
          )
          AND EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(completed_steps_json) AS step(value)
            WHERE step.value = 'review'
          )
        THEN '["review"]'::JSONB
        ELSE '[]'::JSONB
      END AS next_completed_steps
    FROM public.daily_routine_progress
    WHERE user_id = v_user_id
      AND main_learning_group_id = ANY(v_conflicting_group_ids)
  ),
  resolved AS (
    SELECT
      id,
      next_completed_steps,
      CASE
        WHEN jsonb_array_length(next_completed_steps) = 0 THEN 'not_started'
        WHEN (
          CASE
            WHEN jsonb_typeof(step_order_json) = 'array' THEN jsonb_array_length(step_order_json)
            ELSE 0
          END
        ) = jsonb_array_length(next_completed_steps) THEN 'completed'
        ELSE 'in_progress'
      END AS next_status
    FROM affected
  )
  UPDATE public.daily_routine_progress AS progress
  SET
    main_learning_group_id = NULL,
    completed_steps_json = resolved.next_completed_steps,
    status = resolved.next_status,
    updated_at = NOW()
  FROM resolved
  WHERE progress.id = resolved.id;

  DELETE FROM public.learning_groups
  WHERE user_id = v_user_id
    AND id = ANY(v_conflicting_group_ids);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_exclusive_active_learning_library()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NULL AND NEW.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.discard_conflicting_active_learning_groups(
      NEW.user_id,
      NEW.source_type,
      NEW.library_id,
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_exclusive_active_learning_library_insert ON public.learning_groups;
CREATE TRIGGER enforce_exclusive_active_learning_library_insert
  BEFORE INSERT ON public.learning_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_exclusive_active_learning_library();

WITH latest_active_group AS (
  SELECT DISTINCT ON (user_id)
    user_id,
    id,
    source_type,
    library_id
  FROM public.learning_groups
  WHERE user_id IS NOT NULL
    AND completed_at IS NULL
    AND status IS DISTINCT FROM 'completed'
  ORDER BY user_id, created_at DESC NULLS LAST, id DESC
)
SELECT public.discard_conflicting_active_learning_groups(
  user_id,
  source_type,
  library_id,
  id
)
FROM latest_active_group;

REVOKE ALL ON FUNCTION public.discard_conflicting_active_learning_groups(TEXT, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_exclusive_active_learning_library() FROM PUBLIC;
