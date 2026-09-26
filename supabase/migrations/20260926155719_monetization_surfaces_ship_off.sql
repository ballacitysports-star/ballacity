-- Monetization: ship every paid surface OFF, as the global controls intend.
--
-- 20260917023000 carried the surface switches over from phase 1's access block
-- as though an admin had chosen them. Nobody had: 20260917015500 seeded
-- subscriptions, merch and upgrade prompts ON as phase 1's own defaults, and
-- phase 1 never shipped. Applied in order, the two left those three ON, so the
-- SuperAdmin panel would show them enabled, and switching Free Mode off would
-- bring the upgrade prompts and the shop straight back — contrary to the staged
-- rollout, where each surface is switched on separately.
--
-- Nothing could have been charged either way: payments and checkout stayed OFF,
-- and while Free Mode is on these switches have no effect at all.
--
-- Matches only that exact seeded state, so a configuration an admin has actually
-- changed is left alone. Safe to re-run.

UPDATE public.app_settings
   SET value = jsonb_set(
         value,
         '{access}',
         (value->'access') || jsonb_build_object(
           'subscriptionsEnabled',  false,
           'merchShopEnabled',      false,
           'upgradePromptsEnabled', false),
         true)
 WHERE key = 'monetization'
   AND value->'access' @> '{
         "platformFreeMode": true,
         "subscriptionsEnabled": true,
         "merchShopEnabled": true,
         "upgradePromptsEnabled": true,
         "paymentsEnabled": false,
         "premiumFeaturesEnabled": false,
         "checkoutEnabled": false
       }'::jsonb;
