ALTER TABLE learning_groups
  ADD COLUMN IF NOT EXISTS session_passed_queue_indices JSONB;
