
CREATE OR REPLACE FUNCTION public.enforce_approval_before_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _requires_approval boolean;
  _is_approved boolean;
BEGIN
  SELECT requires_approval INTO _requires_approval
  FROM public.game_payment_settings
  WHERE game_id = NEW.game_id AND host_id = NEW.host_id
  LIMIT 1;

  IF COALESCE(_requires_approval, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.join_requests
      WHERE game_id = NEW.game_id
        AND player_id = NEW.player_id
        AND status = 'approved'
    ) INTO _is_approved;

    IF NOT _is_approved THEN
      RAISE EXCEPTION 'Host approval required before payment can be submitted for this game.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_approval_before_payment_trg ON public.payment_submissions;
CREATE TRIGGER enforce_approval_before_payment_trg
BEFORE INSERT ON public.payment_submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_before_payment();
