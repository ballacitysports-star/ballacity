-- Display switch for the public sport hubs (/basketball, /baseball, ...).
--
-- Additive and idempotent: inserts one app_settings row and never overwrites an
-- existing one, so a superadmin's later choice is kept on a re-run.
--
-- The row must be is_public = true. Anonymous visitors can only read public
-- rows (policy "Public flags are readable"), and the hub's server function reads
-- it as anon. A non-public row would be invisible there and the hubs would stay
-- on whatever its value, so the switch would silently do nothing.
--
-- The switch only hides the hubs. It grants and removes no permissions, and the
-- listings behind them are still limited by the existing row level security.
-- To turn the hubs off: set value to {"enabled": false}. Nothing is deleted.
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES (
  'sport_hubs',
  '{"enabled": true}'::jsonb,
  'Public sport hub pages (/basketball, /baseball, ...). {"enabled": false} hides them.',
  true
)
ON CONFLICT (key) DO NOTHING;
