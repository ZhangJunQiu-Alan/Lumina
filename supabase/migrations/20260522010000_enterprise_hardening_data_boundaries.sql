ALTER TABLE public.vocabulary_items
  ADD COLUMN IF NOT EXISTS audio_uk_url TEXT,
  ADD COLUMN IF NOT EXISTS audio_us_url TEXT;

DROP POLICY IF EXISTS "public_all" ON public.vocabulary_items;
DROP POLICY IF EXISTS "public_all" ON public.vocabulary_senses;
DROP POLICY IF EXISTS "public_all" ON public.vocabulary_item_forms;
DROP POLICY IF EXISTS "public_all" ON public.vocabulary_morphology_parts;
DROP POLICY IF EXISTS "public_all" ON public.vocabulary_relations;
DROP POLICY IF EXISTS "public_all" ON public.confused_words;

DROP POLICY IF EXISTS "vocabulary_items_authenticated_select" ON public.vocabulary_items;
CREATE POLICY "vocabulary_items_authenticated_select" ON public.vocabulary_items
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "vocabulary_senses_authenticated_select" ON public.vocabulary_senses;
CREATE POLICY "vocabulary_senses_authenticated_select" ON public.vocabulary_senses
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "vocabulary_item_forms_authenticated_select" ON public.vocabulary_item_forms;
CREATE POLICY "vocabulary_item_forms_authenticated_select" ON public.vocabulary_item_forms
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "vocabulary_morphology_parts_authenticated_select" ON public.vocabulary_morphology_parts;
CREATE POLICY "vocabulary_morphology_parts_authenticated_select" ON public.vocabulary_morphology_parts
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "vocabulary_relations_authenticated_select" ON public.vocabulary_relations;
CREATE POLICY "vocabulary_relations_authenticated_select" ON public.vocabulary_relations
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

DROP POLICY IF EXISTS "confused_words_authenticated_select" ON public.confused_words;
CREATE POLICY "confused_words_authenticated_select" ON public.confused_words
  FOR SELECT USING ((SELECT auth.uid()) IS NOT NULL);

