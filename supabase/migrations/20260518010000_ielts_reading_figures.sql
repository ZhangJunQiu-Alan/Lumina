CREATE TABLE IF NOT EXISTS ielts_reading_passage_figures (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  passage_id   UUID NOT NULL REFERENCES ielts_reading_passages(id) ON DELETE CASCADE,
  figure_key   TEXT NOT NULL,
  title        TEXT NOT NULL,
  caption      TEXT NOT NULL DEFAULT '',
  image_url    TEXT,
  storage_path TEXT,
  pdf_page     INTEGER,
  crop_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  anchor_text  TEXT,
  fallback_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(passage_id, figure_key),
  CHECK (figure_key <> ''),
  CHECK (title <> ''),
  CHECK (pdf_page IS NULL OR pdf_page > 0)
);

CREATE INDEX IF NOT EXISTS ielts_reading_figures_passage_idx
  ON ielts_reading_passage_figures (passage_id, sort_order);

ALTER TABLE ielts_reading_passage_figures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ielts_reading_figures_authenticated_select" ON ielts_reading_passage_figures;
CREATE POLICY "ielts_reading_figures_authenticated_select" ON ielts_reading_passage_figures
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "ielts_reading_figure_objects_authenticated_select" ON storage.objects;
CREATE POLICY "ielts_reading_figure_objects_authenticated_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'ielts-reading-figures'
    AND auth.uid() IS NOT NULL
  );
