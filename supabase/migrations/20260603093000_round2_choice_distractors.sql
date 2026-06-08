ALTER TABLE public.vocabulary_items
  ADD COLUMN IF NOT EXISTS round2_choice_distractors JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.vocabulary_items
SET round2_choice_distractors = '[]'::jsonb
WHERE round2_choice_distractors IS NULL
  OR jsonb_typeof(round2_choice_distractors) <> 'array';

ALTER TABLE public.vocabulary_items
  DROP CONSTRAINT IF EXISTS vocabulary_items_round2_choice_distractors_array_check;

ALTER TABLE public.vocabulary_items
  ADD CONSTRAINT vocabulary_items_round2_choice_distractors_array_check
  CHECK (jsonb_typeof(round2_choice_distractors) = 'array');
