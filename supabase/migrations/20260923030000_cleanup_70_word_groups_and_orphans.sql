-- Cleanup legacy 70-word official learning groups and orphaned review states.
-- Enforce immutable batch sizing (max 30 words per group) and calibrate word_count.

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

-- Recalibrate word_count for all system learning groups
UPDATE public.learning_groups AS lg
SET word_count = (
  SELECT COUNT(*)::INTEGER
  FROM public.learning_group_words AS lgw
  WHERE lgw.learning_group_id = lg.id
)
WHERE lg.source_type = 'system';
