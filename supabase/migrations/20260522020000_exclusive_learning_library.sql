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
  v_target_library_key TEXT;
  v_group_id UUID;
  v_conflicting_group_ids UUID[] := ARRAY[]::UUID[];
  v_conflicting_word_ids UUID[] := ARRAY[]::UUID[];
  v_orphan_word_ids UUID[] := ARRAY[]::UUID[];
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

  v_target_library_key := CASE
    WHEN v_source_type = 'system' THEN 'official:' || v_library_id
    ELSE 'custom'
  END;

  PERFORM pg_advisory_xact_lock(hashtext(v_user_id)::BIGINT);

  SELECT COALESCE(array_agg(group_id), ARRAY[]::UUID[])
  INTO v_conflicting_group_ids
  FROM (
    SELECT id AS group_id
    FROM public.learning_groups
    WHERE user_id = v_user_id
      AND completed_at IS NULL
      AND status IS DISTINCT FROM 'completed'
      AND (
        CASE
          WHEN source_type = 'system' THEN 'official:' || COALESCE(NULLIF(BTRIM(COALESCE(library_id, '')), ''), '__legacy__')
          ELSE 'custom'
        END
      ) <> v_target_library_key
    FOR UPDATE
  ) AS locked_groups;

  IF cardinality(v_conflicting_group_ids) > 0 THEN
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
  END IF;

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

  INSERT INTO public.review_states (
    user_id,
    vocabulary_item_id,
    memory_state,
    interval_days,
    next_review_at,
    graduated_at
  )
  SELECT
    v_user_id,
    item.vocabulary_item_id,
    'new',
    NULL,
    NULL,
    NULL
  FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
  ON CONFLICT (user_id, vocabulary_item_id) DO NOTHING;

  RETURN v_group_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_learning_group_exclusive(TEXT, TEXT, TEXT, TEXT, UUID[]) TO service_role;
