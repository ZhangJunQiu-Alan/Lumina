CREATE OR REPLACE FUNCTION public.review_at_local_nine(p_user_id TEXT, p_due TIMESTAMPTZ)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_zone TEXT;
BEGIN
  IF p_due IS NULL OR p_due <= NOW() THEN RETURN p_due; END IF;
  SELECT timezone INTO v_zone FROM public.daily_routine_progress
  WHERE user_id = p_user_id ORDER BY local_date DESC, updated_at DESC LIMIT 1;
  IF v_zone IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_zone) THEN
    v_zone := 'UTC';
  END IF;
  RETURN ((p_due AT TIME ZONE v_zone)::DATE + TIME '09:00') AT TIME ZONE v_zone;
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_review_morning()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  NEW.next_review_at := public.review_at_local_nine(NEW.user_id, NEW.next_review_at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.review_at_local_nine(TEXT, TIMESTAMPTZ) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.normalize_review_morning() FROM PUBLIC;

CREATE TRIGGER normalize_review_morning
BEFORE INSERT OR UPDATE OF next_review_at ON public.review_states
FOR EACH ROW EXECUTE FUNCTION public.normalize_review_morning();

CREATE TRIGGER normalize_review_event_morning
BEFORE INSERT ON public.review_events
FOR EACH ROW EXECUTE FUNCTION public.normalize_review_morning();

UPDATE public.review_states
SET next_review_at = public.review_at_local_nine(user_id, next_review_at)
WHERE next_review_at > NOW() AND memory_state <> 'mastered';
