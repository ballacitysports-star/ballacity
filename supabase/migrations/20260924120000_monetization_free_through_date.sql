-- Monetization: an optional "free through" date for the free run.
--
-- MESSAGING ONLY. `/plans` and `/reels` advertise the date; nothing switches
-- off when it passes. `public.monetization_free_mode()` deliberately does NOT
-- read this field and is left untouched by this migration — the database must
-- never be the thing that starts charging members. Monetization only ever
-- begins because a superadmin turned it on.
--
-- Idempotent: only seeds the key where it is absent, so an admin who has
-- already set a date is never reset by a re-run.

UPDATE public.app_settings
   SET value = jsonb_set(
         COALESCE(value, '{}'::jsonb),
         '{access,freeModeEndsAt}',
         'null'::jsonb,
         true)
 WHERE key = 'monetization'
   AND COALESCE(value->'access', '{}'::jsonb) ? 'platformFreeMode'
   AND NOT (COALESCE(value->'access', '{}'::jsonb) ? 'freeModeEndsAt');
