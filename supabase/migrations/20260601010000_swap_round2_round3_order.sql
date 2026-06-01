ALTER TABLE public.review_events
  DROP CONSTRAINT IF EXISTS review_events_source_check;

ALTER TABLE public.review_events
  ADD CONSTRAINT review_events_source_check
  CHECK (source IN ('round2', 'round3', 'review', 'manual_mastered'));

-- Dictation attempts used to be stored as source = round2. After the round
-- order swap, dictation is Round 3, so historical attempts move with it.
UPDATE public.review_events
SET source = 'round3'
WHERE source = 'round2';

-- Completed old Round 3 sessions represented recall after dictation. They are
-- no longer the active dictation round, so keep them as final reinforcement.
UPDATE public.learning_groups
SET session_round = 'article'
WHERE session_round = 'round3'
  AND status = 'completed';

-- If a legacy active Round 3 slipped through without completed_at, close it as
-- completed reinforcement instead of reopening it as the new dictation round.
UPDATE public.learning_groups
SET
  status = 'completed',
  completed_at = COALESCE(completed_at, NOW()),
  session_round = 'article'
WHERE session_round = 'round3'
  AND status = 'active'
  AND completed_at IS NULL;

-- Active Round 2 sessions were previously dictation sessions. Resume them as
-- Round 3 so users continue the same task after deployment.
UPDATE public.learning_groups
SET session_round = 'round3'
WHERE session_round = 'round2'
  AND status = 'active'
  AND completed_at IS NULL;

UPDATE public.daily_routine_progress
SET step_order_json = CASE
  WHEN step_order_json = '["review", "round1", "round2"]'::jsonb
    THEN '["review", "round1", "round2", "round3"]'::jsonb
  WHEN step_order_json = '["round1", "round2"]'::jsonb
    THEN '["round1", "round2", "round3"]'::jsonb
  ELSE step_order_json || '["round3"]'::jsonb
END
WHERE jsonb_typeof(step_order_json) = 'array'
  AND step_order_json ? 'round2'
  AND NOT (step_order_json ? 'round3');

UPDATE public.daily_routine_progress
SET completed_steps_json = completed_steps_json || '["round3"]'::jsonb
WHERE status = 'completed'
  AND jsonb_typeof(completed_steps_json) = 'array'
  AND completed_steps_json ? 'round2'
  AND NOT (completed_steps_json ? 'round3');
