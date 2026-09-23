CREATE OR REPLACE FUNCTION public.remove_learned_saved_word()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.user_saved_words AS saved
  USING public.learning_groups AS learning_group
  WHERE learning_group.id = NEW.learning_group_id
    AND learning_group.source_type = 'custom'
    AND saved.user_id = learning_group.user_id
    AND saved.vocabulary_item_id = NEW.vocabulary_item_id
    AND saved.saved_at <= NEW.learned_at;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_learned_saved_word() FROM PUBLIC;

CREATE TRIGGER remove_learned_saved_word
AFTER INSERT OR UPDATE OF learned_at ON public.learning_group_words
FOR EACH ROW
WHEN (NEW.learned_at IS NOT NULL)
EXECUTE FUNCTION public.remove_learned_saved_word();
