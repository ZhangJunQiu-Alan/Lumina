ALTER TABLE ielts_listening_sections
  ADD COLUMN IF NOT EXISTS paper_pages_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE ielts_listening_questions
  ADD COLUMN IF NOT EXISTS paper_hotspot_json JSONB;
