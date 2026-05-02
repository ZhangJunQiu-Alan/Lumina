ALTER TABLE vocabulary_items
  ADD COLUMN IF NOT EXISTS enrichment_level TEXT;

UPDATE vocabulary_items
SET enrichment_level = 'full'
WHERE enrichment_level IS NULL;

ALTER TABLE vocabulary_items
  ALTER COLUMN enrichment_level SET DEFAULT 'full',
  ALTER COLUMN enrichment_level SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'vocabulary_items_enrichment_level_check'
  ) THEN
    ALTER TABLE vocabulary_items
      ADD CONSTRAINT vocabulary_items_enrichment_level_check
      CHECK (enrichment_level IN ('lite', 'full'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS vocabulary_item_forms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  form                  TEXT NOT NULL,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(form)
);

CREATE INDEX IF NOT EXISTS vocabulary_item_forms_form_idx
  ON vocabulary_item_forms (form);

ALTER TABLE vocabulary_item_forms ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vocabulary_item_forms'
      AND policyname = 'public_all'
  ) THEN
    CREATE POLICY "public_all" ON vocabulary_item_forms FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS user_saved_words (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               TEXT NOT NULL,
  vocabulary_item_id    UUID NOT NULL REFERENCES vocabulary_items(id) ON DELETE CASCADE,
  source                TEXT NOT NULL DEFAULT 'manual',
  saved_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, vocabulary_item_id),
  CHECK (source IN ('import', 'reading_popup', 'manual', 'migration'))
);

CREATE INDEX IF NOT EXISTS user_saved_words_user_idx
  ON user_saved_words (user_id, saved_at DESC);

ALTER TABLE user_saved_words ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_saved_words'
      AND policyname = 'user_saved_words_owner_select'
  ) THEN
    CREATE POLICY "user_saved_words_owner_select" ON user_saved_words
      FOR SELECT USING (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_saved_words'
      AND policyname = 'user_saved_words_owner_insert'
  ) THEN
    CREATE POLICY "user_saved_words_owner_insert" ON user_saved_words
      FOR INSERT WITH CHECK (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_saved_words'
      AND policyname = 'user_saved_words_owner_update'
  ) THEN
    CREATE POLICY "user_saved_words_owner_update" ON user_saved_words
      FOR UPDATE USING (auth.uid()::text = user_id) WITH CHECK (auth.uid()::text = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_saved_words'
      AND policyname = 'user_saved_words_owner_delete'
  ) THEN
    CREATE POLICY "user_saved_words_owner_delete" ON user_saved_words
      FOR DELETE USING (auth.uid()::text = user_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_publication
    WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'vocabulary_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.vocabulary_items;
  END IF;
END $$;
