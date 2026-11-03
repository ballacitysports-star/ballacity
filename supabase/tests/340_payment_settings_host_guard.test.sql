-- Payment settings can only be written by the host of the game they describe.
BEGIN;
SELECT t.person('host', 35), t.person('player', 29), t.person('stranger', 41), t.person('otherhost', 36);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, price) VALUES
  ('g-pay', t.id('host'), 'basketball', 'Paid run', now()+interval '3 days', 10),
  ('g-other', t.id('otherhost'), 'basketball', 'Other run', now()+interval '3 days', 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g-pay', t.id('host'), 10, false);

-- a stranger cannot add a settings row to someone else's game (which would redirect payments to them)
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g-pay', %L, 10, false)$q$, t.id('stranger')),
  'row-level security', 'a stranger cannot create payment settings for another host''s game');
SELECT t.reset();
-- nor can a host create them for another host's game
SELECT t.as_user(t.id('otherhost'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('g-pay', %L, 10)$q$, t.id('otherhost')),
  'row-level security', 'a different host cannot either');
-- nor move an existing row of theirs onto that game
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('g-other', %L, 5)$q$, t.id('otherhost')), 'a host can write settings for their own game');
SELECT t.throws($q$UPDATE public.game_payment_settings SET game_id = 'g-pay' WHERE game_id = 'g-other'$q$, 'row-level security', 'a host cannot re-point their settings row at another host''s game');
SELECT t.reset();
-- the real host still can, including editing and upserting their own row
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.game_payment_settings SET entry_fee = 12 WHERE game_id = 'g-pay'$q$, 'the host can edit their settings');
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g-pay', %L, 12, true) ON CONFLICT (game_id, host_id) DO UPDATE SET entry_fee = EXCLUDED.entry_fee$q$, t.id('host')), 'and upsert it (what the app does)');
SELECT t.reset();
-- the settings players read are the host's
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id = 'g-pay'), 1, 'there is exactly one settings row for the game');
ROLLBACK;
