-- ROLLBACK for supabase/migrations/20261111100000_paypal_guardian_rule.sql (audit F03 follow-up).
-- NOT a migration. It drops the function the server asks before creating or capturing a PayPal order, and puts back
-- enforce_guardian_before_payment as 20261110120000 defines it (the trigger behaves the same either way).
-- Roll back the app change first: the server's check fails closed, so with the function gone nobody could pay by
-- PayPal. With both rolled back, a child who needs a guardian's approval can again pay by PayPal checkout without one.
-- Run this before 20261110120000's rollback, never after, and after 20261111140000's (each guard below enforces its
-- half of that order).
-- It refuses to run unless:
--     PGOPTIONS="-c app.confirm_paypal_guardian_rollback=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_paypal_guardian_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets a minor pay by PayPal without a guardian''s approval. Set app.confirm_paypal_guardian_rollback=yes for the session to proceed deliberately.';
  END IF;
  -- The trigger restored below calls 20261110120000's guardian_approval_valid. Run this rollback before that
  -- migration's, never after: its own rollback refuses while this migration is applied.
  IF to_regprocedure('private_sec.guardian_approval_valid(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to run: 20261110120000_guardian_approval_validity is no longer applied, and the trigger this restores calls its guardian_approval_valid.';
  END IF;
  -- 20261111140000's payment check calls game_payment_guardian_ready, which this drops. Roll that one back first.
  IF to_regprocedure('private_sec.paypal_payment_block(text)') IS NOT NULL
     OR to_regprocedure('public.paypal_payment_precondition(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: 20261111140000_paypal_payment_preconditions is still applied and calls game_payment_guardian_ready. Run its rollback first.';
  END IF;
END
$guard$;

-- The definition in force before the migration (20261110120000_guardian_approval_validity.sql), unchanged.
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
       AND private_sec.guardian_approval_valid(NEW.player_id, jr.guardian_approved_by)
       AND jr.status IN ('pending', 'approved')
  ) THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP FUNCTION IF EXISTS public.game_payment_guardian_ready(text);
DROP FUNCTION IF EXISTS private_sec.guardian_payment_approval_missing(uuid, text);
COMMIT;
