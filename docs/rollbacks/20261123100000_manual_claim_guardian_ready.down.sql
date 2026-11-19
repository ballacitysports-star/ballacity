-- ROLLBACK for supabase/migrations/20261123100000_manual_claim_guardian_ready.sql (docs/paid-path-gates.md section 6,
-- "Also related" (d)).
-- NOT a migration. It drops public.game_manual_claim_guardian_ready(text), the pay page's read-only view of the
-- manual-claim guardian rule. Nothing else changes: the guardian trigger (enforce_guardian_before_payment), its rule
-- (private_sec.guardian_payment_approval_missing), game_payment_guardian_ready and PayPal checkout were not touched by
-- the migration and are not touched here. No row is written or removed.
-- Effect on the app that shipped with the migration: the check fails, so the app fails closed on the manual methods:
-- no manual method (Venmo, Cash App, other) and no proof form on the pay page for ANY viewer, with "We couldn't
-- check..." and a Retry in their place, and no handles on the game page's Payments tab, until the app is rolled back
-- too or the function is restored. PayPal checkout does not ask this function and stays offered. Roll the app back
-- first if manual payments must keep working.
-- It stops, changing nothing, if the function no longer has the definition the migration gave it (a later migration
-- changed it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_manual_claim_guardian_ready_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_manual_claim_guardian_ready_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"public.game_manual_claim_guardian_ready(text)": "109ac8d21a705b9fc29fa193c5a20c9d"}'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_manual_claim_guardian_ready_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: the pay page asks this function before it offers a manual payment, and fails closed without it (no Venmo, Cash App or other method for anyone until the app is rolled back; PayPal stays). Set app.confirm_manual_claim_guardian_ready_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261123100000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION public.game_manual_claim_guardian_ready(text);

COMMIT;
