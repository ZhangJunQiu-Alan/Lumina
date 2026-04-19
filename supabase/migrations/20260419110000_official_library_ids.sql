ALTER TABLE learning_groups
  ADD COLUMN IF NOT EXISTS library_id TEXT;

UPDATE learning_groups
SET library_id = 'ielts-vocab'
WHERE library_id IS NULL
  AND source_type = 'system'
  AND group_name ~ '^雅思词汇真经 · \d{4}-\d{4}$';
