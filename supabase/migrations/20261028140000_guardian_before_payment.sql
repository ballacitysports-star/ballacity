-- A minor's guardian approves before the minor sends money.
--
-- A player under 16 cannot send a payment proof at all (`PAYMENTS_NOT_AVAILABLE`),
-- so this only concerns 16-17 year olds who have an active guardian. For them
-- the database already refused to put them on the roster until the guardian
-- approved the join request, and refused a payment proof until the host
-- approved a game that needs approval. Nothing asked for the guardian first, so
-- a 16-year-old could send the fee and the host could verify it, with the spot
-- then held back by the guardian's pending approval. Found by the SQL test
-- 240_minor_pay_after_parent.
--
-- This BEFORE INSERT trigger refuses a payment proof from a player with an
-- active guardian link unless a request for that game from that player has
-- `guardian_approved_at` set. A player with no guardian (an adult) is not
-- affected, and neither is server code (auth.uid() IS NULL). Existing rows are
-- untouched.
--
-- ROLLBACK: DROP TRIGGER payment_submissions_guardian_first ON public.payment_submissions;
-- DROP FUNCTION public.enforce_guardian_before_payment(); no data changes.

CREATE OR REPLACE FUNCTION public.enforce_guardian_before_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NEW.player_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.guardian_links gl
     WHERE gl.child_user_id = NEW.player_id AND gl.status = 'active'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.join_requests jr
     WHERE jr.game_id = NEW.game_id
       AND jr.player_id = NEW.player_id
       AND jr.guardian_approved_at IS NOT NULL
       AND jr.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.enforce_guardian_before_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_submissions_guardian_first ON public.payment_submissions;
CREATE TRIGGER payment_submissions_guardian_first
  BEFORE INSERT ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_guardian_before_payment();
