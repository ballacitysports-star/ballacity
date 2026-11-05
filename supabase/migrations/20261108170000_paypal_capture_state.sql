-- Audit F04: a PayPal payment is verified only from a capture that PayPal reports as COMPLETED.
--
-- The server read the ORDER's status, so an order reported COMPLETED with its capture still PENDING became a verified
-- payment (src/lib/paypal.server.ts, paypal.functions.ts). The server now reads the capture itself; this migration
-- makes the database hold it to that:
--   1. paypal_orders records the capture: id, status, amount, currency, payee and the order-level status, plus two
--      states: 'capturing' (one call has claimed the order and is capturing it) and 'capture_pending' (PayPal
--      accepted the capture but has not settled it; nothing is granted).
--   2. One payment per capture and per order: unique capture id on paypal_orders, unique order and capture
--      reference on checkout payments.
--   3. A checkout payment (payment_submissions.paypal_order_id set) can only be verified when that order records a
--      COMPLETED capture with the same id, for the same player and game and the same amount. API roles can never
--      set paypal_order_id: only the server records checkout payments.
-- Payments stay disabled; nothing here enables them.

DO $$ BEGIN
  IF to_regclass('public.paypal_orders') IS NULL OR to_regclass('public.payment_submissions') IS NULL THEN
    RAISE EXCEPTION 'paypal capture state: paypal_orders and payment_submissions must exist';
  END IF;
END $$;

-- ------------------------------------------------------------------------------------------- 1. the capture on the order
ALTER TABLE public.paypal_orders
  ADD COLUMN IF NOT EXISTS capture_status text,
  ADD COLUMN IF NOT EXISTS capture_amount_cents integer,
  ADD COLUMN IF NOT EXISTS capture_currency text,
  ADD COLUMN IF NOT EXISTS capture_payee_merchant_id text,
  ADD COLUMN IF NOT EXISTS paypal_order_status text;

ALTER TABLE public.paypal_orders DROP CONSTRAINT IF EXISTS paypal_orders_status_check;
ALTER TABLE public.paypal_orders ADD CONSTRAINT paypal_orders_status_check
  CHECK (status = ANY (ARRAY['created', 'approved', 'capturing', 'capture_pending', 'captured', 'failed', 'cancelled',
                             'refunded', 'unrecorded']));
-- 'captured' means a COMPLETED capture was recorded
ALTER TABLE public.paypal_orders DROP CONSTRAINT IF EXISTS paypal_orders_captured_is_completed;
ALTER TABLE public.paypal_orders ADD CONSTRAINT paypal_orders_captured_is_completed
  CHECK (status <> 'captured' OR (capture_id IS NOT NULL AND capture_status = 'COMPLETED'));

-- ------------------------------------------------------------------------------------------- 2. one payment per capture
CREATE UNIQUE INDEX IF NOT EXISTS paypal_orders_capture_id_key ON public.paypal_orders (capture_id) WHERE capture_id IS NOT NULL;

ALTER TABLE public.payment_submissions ADD COLUMN IF NOT EXISTS paypal_order_id text;
CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_paypal_order_key
  ON public.payment_submissions (paypal_order_id) WHERE paypal_order_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS payment_submissions_paypal_capture_key
  ON public.payment_submissions (transaction_reference) WHERE paypal_order_id IS NOT NULL;

-- ------------------------------------------------------------------------------------------- 3. verified only from a COMPLETED capture
CREATE OR REPLACE FUNCTION public.enforce_paypal_checkout_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _o public.paypal_orders;
BEGIN
  -- API roles never mark a payment as a PayPal checkout payment, or change that mark.
  IF COALESCE(auth.role(), '') IN ('anon', 'authenticated')
     AND NEW.paypal_order_id IS DISTINCT FROM (CASE WHEN TG_OP = 'UPDATE' THEN OLD.paypal_order_id END) THEN
    RAISE EXCEPTION 'PAYMENT_FIELD_FORBIDDEN: only BallaCity records PayPal checkout payments.' USING ERRCODE = '42501';
  END IF;
  IF NEW.paypal_order_id IS NULL OR NEW.status <> 'verified' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO _o FROM public.paypal_orders WHERE order_id = NEW.paypal_order_id;
  IF NOT FOUND
     OR _o.capture_status IS DISTINCT FROM 'COMPLETED'
     OR _o.capture_id IS NULL
     OR NEW.transaction_reference IS DISTINCT FROM _o.capture_id
     OR NEW.player_id IS DISTINCT FROM _o.player_id
     OR NEW.game_id IS DISTINCT FROM _o.game_id
     OR _o.capture_amount_cents IS DISTINCT FROM _o.amount_cents
     OR round(COALESCE(NEW.paid_amount, 0) * 100)::integer IS DISTINCT FROM _o.amount_cents
     OR _o.capture_currency IS DISTINCT FROM _o.currency THEN
    RAISE EXCEPTION 'PAYPAL_CAPTURE_NOT_COMPLETED: a PayPal payment is verified only from its completed capture.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.enforce_paypal_checkout_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a02_paypal_checkout_payment ON public.payment_submissions;
CREATE TRIGGER a02_paypal_checkout_payment BEFORE INSERT OR UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_paypal_checkout_payment();