CREATE OR REPLACE FUNCTION public.persist_vocabulary_entries(
  p_entries JSONB,
  p_source_type TEXT DEFAULT 'custom'
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entry JSONB;
  v_item_id UUID;
  v_word TEXT;
  v_source_type TEXT := CASE WHEN p_source_type = 'system' THEN 'system' ELSE 'custom' END;
BEGIN
  IF p_entries IS NULL OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'p_entries must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_entries) AS entries(value)
    WHERE jsonb_typeof(entries.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_entries must contain only JSON objects';
  END IF;

  FOR entry IN SELECT value FROM jsonb_array_elements(p_entries)
  LOOP
    v_word := lower(trim(regexp_replace(coalesce(entry->>'word', ''), '\s+', ' ', 'g')));

    IF v_word = '' THEN
      RAISE EXCEPTION 'Vocabulary entry word is required';
    END IF;

    INSERT INTO public.vocabulary_items (
      word,
      ipa_uk,
      ipa_us,
      primary_meaning_zh,
      ner_label,
      morphology_summary_zh,
      memory_tip,
      source_type,
      enrichment_level
    )
    VALUES (
      v_word,
      entry->>'ipa_uk',
      entry->>'ipa_us',
      entry->>'primary_meaning_zh',
      entry->>'ner_label',
      entry #>> '{morphology,summary_zh}',
      entry->>'memory_tip',
      v_source_type,
      'full'
    )
    ON CONFLICT (word) DO UPDATE
    SET
      ipa_uk = EXCLUDED.ipa_uk,
      ipa_us = EXCLUDED.ipa_us,
      primary_meaning_zh = EXCLUDED.primary_meaning_zh,
      ner_label = EXCLUDED.ner_label,
      morphology_summary_zh = EXCLUDED.morphology_summary_zh,
      memory_tip = EXCLUDED.memory_tip,
      source_type = COALESCE(public.vocabulary_items.source_type, EXCLUDED.source_type),
      enrichment_level = 'full'
    RETURNING id INTO v_item_id;

    DELETE FROM public.vocabulary_senses
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.vocabulary_senses (
      vocabulary_item_id,
      pos,
      meaning_zh,
      usage_note,
      example_sentence,
      example_translation_zh
    )
    SELECT
      v_item_id,
      NULLIF(trim(sense.value->>'pos'), ''),
      NULLIF(trim(sense.value->>'meaning_zh'), ''),
      NULLIF(trim(sense.value->>'usage_note'), ''),
      NULLIF(trim(sense.value->>'example_sentence'), ''),
      NULLIF(trim(sense.value->>'example_translation_zh'), '')
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry->'senses') = 'array' THEN entry->'senses' ELSE '[]'::jsonb END
    ) AS sense(value);

    DELETE FROM public.vocabulary_morphology_parts
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.vocabulary_morphology_parts (
      vocabulary_item_id,
      part_text,
      part_kind,
      meaning_zh,
      note_zh,
      sort_order
    )
    SELECT
      v_item_id,
      NULLIF(trim(part.value->>'text'), ''),
      NULLIF(trim(part.value->>'kind'), ''),
      NULLIF(trim(part.value->>'meaning_zh'), ''),
      NULLIF(trim(part.value->>'note_zh'), ''),
      part.ordinality::INTEGER - 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry #> '{morphology,parts}') = 'array' THEN entry #> '{morphology,parts}' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS part(value, ordinality);

    DELETE FROM public.vocabulary_relations
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.vocabulary_relations (
      vocabulary_item_id,
      relation_type,
      related_word,
      meaning_zh,
      note_zh,
      sort_order
    )
    SELECT
      v_item_id,
      relation_type,
      NULLIF(trim(relation.value->>'word'), ''),
      NULLIF(trim(relation.value->>'meaning_zh'), ''),
      NULLIF(trim(relation.value->>'note_zh'), ''),
      relation.ordinality::INTEGER - 1
    FROM (
      SELECT 'derived'::TEXT AS relation_type, value, ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(entry->'derived_words') = 'array' THEN entry->'derived_words' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
      UNION ALL
      SELECT 'synonym'::TEXT AS relation_type, value, ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(entry->'synonyms') = 'array' THEN entry->'synonyms' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
      UNION ALL
      SELECT 'antonym'::TEXT AS relation_type, value, ordinality
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(entry->'antonyms') = 'array' THEN entry->'antonyms' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
    ) AS relation;

    DELETE FROM public.confused_words
    WHERE vocabulary_item_id = v_item_id;

    INSERT INTO public.confused_words (
      vocabulary_item_id,
      confused_word,
      difference_note_zh,
      sort_order
    )
    SELECT
      v_item_id,
      NULLIF(trim(confusion.value->>'word'), ''),
      NULLIF(trim(confusion.value->>'difference_zh'), ''),
      confusion.ordinality::INTEGER - 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry->'confusions') = 'array' THEN entry->'confusions' ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS confusion(value, ordinality);

    INSERT INTO public.vocabulary_item_forms (
      vocabulary_item_id,
      form
    )
    SELECT DISTINCT
      v_item_id,
      lower(trim(regexp_replace(form.value #>> '{}', '\s+', ' ', 'g'))) AS form
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(entry->'forms') = 'array' THEN entry->'forms' ELSE '[]'::jsonb END
    ) AS form(value)
    WHERE lower(trim(regexp_replace(form.value #>> '{}', '\s+', ' ', 'g'))) <> ''
      AND lower(trim(regexp_replace(form.value #>> '{}', '\s+', ' ', 'g'))) <> v_word
    ON CONFLICT (form) DO NOTHING;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_vocabulary_entries(JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_vocabulary_entries(JSONB, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_ielts_reading_attempt(
  p_user_id TEXT,
  p_test_id UUID,
  p_started_at TIMESTAMPTZ,
  p_submitted_at TIMESTAMPTZ,
  p_elapsed_seconds INTEGER,
  p_score INTEGER,
  p_total_questions INTEGER,
  p_responses JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
BEGIN
  IF nullif(trim(coalesce(p_user_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'p_responses must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_responses) AS responses(value)
    WHERE jsonb_typeof(responses.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_responses must contain only JSON objects';
  END IF;

  INSERT INTO public.ielts_reading_attempts (
    user_id,
    test_id,
    status,
    started_at,
    submitted_at,
    elapsed_seconds,
    score,
    total_questions
  )
  VALUES (
    p_user_id,
    p_test_id,
    'submitted',
    p_started_at,
    p_submitted_at,
    p_elapsed_seconds,
    p_score,
    p_total_questions
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.ielts_reading_responses (
    attempt_id,
    question_id,
    question_number,
    response_json,
    is_correct,
    correct_answer_json
  )
  SELECT
    v_attempt_id,
    (response.value->>'questionId')::UUID,
    (response.value->>'questionNumber')::INTEGER,
    COALESCE(response.value->'response', '[]'::jsonb),
    COALESCE((response.value->>'isCorrect')::BOOLEAN, false),
    COALESCE(response.value->'correctAnswer', '[]'::jsonb)
  FROM jsonb_array_elements(p_responses) AS response(value);

  RETURN v_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_ielts_reading_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_ielts_reading_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_ielts_listening_attempt(
  p_user_id TEXT,
  p_test_id UUID,
  p_started_at TIMESTAMPTZ,
  p_submitted_at TIMESTAMPTZ,
  p_elapsed_seconds INTEGER,
  p_score INTEGER,
  p_total_questions INTEGER,
  p_responses JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempt_id UUID;
BEGIN
  IF nullif(trim(coalesce(p_user_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  IF p_responses IS NULL OR jsonb_typeof(p_responses) <> 'array' THEN
    RAISE EXCEPTION 'p_responses must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_responses) AS responses(value)
    WHERE jsonb_typeof(responses.value) <> 'object'
  ) THEN
    RAISE EXCEPTION 'p_responses must contain only JSON objects';
  END IF;

  INSERT INTO public.ielts_listening_attempts (
    user_id,
    test_id,
    status,
    started_at,
    submitted_at,
    elapsed_seconds,
    score,
    total_questions
  )
  VALUES (
    p_user_id,
    p_test_id,
    'submitted',
    p_started_at,
    p_submitted_at,
    p_elapsed_seconds,
    p_score,
    p_total_questions
  )
  RETURNING id INTO v_attempt_id;

  INSERT INTO public.ielts_listening_responses (
    attempt_id,
    question_id,
    question_number,
    response_json,
    is_correct,
    correct_answer_json
  )
  SELECT
    v_attempt_id,
    (response.value->>'questionId')::UUID,
    (response.value->>'questionNumber')::INTEGER,
    COALESCE(response.value->'response', '[]'::jsonb),
    COALESCE((response.value->>'isCorrect')::BOOLEAN, false),
    COALESCE(response.value->'correctAnswer', '[]'::jsonb)
  FROM jsonb_array_elements(p_responses) AS response(value);

  RETURN v_attempt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_ielts_listening_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_ielts_listening_attempt(TEXT, UUID, TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, INTEGER, JSONB) TO service_role;
