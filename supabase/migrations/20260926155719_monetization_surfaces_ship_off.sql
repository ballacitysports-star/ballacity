-- Back-filled into git on 2026-09-30. NOT authored in this change.
--
-- Production's supabase_migrations.schema_migrations records this migration as
-- version 20260926155719, name monetization_surfaces_ship_off, but no branch of
-- this repository ever held a file for it, so a database rebuilt from
-- supabase/migrations/ would have lacked it. The record's created_by is NULL:
-- who applied it, and how, is not recorded.
--
-- Everything below the blank line after this header is production's stored
-- statement, byte for byte: md5 1b707e78b26580751d77ca10d4b8b123, equal to
-- md5(array_to_string(statements, E'\n')) for that version in production.
-- The version in the file name is production's exact version, so the CLI's
-- history check sees it as already applied instead of wanting to replay it.

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
