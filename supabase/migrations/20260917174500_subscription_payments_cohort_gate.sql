-- Stripe subscription/purchase checkout had no age-cohort gate anywhere (client or
-- server): a child_under_13 / teen_13_15 / teen_16_17 account could complete a real
-- paid purchase with no guardian involved. Mirrors the existing game_payments_allowed
-- pattern, hard-blocking every minor cohort rather than the partial (16-17 protected)
-- carve-out that pattern uses, per product decision.
--
-- A BEFORE INSERT trigger (not UPDATE, and not an RLS policy) is used deliberately:
-- the payments webhook (src/routes/api/public/payments/webhook.ts) is the only real
-- writer of these two tables and runs as service_role, which bypasses RLS entirely, so
-- only a trigger — not a policy — can actually guard the real write path. INSERT-only
-- means an existing row's later renewal/status/cancellation sync from Stripe is never
-- blocked, even if a cohort is corrected downward afterward; what should happen to a
-- pre-existing subscription in that case is a separate product/legal question, not
-- something this migration decides by force.
--
-- purchases.user_id is nullable (ON DELETE SET NULL) and subscriptions.user_id is
-- NOT NULL; the NULL guard below is a no-op for subscriptions and the real guard for
-- purchases.
CREATE OR REPLACE FUNCTION public.subscription_payments_allowed(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.age_cohort_of(_user) = 'adult';
$$;

REVOKE ALL ON FUNCTION public.subscription_payments_allowed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.subscription_payments_allowed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.subscription_payments_allowed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.subscription_payments_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_subscription_payment_cohort()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NOT public.subscription_payments_allowed(NEW.user_id) THEN
    RAISE EXCEPTION 'SUBSCRIPTION_PAYMENTS_NOT_AVAILABLE: subscription payments are not available for this account yet.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_subscription_payment_cohort ON public.subscriptions;
CREATE TRIGGER enforce_subscription_payment_cohort
BEFORE INSERT ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_payment_cohort();

DROP TRIGGER IF EXISTS enforce_subscription_payment_cohort ON public.purchases;
CREATE TRIGGER enforce_subscription_payment_cohort
BEFORE INSERT ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.enforce_subscription_payment_cohort();
