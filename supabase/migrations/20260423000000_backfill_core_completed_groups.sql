UPDATE learning_groups
SET
  status = 'completed',
  completed_at = COALESCE(completed_at, session_last_active_at, created_at, NOW())
WHERE COALESCE(status, 'active') <> 'completed'
  AND session_round IN ('round3', 'article');
