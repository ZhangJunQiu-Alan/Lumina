ALTER TABLE public.learning_group_words
  ADD COLUMN IF NOT EXISTS round1_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round2_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round3_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS learned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS round2_required BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS round3_required BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS learning_group_words_round1_confirmed_idx
  ON public.learning_group_words (learning_group_id, round1_confirmed_at)
  WHERE round1_confirmed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS learning_group_words_learned_idx
  ON public.learning_group_words (learning_group_id, learned_at)
  WHERE learned_at IS NOT NULL;

-- Backfill the new per-word progress from the legacy session snapshot.
WITH confirmed AS (
  SELECT
    lg.id AS learning_group_id,
    item.word_id::UUID AS vocabulary_item_id,
    COALESCE(lg.session_last_active_at, lg.created_at, NOW()) AS confirmed_at
  FROM public.learning_groups AS lg
  CROSS JOIN LATERAL jsonb_array_elements_text(lg.session_round1_confirmed_word_ids) AS item(word_id)
  WHERE jsonb_typeof(lg.session_round1_confirmed_word_ids) = 'array'
    AND item.word_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
UPDATE public.learning_group_words AS lgw
SET
  round1_confirmed_at = COALESCE(lgw.round1_confirmed_at, confirmed.confirmed_at),
  round2_required = COALESCE(lgw.round2_required, TRUE),
  round3_required = COALESCE(lgw.round3_required, TRUE)
FROM confirmed
WHERE lgw.learning_group_id = confirmed.learning_group_id
  AND lgw.vocabulary_item_id = confirmed.vocabulary_item_id;

-- Historical completed groups did not have per-word progress. Treat their
-- stored words as learned because that was the only state available before
-- per-word tracking existed.
UPDATE public.learning_group_words AS lgw
SET
  round1_confirmed_at = COALESCE(lgw.round1_confirmed_at, COALESCE(lg.completed_at, lg.session_last_active_at, lg.created_at, NOW())),
  round2_completed_at = COALESCE(lgw.round2_completed_at, COALESCE(lg.completed_at, lg.session_last_active_at, lg.created_at, NOW())),
  round3_completed_at = COALESCE(lgw.round3_completed_at, COALESCE(lg.completed_at, lg.session_last_active_at, lg.created_at, NOW())),
  learned_at = COALESCE(lgw.learned_at, COALESCE(lg.completed_at, lg.session_last_active_at, lg.created_at, NOW()))
FROM public.learning_groups AS lg
WHERE lgw.learning_group_id = lg.id
  AND lg.status = 'completed';

WITH latest_dictation AS (
  SELECT
    learning_group_id,
    vocabulary_item_id,
    MAX(created_at) AS completed_at
  FROM public.review_events
  WHERE learning_group_id IS NOT NULL
    AND source IN ('round2', 'round3')
    AND was_correct = TRUE
  GROUP BY learning_group_id, vocabulary_item_id
)
UPDATE public.learning_group_words AS lgw
SET round3_completed_at = COALESCE(lgw.round3_completed_at, latest_dictation.completed_at)
FROM latest_dictation
WHERE lgw.learning_group_id = latest_dictation.learning_group_id
  AND lgw.vocabulary_item_id = latest_dictation.vocabulary_item_id;

UPDATE public.learning_group_words
SET learned_at = COALESCE(
  learned_at,
  GREATEST(
    round1_confirmed_at,
    COALESCE(round2_completed_at, round1_confirmed_at),
    COALESCE(round3_completed_at, round1_confirmed_at)
  )
)
WHERE round1_confirmed_at IS NOT NULL
  AND (round2_required = FALSE OR round2_completed_at IS NOT NULL)
  AND (round3_required = FALSE OR round3_completed_at IS NOT NULL);

CREATE OR REPLACE FUNCTION public.mark_learning_group_word_progress(
  p_learning_group_id UUID,
  p_vocabulary_item_ids UUID[],
  p_round TEXT,
  p_round2_required BOOLEAN DEFAULT TRUE,
  p_round3_required BOOLEAN DEFAULT TRUE
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id TEXT := auth.uid()::TEXT;
  v_now TIMESTAMPTZ := NOW();
  v_next_review_at TIMESTAMPTZ := v_now + INTERVAL '1 day';
  v_expected_count INTEGER;
  v_updated_count INTEGER;
  v_learned_count INTEGER;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_round NOT IN ('round1', 'round2', 'round3') THEN
    RAISE EXCEPTION 'Invalid learning round: %', p_round;
  END IF;

  SELECT COUNT(DISTINCT item.vocabulary_item_id)
  INTO v_expected_count
  FROM unnest(COALESCE(p_vocabulary_item_ids, ARRAY[]::UUID[])) AS item(vocabulary_item_id)
  WHERE item.vocabulary_item_id IS NOT NULL;

  IF v_expected_count = 0 THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.learning_groups AS lg
    WHERE lg.id = p_learning_group_id
      AND lg.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Learning group not found';
  END IF;

  WITH input_ids AS (
    SELECT DISTINCT item.vocabulary_item_id
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
    WHERE item.vocabulary_item_id IS NOT NULL
  ),
  updated AS (
    UPDATE public.learning_group_words AS lgw
    SET
      round1_confirmed_at = CASE
        WHEN p_round = 'round1' THEN COALESCE(lgw.round1_confirmed_at, v_now)
        ELSE lgw.round1_confirmed_at
      END,
      round2_completed_at = CASE
        WHEN p_round = 'round2' THEN COALESCE(lgw.round2_completed_at, v_now)
        ELSE lgw.round2_completed_at
      END,
      round3_completed_at = CASE
        WHEN p_round = 'round3' THEN COALESCE(lgw.round3_completed_at, v_now)
        ELSE lgw.round3_completed_at
      END,
      round2_required = CASE
        WHEN p_round = 'round1' THEN p_round2_required
        ELSE lgw.round2_required
      END,
      round3_required = CASE
        WHEN p_round = 'round1' THEN p_round3_required
        ELSE lgw.round3_required
      END
    FROM input_ids
    WHERE lgw.learning_group_id = p_learning_group_id
      AND lgw.vocabulary_item_id = input_ids.vocabulary_item_id
    RETURNING lgw.vocabulary_item_id
  )
  SELECT COUNT(*) INTO v_updated_count FROM updated;

  IF v_updated_count <> v_expected_count THEN
    RAISE EXCEPTION 'Some vocabulary items do not belong to this learning group';
  END IF;

  WITH input_ids AS (
    SELECT DISTINCT item.vocabulary_item_id
    FROM unnest(p_vocabulary_item_ids) AS item(vocabulary_item_id)
    WHERE item.vocabulary_item_id IS NOT NULL
  ),
  learned AS (
    UPDATE public.learning_group_words AS lgw
    SET learned_at = COALESCE(lgw.learned_at, v_now)
    FROM input_ids
    WHERE lgw.learning_group_id = p_learning_group_id
      AND lgw.vocabulary_item_id = input_ids.vocabulary_item_id
      AND lgw.round1_confirmed_at IS NOT NULL
      AND (lgw.round2_required = FALSE OR lgw.round2_completed_at IS NOT NULL)
      AND (lgw.round3_required = FALSE OR lgw.round3_completed_at IS NOT NULL)
    RETURNING lgw.vocabulary_item_id
  ),
  activated_existing AS (
    UPDATE public.review_states AS rs
    SET
      memory_state = 'fuzzy',
      interval_days = 1,
      next_review_at = v_next_review_at,
      last_reviewed_at = COALESCE(rs.last_reviewed_at, v_now),
      graduated_at = NULL
    FROM learned
    WHERE rs.user_id = v_user_id
      AND rs.vocabulary_item_id = learned.vocabulary_item_id
      AND rs.memory_state = 'new'
      AND rs.next_review_at IS NULL
    RETURNING rs.vocabulary_item_id
  ),
  inserted AS (
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
      v_user_id,
      learned.vocabulary_item_id,
      'fuzzy',
      1,
      v_next_review_at,
      v_now,
      NULL
    FROM learned
    ON CONFLICT (user_id, vocabulary_item_id) DO NOTHING
    RETURNING vocabulary_item_id
  )
  SELECT COUNT(*) INTO v_learned_count FROM learned;

  RETURN COALESCE(v_learned_count, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.mark_learning_group_word_progress(UUID, UUID[], TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_learning_group_word_progress(UUID, UUID[], TEXT, BOOLEAN, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_learning_group_word_progress(UUID, UUID[], TEXT, BOOLEAN, BOOLEAN) TO service_role;
