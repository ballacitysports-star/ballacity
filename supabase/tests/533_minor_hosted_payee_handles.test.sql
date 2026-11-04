-- SEC-7 item 3: a guardian payee's payment handles (often a real name) for a minor-hosted paid game go only to people involved with that game:
-- the host, the payee, an approved requester, a participant, their verified guardian, staff. Seeing the public listing is not enough.
BEGIN;
SELECT t.person('teenhost', 17), t.person('guardian', 40), t.person('stranger', 44), t.person('asker', 29), t.person('approved', 31),
       t.person('player', 32), t.person('kid15', 15), t.person('kidparent', 45), t.person('modone', 39), t.person('adulthost', 36);
SELECT t.guardian('guardian', 'teenhost');
SELECT t.guardian('kidparent', 'kid15');
SET LOCAL session_replication_role = replica;
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');
SET LOCAL session_replication_role = origin;

SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.pay', public.grant_minor_hosting_approval(t.id('teenhost'), 168, true)::text, false);
SELECT t.lives(format($q$INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (%L, 'venmo', 'Jane-Realname')$q$, t.id('guardian')),
  'setup: the guardian adds a payment handle');
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, min_age, max_age, hosting_approval_id) VALUES ('mh', %L, 'basketball', 'paid youth run', now()+interval '3 days', 10, 13, 17, %L)$q$, t.id('teenhost'), current_setting('t.pay')::uuid),
  'setup: a public paid game hosted by a 17-year-old');
SELECT t.reset();
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('mh', %L, 10, false)$q$, t.id('guardian')),
  'setup: the guardian holds the payment settings and asks for instant joining');
SELECT t.reset();
SELECT t.ok((SELECT requires_approval FROM public.game_payment_settings WHERE game_id = 'mh'), 'a paid minor-hosted game always requires approval before payment');

CREATE FUNCTION pg_temp.handles(who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(who));
  SELECT count(*)::int INTO n FROM public.get_game_host_payment_methods(t.id('guardian'), 'mh');
  PERFORM t.reset();
  RETURN n;
END $$;

SELECT t.eq(pg_temp.handles('stranger'), 0, 'a signed-in stranger who can see the public listing gets no handles');
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, status, idempotency_key) VALUES
  ('mh', t.id('asker'), t.id('teenhost'), 'pending', 'k-ask'),
  ('mh', t.id('approved'), t.id('teenhost'), 'approved', 'k-appr'),
  ('mh', t.id('kid15'), t.id('teenhost'), 'approved', 'k-kid');
INSERT INTO public.game_participants (game_id, user_id) VALUES ('mh', t.id('player'));
SET LOCAL session_replication_role = origin;
SELECT t.eq(pg_temp.handles('asker'), 0, 'nor does someone who only asked to join');
SELECT t.eq(pg_temp.handles('approved'), 1, 'an approved requester does (to pay)');
SELECT t.eq(pg_temp.handles('player'), 1, 'a participant does');
SELECT t.eq(pg_temp.handles('kid15'), 1, 'an approved minor does');
SELECT t.eq(pg_temp.handles('kidparent'), 1, 'and that minor''s verified guardian');
SELECT t.eq(pg_temp.handles('teenhost'), 1, 'the host does');
SELECT t.eq(pg_temp.handles('guardian'), 1, 'the payee does');
SELECT t.eq(pg_temp.handles('modone'), 1, 'staff do');
SELECT t.as_anon();
SELECT t.eq(t.count($q$SELECT 1 FROM public.get_game_host_payment_methods(md5('t:guardian')::uuid, 'mh')$q$), 0, 'visitors get nothing');
SELECT t.reset();

-- the pay flow: an approved requester can pay the guardian; someone who only asked cannot
SELECT t.as_user(t.id('asker'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'mh', %L)$q$, t.id('asker'), t.id('guardian')),
  'Host approval required', 'a payment needs the approval first');
SELECT t.as_user(t.id('approved'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'mh', %L)$q$, t.id('approved'), t.id('guardian')),
  'an approved requester pays');
SELECT t.reset();

-- adult-hosted public games are unchanged: anyone signed in who can see the listing gets the handles (instant pay-and-join)
SELECT t.as_user(t.id('adulthost'));
SELECT t.lives(format($q$INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (%L, 'venmo', 'adult-handle')$q$, t.id('adulthost')), 'setup: adult handle');
INSERT INTO public.hosted_games (id, host_id, sport, title, date, price) VALUES ('ah', t.id('adulthost'), 'basketball', 'adult paid run', now()+interval '3 days', 10);
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('ah', %L, 10, false)$q$, t.id('adulthost')),
  'setup: adult settings with instant joining');
SELECT t.reset();
SELECT t.ok((SELECT NOT requires_approval FROM public.game_payment_settings WHERE game_id = 'ah'), 'an adult host keeps instant joining');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('adulthost'), 'ah')), 1, 'and a public adult-hosted listing still shows its handles');
SELECT t.reset();

ROLLBACK;
