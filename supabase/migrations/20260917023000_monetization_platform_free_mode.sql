-- Monetization: rename the master switch and add the global controls.
--
-- Phase 1 stored `access.billingEnabled` (true = charging). This renames it to
-- `access.platformFreeMode` (true = free), which matches how the product talks
-- about it and removes a double negative, and adds the global controls — all
-- shipped OFF, so turning free mode off is deliberately not enough to start
-- charging. Each surface is switched on separately.
--
-- Nothing about the paid product is deleted. Idempotent: safe to re-run.

-- 1. Migrate the access block in place.
--    Only runs where `platformFreeMode` is absent, so an admin who has already
--    configured the new keys is never reset. `billingEnabled` is carried over
--    inverted where it exists, defaulting to free when it does not.
UPDATE public.app_settings
   SET value = jsonb_set(
         COALESCE(value, '{}'::jsonb),
         '{access}',
         (COALESCE(value->'access', '{}'::jsonb) - 'billingEnabled')
           || jsonb_build_object(
                'platformFreeMode',
                CASE
                  WHEN jsonb_typeof(value->'access'->'billingEnabled') = 'boolean'
                  THEN NOT (value->'access'->>'billingEnabled')::boolean
                  ELSE true
                END,
                'subscriptionsEnabled',   COALESCE((value->'access'->>'subscriptionsEnabled')::boolean,   false),
                'paymentsEnabled',        COALESCE((value->'access'->>'paymentsEnabled')::boolean,        false),
                'premiumFeaturesEnabled', COALESCE((value->'access'->>'premiumFeaturesEnabled')::boolean, false),
                'checkoutEnabled',        COALESCE((value->'access'->>'checkoutEnabled')::boolean,        false),
                'merchShopEnabled',       COALESCE((value->'access'->>'merchShopEnabled')::boolean,       false),
                'upgradePromptsEnabled',  COALESCE((value->'access'->>'upgradePromptsEnabled')::boolean,  false),
                'featureAccess',          COALESCE(value->'access'->'featureAccess', '{}'::jsonb)
              ),
         true)
 WHERE key = 'monetization'
   AND NOT (COALESCE(value->'access', '{}'::jsonb) ? 'platformFreeMode');

-- 2. Is the platform currently free for everyone?
--
--    Reads the renamed key, still accepting the old one so a partially applied
--    deploy cannot start charging. Defaults to TRUE in every degenerate case —
--    row missing, key missing, or the JSON hand-edited into a non-boolean. A
--    misconfigured settings row must never accidentally paywall a member, and
--    the type guards keep a bad edit from raising inside has_entitlement.
CREATE OR REPLACE FUNCTION public.monetization_free_mode()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT CASE
              WHEN jsonb_typeof(value->'access'->'platformFreeMode') = 'boolean'
              THEN (value->'access'->>'platformFreeMode')::boolean
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

-- 3. Refresh the setting's description to match what it now holds.
UPDATE public.app_settings
   SET description = 'Monetization: free mode, global controls, per-feature access, prices, trials and fees. Empty means use built-in defaults.'
 WHERE key = 'monetization';

-- has_entitlement is unchanged: it already calls monetization_free_mode(), and
-- its caller-identity hardening stays first.
