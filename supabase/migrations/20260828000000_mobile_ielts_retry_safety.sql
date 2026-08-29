BEGIN;

CREATE OR REPLACE FUNCTION public.submit_ielts_listening_attempt(p_user_id text, p_test_id uuid, p_started_at timestamp with time zone, p_submitted_at timestamp with time zone, p_elapsed_seconds integer, p_score integer, p_total_questions integer, p_responses jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt_id UUID;
BEGIN
  IF nullif(trim(coalesce(p_user_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'p_responses must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_responses) AS responses(value)
    WHERE jsonb_typeof(responses.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_responses must contain only JSON objects';
  END IF;

  -- A study run has a stable started_at; serialize retries before inserting.
  PERFORM pg_advisory_xact_lock(hashtextextended('ielts:listening:' || p_user_id || ':' || p_test_id::text || ':' || extract(epoch from p_started_at)::text, 0));
  SELECT id INTO v_attempt_id
  FROM public.ielts_listening_attempts
  WHERE user_id = p_user_id AND test_id = p_test_id AND started_at = p_started_at
  ORDER BY created_at ASC LIMIT 1;
  IF v_attempt_id IS NOT NULL THEN
    RETURN v_attempt_id;
  END IF;

  INSERT INTO public.ielts_listening_attempts (
    user_id,
    test_id,
    status,
    started_at,
    submitted_at,
    elapsed_seconds,
    score,
    total_questions
  )
  VALUES (
    p_user_id,
    p_test_id,
    'submitted',
    p_started_at,
    p_submitted_at,
    p_elapsed_seconds,
    p_score,
    p_total_questions
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.ielts_listening_responses (
    attempt_id,
    question_id,
    question_number,
    response_json,
    is_correct,
    correct_answer_json
  )
  SELECT
    v_attempt_id,
    (response.value->>'questionId')::UUID,
    (response.value->>'questionNumber')::INTEGER,
    COALESCE(response.value->'response', '[]'::jsonb),
    COALESCE((response.value->>'isCorrect')::BOOLEAN, false),
    COALESCE(response.value->'correctAnswer', '[]'::jsonb)
  FROM jsonb_array_elements(p_responses) AS response(value);

  RETURN v_attempt_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_ielts_reading_attempt(p_user_id text, p_test_id uuid, p_started_at timestamp with time zone, p_submitted_at timestamp with time zone, p_elapsed_seconds integer, p_score integer, p_total_questions integer, p_responses jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_attempt_id UUID;
BEGIN
  IF nullif(trim(coalesce(p_user_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'p_responses must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_responses) AS responses(value)
    WHERE jsonb_typeof(responses.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_responses must contain only JSON objects';
  END IF;

  -- A study run has a stable started_at; serialize retries before inserting.
  PERFORM pg_advisory_xact_lock(hashtextextended('ielts:reading:' || p_user_id || ':' || p_test_id::text || ':' || extract(epoch from p_started_at)::text, 0));
  SELECT id INTO v_attempt_id
  FROM public.ielts_reading_attempts
  WHERE user_id = p_user_id AND test_id = p_test_id AND started_at = p_started_at
  ORDER BY created_at ASC LIMIT 1;
  IF v_attempt_id IS NOT NULL THEN
    RETURN v_attempt_id;
  END IF;

  INSERT INTO public.ielts_reading_attempts (
    user_id,
    test_id,
    status,
    started_at,
    submitted_at,
    elapsed_seconds,
    score,
    total_questions
  )
  VALUES (
    p_user_id,
    p_test_id,
    'submitted',
    p_started_at,
    p_submitted_at,
    p_elapsed_seconds,
    p_score,
    p_total_questions
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.ielts_reading_responses (
    attempt_id,
    question_id,
    question_number,
    response_json,
    is_correct,
    correct_answer_json
  )
  SELECT
    v_attempt_id,
    (response.value->>'questionId')::UUID,
    (response.value->>'questionNumber')::INTEGER,
    COALESCE(response.value->'response', '[]'::jsonb),
    COALESCE((response.value->>'isCorrect')::BOOLEAN, false),
    COALESCE(response.value->'correctAnswer', '[]'::jsonb)
  FROM jsonb_array_elements(p_responses) AS response(value);

  RETURN v_attempt_id;
END;
$function$;

COMMIT;
