-- requires_approval is a non-sensitive join-UX flag, so a prospective viewer
-- can read it even though the full payment-settings row is host-and-linked-only.
-- get_game_join_policy exposes just that flag, for games the caller is allowed
-- to see, and only from the game's real payee row. Companion to
-- get_game_refund_terms and the settings host guard (340).
BEGIN;

SELECT t.person('host', 35), t.person('player', 29), t.person('stranger', 41),
       t.person('participant', 33);

INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, is_private) VALUES
  ('g-open',       t.id('host'), 'basketball', 'Open run',          now() + interval '3 days', 0, false),
  ('g-gated',      t.id('host'), 'basketball', 'Approval run',      now() + interval '3 days', 0, false),
  ('g-priv',       t.id('host'), 'basketball', 'Private run',       now() + interval '3 days', 0, true),
  ('g-nosettings', t.id('host'), 'basketball', 'Never configured',  now() + interval '3 days', 0, false);

INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('g-open',  t.id('host'), 0, false),
  ('g-gated', t.id('host'), 0, true),
  ('g-priv',  t.id('host'), 0, false);

-- Link a participant to the private game (bypass the join-gate triggers to set
-- up the state the way the host-and-linked read rule keys off).
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g-priv', t.id('participant'));
SET LOCAL session_replication_role = origin;

-- ---- a prospective viewer (not linked) reads the flag on public games -------
SELECT t.as_user(t.id('player'));
SELECT t.eq((SELECT requires_approval FROM public.get_game_join_policy('g-open')), false,
  'a prospective player sees that a public instant-join game needs no approval');
SELECT t.eq((SELECT requires_approval FROM public.get_game_join_policy('g-gated')), true,
  'and that an approval-gated public game does require it');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_join_policy('g-nosettings')), 0,
  'a game with no settings row returns nothing, so the app keeps approval-by-default');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_join_policy('g-priv')), 0,
  'a private game the player is not linked to stays invisible');
SELECT t.reset();

-- ---- anonymous visitors can read public games too ---------------------------
SELECT t.as_anon();
SELECT t.eq((SELECT requires_approval FROM public.get_game_join_policy('g-open')), false,
  'an anonymous visitor reads the public instant-join flag');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_join_policy('g-priv')), 0,
  'but not a private game''s');
SELECT t.reset();

-- ---- host and linked participant can read the private game's flag -----------
SELECT t.as_user(t.id('host'));
SELECT t.eq((SELECT requires_approval FROM public.get_game_join_policy('g-priv')), false,
  'the host reads their own private game''s flag');
SELECT t.reset();
SELECT t.as_user(t.id('participant'));
SELECT t.eq((SELECT requires_approval FROM public.get_game_join_policy('g-priv')), false,
  'a linked participant reads the private game''s flag');
SELECT t.reset();

-- ---- a stranger's planted row is never believed -----------------------------
-- A settings row that names a non-payee host (written before the settings host
-- guard, or by a compromised path) must not override the real host's policy.
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, created_at)
  VALUES ('g-gated', t.id('stranger'), 0, false, now() + interval '1 hour');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('player'));
SELECT t.eq((SELECT requires_approval FROM public.get_game_join_policy('g-gated')), true,
  'the flag comes from the game''s real payee, not a stranger''s newer "no approval" row');
SELECT t.reset();

ROLLBACK;
