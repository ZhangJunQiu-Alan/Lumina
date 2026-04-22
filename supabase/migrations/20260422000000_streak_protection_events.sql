CREATE TABLE IF NOT EXISTS streak_protection_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT DEFAULT 'demo',
  protected_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, protected_date)
);

ALTER TABLE streak_protection_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "streak_protection_events_owner_select" ON streak_protection_events
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "streak_protection_events_owner_insert" ON streak_protection_events
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "streak_protection_events_owner_update" ON streak_protection_events
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "streak_protection_events_owner_delete" ON streak_protection_events
  FOR DELETE USING (auth.uid()::text = user_id);
