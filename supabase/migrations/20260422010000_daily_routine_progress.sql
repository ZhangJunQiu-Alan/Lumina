CREATE TABLE IF NOT EXISTS daily_routine_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT DEFAULT 'demo',
  local_date DATE NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  day_kind TEXT NOT NULL,
  starting_due_count INTEGER NOT NULL DEFAULT 0,
  main_learning_group_id UUID REFERENCES learning_groups(id) ON DELETE SET NULL,
  step_order_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  completed_steps_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'not_started',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (day_kind IN ('review_day', 'learning_day')),
  CHECK (status IN ('not_started', 'in_progress', 'completed')),
  UNIQUE(user_id, local_date)
);

ALTER TABLE daily_routine_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_routine_progress_owner_select" ON daily_routine_progress
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "daily_routine_progress_owner_insert" ON daily_routine_progress
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_routine_progress_owner_update" ON daily_routine_progress
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "daily_routine_progress_owner_delete" ON daily_routine_progress
  FOR DELETE USING (auth.uid()::text = user_id);
