-- Hotfix 20261102100000: nobody but a game's host can write that game's payment settings, so nobody can use a
-- settings row of their own to switch off the host-approval step of the join gate. Uses only what production had
-- before the privacy release, so it also runs against a replay that stops at the hotfix.
BEGIN;
SELECT t.person('host', 38), t.person('stranger', 41), t.person('otherhost', 36);
INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES
  ('hf-youth', t.id('host'), 'basketball', 'U16 run', now() + interval '3 days'),
  ('hf-free', t.id('host'), 'basketball', 'Open run', now() + interval '4 days'),
  ('hf-other', t.id('otherhost'), 'basketball', 'Other run', now() + interval '3 days');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('hf-youth', t.id('host'), 0, true);

-- The bypass: a stranger writes "no approval, no fee" for the host's game, then joins it.
SELECT t.as_user(t.id('stranger'));
-- (created_at a minute later: written after the host's row, as it would be in a later transaction)
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, created_at) VALUES ('hf-youth', %L, 0, false, now() + interval '1 minute')$q$, t.id('stranger')),
  'row-level security', 'a stranger cannot add settings to another host''s game');
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('hf-free', %L, 0, false)$q$, t.id('stranger')),
  'row-level security', 'not even to a game that has no settings row yet');
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('hf-youth', %L, 0, false) ON CONFLICT (game_id, host_id) DO UPDATE SET requires_approval = false$q$, t.id('stranger')),
  'row-level security', 'nor through an upsert (what the app sends)');
SELECT t.throws(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('hf-youth', %L)$q$, t.id('stranger')),
  'GAME_APPROVAL_REQUIRED', 'so the join gate still asks for the host''s approval');
SELECT t.reset();

-- A host cannot move one of their own rows onto someone else's game.
SELECT t.as_user(t.id('otherhost'));
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('hf-other', %L, 0, false)$q$, t.id('otherhost')),
  'a host writes settings for their own game');
SELECT t.throws($q$UPDATE public.game_payment_settings SET game_id = 'hf-youth' WHERE game_id = 'hf-other'$q$,
  'row-level security', 'but cannot re-point that row at another host''s game');
SELECT t.reset();

-- The host keeps doing what the app does.
SELECT t.as_user(t.id('host'));
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('hf-free', %L, 0, false) ON CONFLICT (game_id, host_id) DO UPDATE SET requires_approval = EXCLUDED.requires_approval$q$, t.id('host')),
  'the host creates settings for a new game (upsert)');
SELECT t.lives($q$UPDATE public.game_payment_settings SET requires_approval = false WHERE game_id = 'hf-youth'$q$,
  'and edits them');
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id IN ('hf-youth', 'hf-free')), 2, 'the host sees their two rows');
SELECT t.reset();

SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings s JOIN public.hosted_games g ON g.id = s.game_id WHERE s.host_id <> g.host_id), 0,
  'every settings row is held by its game''s host');
ROLLBACK;
