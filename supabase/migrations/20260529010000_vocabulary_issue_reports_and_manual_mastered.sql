ALTER TABLE review_events
  DROP CONSTRAINT IF EXISTS review_events_source_check;

ALTER TABLE review_events
  ADD CONSTRAINT review_events_source_check
  CHECK (source IN ('round2', 'review', 'manual_mastered'));

CREATE TABLE IF NOT EXISTS vocabulary_issue_reports (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            TEXT NOT NULL,
  vocabulary_item_id UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  word_snapshot      TEXT,
  learning_group_id  UUID REFERENCES learning_groups(id) ON DELETE SET NULL,
  session_round      TEXT,
  issue_type         TEXT NOT NULL,
  note               TEXT,
  route_path         TEXT,
  user_agent         TEXT,
  status             TEXT NOT NULL DEFAULT 'open',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (issue_type IN ('definition', 'example', 'pronunciation', 'other')),
  CHECK (status IN ('open', 'reviewing', 'resolved', 'ignored')),
  CHECK (session_round IS NULL OR session_round IN ('review', 'round1', 'round2', 'round3', 'article'))
);

CREATE INDEX IF NOT EXISTS vocabulary_issue_reports_status_idx
  ON vocabulary_issue_reports (status, created_at DESC);

CREATE INDEX IF NOT EXISTS vocabulary_issue_reports_user_idx
  ON vocabulary_issue_reports (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS vocabulary_issue_reports_vocabulary_item_idx
  ON vocabulary_issue_reports (vocabulary_item_id, created_at DESC);

ALTER TABLE vocabulary_issue_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vocabulary_issue_reports_owner_select" ON vocabulary_issue_reports;
DROP POLICY IF EXISTS "vocabulary_issue_reports_owner_insert" ON vocabulary_issue_reports;
DROP POLICY IF EXISTS "vocabulary_issue_reports_owner_update" ON vocabulary_issue_reports;
DROP POLICY IF EXISTS "vocabulary_issue_reports_owner_delete" ON vocabulary_issue_reports;

CREATE POLICY "vocabulary_issue_reports_owner_select" ON vocabulary_issue_reports
  FOR SELECT USING (auth.uid()::text = user_id);
CREATE POLICY "vocabulary_issue_reports_owner_insert" ON vocabulary_issue_reports
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "vocabulary_issue_reports_owner_update" ON vocabulary_issue_reports
  FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
CREATE POLICY "vocabulary_issue_reports_owner_delete" ON vocabulary_issue_reports
  FOR DELETE USING (auth.uid()::text = user_id);
