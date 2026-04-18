ALTER TABLE vocabulary_items
  ADD COLUMN IF NOT EXISTS morphology_summary_zh TEXT;

ALTER TABLE confused_words
  ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS vocabulary_morphology_parts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  part_text             TEXT,
  part_kind             TEXT,
  meaning_zh            TEXT,
  note_zh               TEXT,
  sort_order            INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vocabulary_relations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  relation_type         TEXT NOT NULL,
  related_word          TEXT,
  meaning_zh            TEXT,
  note_zh               TEXT,
  sort_order            INTEGER DEFAULT 0
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vocabulary_morphology_parts_part_kind_check'
  ) THEN
    ALTER TABLE vocabulary_morphology_parts
      ADD CONSTRAINT vocabulary_morphology_parts_part_kind_check
      CHECK (part_kind IN ('prefix', 'root', 'suffix'));
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vocabulary_relations_relation_type_check'
  ) THEN
    ALTER TABLE vocabulary_relations
      ADD CONSTRAINT vocabulary_relations_relation_type_check
      CHECK (relation_type IN ('derived', 'synonym', 'antonym'));
  END IF;
END $$;

ALTER TABLE vocabulary_morphology_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_relations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vocabulary_morphology_parts'
      AND policyname = 'public_all'
  ) THEN
    CREATE POLICY "public_all" ON vocabulary_morphology_parts FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vocabulary_relations'
      AND policyname = 'public_all'
  ) THEN
    CREATE POLICY "public_all" ON vocabulary_relations FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
