-- Temporarily free platform + superadmin monetization controls.
--
-- ballaCity is free for every member right now. Nothing here deletes the paid
-- product: the products, prices, Stripe wiring and billing webhook all stay
-- exactly as they are. A superadmin flipping `access.billingEnabled` back to
-- true in the Monetization panel restores the paid product in one step.
--
-- Idempotent: safe to re-run.

-- 1. Seed the access block into the existing monetization row.
--    Merged at the top level with `||` so any price / trial / fee override
--    already stored (and `ballacityProcessedPaymentsEnabled`, which the
--    enforce_direct_host_payment_mode trigger reads) survives untouched.
--    The `NOT (value ? 'access')` guard makes a second run a no-op, so an
--    admin who later enables billing is not silently reset to free.
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES (
  'monetization',
  '{}'::jsonb,
  'Monetization overrides: access switches, plan display prices, trial days, platform/processing fees. Empty means use built-in defaults.',
  true
)
ON CONFLICT (key) DO NOTHING;

UPDATE public.app_settings
   SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
         'access', jsonb_build_object(
           'billingEnabled',       false,
           'subscriptionsEnabled', true,
           'merchShopEnabled',     true,
           'upgradePromptsEnabled', true,
           'freeModeEntitlements', jsonb_build_array(
             'player_plus', 'host_pro', 'team_pro', 'org_pro', 'facility_pro'),
           'freeModeAiTier',       'gym',
           'freeModeNotice',       'Everything on ballaCity is free right now — no subscription needed.'
         ))
 WHERE key = 'monetization'
   AND NOT (COALESCE(value, '{}'::jsonb) ? 'access');

-- 2. Is the platform currently free for everyone?
--
--    Defaults to TRUE in every degenerate case — row missing, key missing, or
--    the JSON edited into something that is not a boolean. A misconfigured
--    settings row must never accidentally paywall a member, and the type guard
--    keeps a bad hand-edit from raising inside has_entitlement below.
CREATE OR REPLACE FUNCTION public.monetization_free_mode()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
              WHEN jsonb_typeof(value->'access'->'billingEnabled') = 'boolean'
              THEN NOT (value->'access'->>'billingEnabled')::boolean
              ELSE true
            END
       FROM public.app_settings
      WHERE key = 'monetization'),
    true);
$$;

REVOKE ALL ON FUNCTION public.monetization_free_mode() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.monetization_free_mode() TO authenticated, service_role;

-- 3. The trusted entitlement check, now free-mode aware.
--
--    The caller-identity hardening added in 20260914164514 stays FIRST and
--    unchanged: you may only ask about yourself unless you are an admin. Only
--    then does free mode grant the entitlement. The subscription query is
--    carried over verbatim, so turning billing back on restores the exact
--    previous behaviour.
CREATE OR REPLACE FUNCTION public.has_entitlement(
  _user_id uuid,
  _entitlement text,
  _env text DEFAULT 'sandbox'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND _user_id <> auth.uid()
      AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
    THEN false
    WHEN public.monetization_free_mode()
    THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = _user_id
        AND s.environment = _env
        AND COALESCE(s.tier, public.tier_for_price_id(s.price_id)) = _entitlement
        AND (
          (s.status IN ('active','trialing','past_due')
            AND (s.current_period_end IS NULL OR s.current_period_end > now()))
          OR (s.status = 'canceled' AND s.current_period_end > now())
        )
    )
  END;
$$;

-- CREATE OR REPLACE preserves the existing ACL; re-stated to match 20260915174129.
REVOKE EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) TO authenticated, service_role;
