-- ROLLBACK for supabase/migrations/20261111140000_paypal_payment_preconditions.sql (task #69).
-- NOT a migration. It drops the check the server asks before creating or capturing a PayPal order, and puts back the
-- order statuses as drizzle 0018_paypal_checkout defines them. No trigger was changed by the migration, so none is
-- restored here.
-- Roll back the app change first: the server's check fails closed, so with the function gone nobody could pay by
-- PayPal. With both rolled back, PayPal checkout again moves money for a player the database then refuses to record
-- (host approval, payment cohort, payee) or to place on the roster, and ignores the failed record.
-- Run this before 20261111100000's rollback, never after (each guard enforces its half of that order).
-- It refuses to run unless:
--     PGOPTIONS="-c app.confirm_paypal_preconditions_rollback=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_paypal_preconditions_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets PayPal checkout take money for a payment the database will refuse to record. Set app.confirm_paypal_preconditions_rollback=yes for the session to proceed deliberately.';
  END IF;
  -- The state this restores is 20261111100000's. Its rollback refuses while this migration is applied.
  IF to_regprocedure('public.game_payment_guardian_ready(text)') IS NULL THEN
    RAISE EXCEPTION 'Refusing to run: 20261111100000_paypal_guardian_rule is no longer applied, so this would not restore the state it expects.';
  END IF;
  -- An order in one of the new statuses is a capture under way or money that was taken and not recorded. The old
  -- constraint cannot hold it, and dropping the record would lose track of the money.
  IF EXISTS (SELECT 1 FROM public.paypal_orders
              WHERE status IN ('capturing', 'refunded_unrecorded', 'captured_unrecorded')) THEN
    RAISE EXCEPTION 'Refusing to run: paypal_orders has orders in capturing, refunded_unrecorded or captured_unrecorded. Settle each one (refund or record it) and set its status first.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.paypal_payment_precondition(text);
DROP FUNCTION IF EXISTS private_sec.paypal_payment_block(text);

-- The constraint as drizzle 0018_paypal_checkout created it.
ALTER TABLE public.paypal_orders DROP CONSTRAINT paypal_orders_status_check;
ALTER TABLE public.paypal_orders ADD CONSTRAINT paypal_orders_status_check
  CHECK (status IN ('created', 'approved', 'captured', 'failed', 'cancelled'));
COMMIT;
