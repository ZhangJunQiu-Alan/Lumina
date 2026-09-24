-- Migration: 20260924000000_atomic_review_and_session_completion.sql
-- Description: ACID atomic stored procedures for review attempts and learning group completion.

-- 1. record_review_attempt_atomic
CREATE OR REPLACE FUNCTION public.record_review_attempt_atomic(
  p_user_id TEXT,
  p_vocabulary_item_id UUID,
  p_learning_group_id UUID DEFAULT NULL,
  p_source TEXT DEFAULT 'review',
  p_was_correct BOOLEAN DEFAULT FALSE,
  p_elapsed_ms INTEGER DEFAULT 0,
  p_next_state TEXT DEFAULT 'fuzzy',
  p_next_review_at TIMESTAMPTZ DEFAULT NULL,
  p_should_increment_review_counters BOOLEAN DEFAULT TRUE,
  p_result TEXT DEFAULT 'wrong',
  p_ease_factor REAL DEFAULT 2.5,
  p_interval_days INTEGER DEFAULT 1,
  p_routine_date DATE DEFAULT CURRENT_DATE,
  p_assessed_at TIMESTAMPTZ DEFAULT NOW()
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_state TEXT;
  v_review_count INTEGER;
  v_lapse_count INTEGER;
  v_last_assessed_at TIMESTAMPTZ;
  v_existing_next_review_at TIMESTAMPTZ;
  v_graduated_at TIMESTAMPTZ;
  v_new_review_count INTEGER;
  v_new_lapse_count INTEGER;
  v_new_last_reviewed_at TIMESTAMPTZ;
  v_new_graduated_at TIMESTAMPTZ;
  v_is_graduated BOOLEAN;
  v_new_event_id UUID := gen_random_uuid();
  v_event_prev TEXT;
  v_event_next TEXT;
  v_event_source TEXT;
  v_event_correct BOOLEAN;
  v_event_elapsed INTEGER;
  v_event_next_review TIMESTAMPTZ;
BEGIN
  -- Security check: when called by an authenticated user, prevent impersonation
  IF auth.uid() IS NOT NULL AND auth.uid()::TEXT <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user ID mismatch';
  END IF;

  -- Acquire user-level transaction advisory lock to serialize attempts for this user
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id)::BIGINT);

  SELECT
    memory_state,
    review_count,
    lapse_count,
    last_assessed_at,
    next_review_at,
    graduated_at
  INTO
    v_current_state,
    v_review_count,
    v_lapse_count,
    v_last_assessed_at,
    v_existing_next_review_at,
    v_graduated_at
  FROM public.review_states
  WHERE user_id = p_user_id AND vocabulary_item_id = p_vocabulary_item_id;

  -- Stale attempt guard: database already has a strictly newer assessment
  IF v_last_assessed_at IS NOT NULL AND v_last_assessed_at > p_assessed_at THEN
    RETURN jsonb_build_object(
      'success', true,
      'ignored', true,
      'memory_state', v_current_state,
      'next_review_at', v_existing_next_review_at,
      'graduated', false,
      'transition', jsonb_build_object(
        'from', v_current_state,
        'to', v_current_state,
        'source', p_source,
        'result', p_result,
        'graduated', false,
        'nextReviewAt', v_existing_next_review_at
      )
    );
  END IF;

  -- Duplicate attempt guard: if database already processed this exact assessment timestamp
  IF v_last_assessed_at IS NOT NULL AND v_last_assessed_at = p_assessed_at THEN
    SELECT previous_state, next_state, source, was_correct, elapsed_ms, next_review_at
    INTO v_event_prev, v_event_next, v_event_source, v_event_correct, v_event_elapsed, v_event_next_review
    FROM public.review_events
    WHERE user_id = p_user_id
      AND vocabulary_item_id = p_vocabulary_item_id
      AND created_at = p_assessed_at
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      v_is_graduated := (COALESCE(v_event_prev, '') <> 'mastered' AND v_event_next = 'mastered');
      RETURN jsonb_build_object(
        'success', true,
        'ignored', false,
        'memory_state', v_current_state,
        'next_review_at', v_existing_next_review_at,
        'graduated', v_is_graduated,
        'transition', jsonb_build_object(
          'from', v_event_prev,
          'to', v_event_next,
          'source', v_event_source,
          'result', p_result,
          'graduated', v_is_graduated,
          'nextReviewAt', v_event_next_review
        )
      );
    ELSE
      RETURN jsonb_build_object(
        'success', true,
        'ignored', true,
        'memory_state', v_current_state,
        'next_review_at', v_existing_next_review_at,
        'graduated', false,
        'transition', jsonb_build_object(
          'from', v_current_state,
          'to', v_current_state,
          'source', p_source,
          'result', p_result,
          'graduated', false,
          'nextReviewAt', v_existing_next_review_at
        )
      );
    END IF;
  END IF;

  -- Compute updated counters and fields
  v_new_review_count := COALESCE(v_review_count, 0) + (CASE WHEN p_should_increment_review_counters THEN 1 ELSE 0 END);
  v_new_lapse_count := COALESCE(v_lapse_count, 0) + (CASE WHEN p_should_increment_review_counters AND p_result = 'wrong' THEN 1 ELSE 0 END);
  v_is_graduated := (COALESCE(v_current_state, 'new') <> 'mastered' AND p_next_state = 'mastered');

  v_new_graduated_at := CASE
    WHEN p_next_state = 'mastered' THEN COALESCE(v_graduated_at, p_assessed_at)
    ELSE NULL
  END;

  v_new_last_reviewed_at := CASE
    WHEN p_should_increment_review_counters THEN p_assessed_at
    ELSE NULL
  END;

  -- 1. Atomic UPSERT review_states
  INSERT INTO public.review_states (
    user_id,
    vocabulary_item_id,
    memory_state,
    review_count,
    lapse_count,
    last_reviewed_at,
    next_review_at,
    ease_factor,
    interval_days,
    last_result,
    last_elapsed_ms,
    last_assessed_at,
    graduated_at
  )
  VALUES (
    p_user_id,
    p_vocabulary_item_id,
    p_next_state,
    v_new_review_count,
    v_new_lapse_count,
    v_new_last_reviewed_at,
    p_next_review_at,
    p_ease_factor,
    p_interval_days,
    p_result,
    p_elapsed_ms,
    p_assessed_at,
    v_new_graduated_at
  )
  ON CONFLICT (user_id, vocabulary_item_id) DO UPDATE SET
    memory_state = EXCLUDED.memory_state,
    review_count = EXCLUDED.review_count,
    lapse_count = EXCLUDED.lapse_count,
    last_reviewed_at = COALESCE(EXCLUDED.last_reviewed_at, public.review_states.last_reviewed_at),
    next_review_at = EXCLUDED.next_review_at,
    ease_factor = EXCLUDED.ease_factor,
    interval_days = EXCLUDED.interval_days,
    last_result = EXCLUDED.last_result,
    last_elapsed_ms = EXCLUDED.last_elapsed_ms,
    last_assessed_at = EXCLUDED.last_assessed_at,
    graduated_at = EXCLUDED.graduated_at;

  -- 2. Atomic INSERT review_events audit log
  INSERT INTO public.review_events (
    id,
    user_id,
    vocabulary_item_id,
    learning_group_id,
    source,
    was_correct,
    elapsed_ms,
    previous_state,
    next_state,
    next_review_at,
    created_at
  )
  VALUES (
    v_new_event_id,
    p_user_id,
    p_vocabulary_item_id,
    p_learning_group_id,
    p_source,
    p_was_correct,
    p_elapsed_ms,
    v_current_state,
    p_next_state,
    p_next_review_at,
    p_assessed_at
  );

  -- 3. Atomic UPSERT daily_user_statistics
  INSERT INTO public.daily_user_statistics (
    user_id,
    date_key,
    review_word_count,
    attempt_count,
    correct_count,
    updated_at
  )
  VALUES (
    p_user_id,
    p_routine_date,
    CASE WHEN p_source = 'review' THEN 1 ELSE 0 END,
    1,
    CASE WHEN p_was_correct THEN 1 ELSE 0 END,
    NOW()
  )
  ON CONFLICT (user_id, date_key) DO UPDATE SET
    review_word_count = public.daily_user_statistics.review_word_count + (
      CASE
        WHEN p_source = 'review' AND NOT EXISTS (
          SELECT 1 FROM public.review_events
          WHERE user_id = p_user_id
            AND vocabulary_item_id = p_vocabulary_item_id
            AND source = 'review'
            AND id <> v_new_event_id
            AND created_at::DATE = p_routine_date
        ) THEN 1
        ELSE 0
      END
    ),
    attempt_count = public.daily_user_statistics.attempt_count + 1,
    correct_count = public.daily_user_statistics.correct_count + (CASE WHEN p_was_correct THEN 1 ELSE 0 END),
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'ignored', false,
    'memory_state', p_next_state,
    'next_review_at', p_next_review_at,
    'graduated', v_is_graduated,
    'transition', jsonb_build_object(
      'from', v_current_state,
      'to', p_next_state,
      'source', p_source,
      'result', p_result,
      'graduated', v_is_graduated,
      'nextReviewAt', p_next_review_at
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_review_attempt_atomic(
  TEXT, UUID, UUID, TEXT, BOOLEAN, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, REAL, INTEGER, DATE, TIMESTAMPTZ
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_review_attempt_atomic(
  TEXT, UUID, UUID, TEXT, BOOLEAN, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, REAL, INTEGER, DATE, TIMESTAMPTZ
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_review_attempt_atomic(
  TEXT, UUID, UUID, TEXT, BOOLEAN, INTEGER, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, REAL, INTEGER, DATE, TIMESTAMPTZ
) TO service_role;


-- 2. complete_learning_group_atomic
CREATE OR REPLACE FUNCTION public.complete_learning_group_atomic(
  p_user_id TEXT,
  p_learning_group_id UUID,
  p_completed_word_ids UUID[],
  p_time_zone TEXT DEFAULT 'UTC',
  p_local_date DATE DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now TIMESTAMPTZ := NOW();
  v_local_date DATE;
  v_total_updated_words INTEGER := 0;
  v_newly_learned_words INTEGER := 0;
  v_group_status TEXT;
  v_routine_id UUID;
  v_step_order JSONB;
  v_completed_steps JSONB;
  v_new_routine_status TEXT;
  v_starting_due_count INTEGER;
  v_day_kind TEXT;
  v_all_steps_done BOOLEAN;
BEGIN
  -- Security check: when called by an authenticated user, prevent impersonation
  IF auth.uid() IS NOT NULL AND auth.uid()::TEXT <> p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: user ID mismatch';
  END IF;

  -- Acquire user-level transaction advisory lock to serialize group completion
  PERFORM pg_advisory_xact_lock(hashtext(p_user_id)::BIGINT);

  -- Verify group existence and ownership
  SELECT status INTO v_group_status
  FROM public.learning_groups
  WHERE id = p_learning_group_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Learning group % not found for user %', p_learning_group_id, p_user_id;
  END IF;

  -- Determine local date from timezone if not provided
  v_local_date := COALESCE(p_local_date, (v_now AT TIME ZONE COALESCE(p_time_zone, 'UTC'))::DATE);

  -- 1. Batch update learning_group_words and count newly learned words
  IF p_completed_word_ids IS NOT NULL AND cardinality(p_completed_word_ids) > 0 THEN
    WITH target_words AS (
      SELECT DISTINCT item.id
      FROM unnest(p_completed_word_ids) AS item(id)
      WHERE item.id IS NOT NULL
    ),
    newly_learned AS (
      SELECT lgw.vocabulary_item_id
      FROM public.learning_group_words lgw
      JOIN target_words tw ON lgw.vocabulary_item_id = tw.id
      WHERE lgw.learning_group_id = p_learning_group_id
        AND lgw.learned_at IS NULL
    ),
    updated AS (
      UPDATE public.learning_group_words lgw
      SET
        round1_confirmed_at = COALESCE(lgw.round1_confirmed_at, v_now),
        round2_completed_at = COALESCE(lgw.round2_completed_at, v_now),
        round3_completed_at = COALESCE(lgw.round3_completed_at, v_now),
        learned_at = COALESCE(lgw.learned_at, v_now)
      FROM target_words
      WHERE lgw.learning_group_id = p_learning_group_id
        AND lgw.vocabulary_item_id = target_words.id
      RETURNING lgw.vocabulary_item_id
    )
    SELECT
      (SELECT COUNT(*) FROM updated),
      (SELECT COUNT(*) FROM newly_learned)
    INTO v_total_updated_words, v_newly_learned_words;

    -- Activate review_states for learned words
    INSERT INTO public.review_states (
      user_id,
      vocabulary_item_id,
      memory_state,
      interval_days,
      next_review_at,
      last_reviewed_at,
      graduated_at
    )
    SELECT
      p_user_id,
      w.id,
      'fuzzy',
      1,
      v_now + INTERVAL '1 day',
      v_now,
      NULL
    FROM unnest(p_completed_word_ids) AS w(id)
    WHERE w.id IS NOT NULL
    ON CONFLICT (user_id, vocabulary_item_id) DO UPDATE SET
      memory_state = CASE WHEN public.review_states.memory_state = 'new' THEN 'fuzzy' ELSE public.review_states.memory_state END,
      interval_days = CASE WHEN public.review_states.memory_state = 'new' THEN 1 ELSE public.review_states.interval_days END,
      next_review_at = CASE WHEN public.review_states.next_review_at IS NULL THEN v_now + INTERVAL '1 day' ELSE public.review_states.next_review_at END,
      last_reviewed_at = COALESCE(public.review_states.last_reviewed_at, v_now);

    -- Cascade remove from user_saved_words
    DELETE FROM public.user_saved_words
    WHERE user_id = p_user_id
      AND vocabulary_item_id = ANY(p_completed_word_ids);
  END IF;

  -- 2. Mark learning group completed and clear session pointers
  UPDATE public.learning_groups
  SET
    status = 'completed',
    completed_at = COALESCE(completed_at, v_now),
    session_round = NULL,
    session_current_index = NULL,
    session_queue_word_ids = NULL,
    session_passed_queue_indices = NULL,
    session_round1_confirmed_word_ids = NULL,
    session_last_active_at = NULL
  WHERE id = p_learning_group_id AND user_id = p_user_id;

  -- 3. Atomically update daily_routine_progress
  SELECT id, step_order_json, completed_steps_json, status
  INTO v_routine_id, v_step_order, v_completed_steps, v_new_routine_status
  FROM public.daily_routine_progress
  WHERE user_id = p_user_id AND local_date = v_local_date;

  IF NOT FOUND THEN
    SELECT COUNT(*) INTO v_starting_due_count
    FROM public.review_states
    WHERE user_id = p_user_id
      AND memory_state <> 'mastered'
      AND next_review_at IS NOT NULL
      AND next_review_at <= v_now;

    IF v_starting_due_count > 0 THEN
      v_day_kind := 'review_day';
      v_step_order := '["review", "round1", "round2", "round3"]'::jsonb;
      v_completed_steps := '["round1", "round2", "round3"]'::jsonb;
      v_new_routine_status := 'in_progress';
    ELSE
      v_day_kind := 'learning_day';
      v_step_order := '["round1", "round2", "round3"]'::jsonb;
      v_completed_steps := '["round1", "round2", "round3"]'::jsonb;
      v_new_routine_status := 'completed';
    END IF;

    INSERT INTO public.daily_routine_progress (
      user_id,
      local_date,
      timezone,
      day_kind,
      starting_due_count,
      main_learning_group_id,
      step_order_json,
      completed_steps_json,
      status
    )
    VALUES (
      p_user_id,
      v_local_date,
      COALESCE(p_time_zone, 'UTC'),
      v_day_kind,
      v_starting_due_count,
      p_learning_group_id,
      v_step_order,
      v_completed_steps,
      v_new_routine_status
    );
  ELSE
    -- Merge completed steps preserving step_order sequence
    WITH current_completed AS (
      SELECT jsonb_array_elements_text(COALESCE(v_completed_steps, '[]'::jsonb)) AS step
    ),
    target_completed AS (
      SELECT step FROM current_completed
      UNION
      SELECT unnest(ARRAY['round1', 'round2', 'round3']) AS step
    ),
    ordered_steps AS (
      SELECT s.step
      FROM jsonb_array_elements_text(v_step_order) WITH ORDINALITY AS s(step, ord)
      WHERE s.step IN (SELECT step FROM target_completed)
      ORDER BY s.ord
    )
    SELECT COALESCE(jsonb_agg(step), '[]'::jsonb)
    INTO v_completed_steps
    FROM ordered_steps;

    -- Check if all steps in step_order are completed
    SELECT (jsonb_array_length(v_step_order) = jsonb_array_length(v_completed_steps))
    INTO v_all_steps_done;

    IF v_all_steps_done THEN
      v_new_routine_status := 'completed';
    ELSE
      v_new_routine_status := 'in_progress';
    END IF;

    UPDATE public.daily_routine_progress
    SET
      completed_steps_json = v_completed_steps,
      main_learning_group_id = COALESCE(main_learning_group_id, p_learning_group_id),
      status = v_new_routine_status,
      updated_at = v_now
    WHERE id = v_routine_id;
  END IF;

  -- 4. Atomically upsert daily_user_statistics
  INSERT INTO public.daily_user_statistics (
    user_id,
    date_key,
    learned_word_count,
    is_routine_finished,
    updated_at
  )
  VALUES (
    p_user_id,
    v_local_date,
    v_newly_learned_words,
    (v_new_routine_status = 'completed'),
    v_now
  )
  ON CONFLICT (user_id, date_key) DO UPDATE SET
    learned_word_count = public.daily_user_statistics.learned_word_count + EXCLUDED.learned_word_count,
    is_routine_finished = public.daily_user_statistics.is_routine_finished OR EXCLUDED.is_routine_finished,
    updated_at = v_now;

  RETURN jsonb_build_object(
    'success', true,
    'group_id', p_learning_group_id,
    'updated_count', v_total_updated_words,
    'newly_learned_count', v_newly_learned_words,
    'routine_status', v_new_routine_status,
    'is_routine_finished', (v_new_routine_status = 'completed')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_learning_group_atomic(TEXT, UUID, UUID[], TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_learning_group_atomic(TEXT, UUID, UUID[], TEXT, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_learning_group_atomic(TEXT, UUID, UUID[], TEXT, DATE) TO service_role;
