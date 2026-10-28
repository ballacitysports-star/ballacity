-- A minor's game request needs the host's answer and the guardian's, in either
-- order. The guardian used to be locked out once the host had answered first, and
-- the child could never be rostered.
BEGIN;

SELECT t.person('host', 35), t.person('guardian', 41), t.person('stranger', 29), t.person('teenmid', 14);
SELECT t.guardian('guardian', 'teenmid');

INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('first',  t.id('host'), 'basketball', 'Host answers first',     now() + interval '2 days', 10),
  ('second', t.id('host'), 'basketball', 'Guardian answers first', now() + interval '2 days', 10),
  ('no',     t.id('host'), 'basketball', 'Guardian says no',       now() + interval '2 days', 10),
  ('late',   t.id('host'), 'basketball', 'Already in',             now() + interval '2 days', 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
SELECT id, t.id('host'), 0, true FROM public.hosted_games;

CREATE FUNCTION pg_temp.ask(_game text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid := t.id('req-' || _game);
BEGIN
  PERFORM t.as_user(t.id('teenmid'));
  INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
  VALUES (rid, _game, t.id('teenmid'), t.id('host'), 'k-' || _game);
  PERFORM t.reset();
  RETURN rid;
END $$;

CREATE FUNCTION pg_temp.host_approves(_game text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id('host'));
  UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-' || _game);
  PERFORM t.reset();
END $$;

-- ---- the host answers first ------------------------------------------------
SELECT pg_temp.ask('first');
SELECT pg_temp.host_approves('first');

SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'first', t.id('teenmid')),
  'GUARDIAN_APPROVAL_REQUIRED', 'the host''s yes alone does not roster a minor');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-first')),
  'NOT_GUARDIAN', 'only the child''s guardian can answer');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-first')),
  'the guardian can still approve after the host has');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.join_requests WHERE id = t.id('req-first')), 'approved',
  'the guardian''s approval leaves the host''s answer alone');
SELECT t.ok((SELECT guardian_approved_at IS NOT NULL FROM public.join_requests WHERE id = t.id('req-first')),
  'and records the guardian''s approval');
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'first', t.id('teenmid')),
  'the minor is then rostered');
SELECT t.reset();

-- ---- the guardian answers first --------------------------------------------
SELECT pg_temp.ask('second');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-second')),
  'the guardian can approve while the request is still waiting for the host');
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'second', t.id('teenmid')),
  'GAME_APPROVAL_REQUIRED', 'the guardian''s yes alone does not roster a minor either');
SELECT t.reset();
SELECT pg_temp.host_approves('second');
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'second', t.id('teenmid')),
  'with both answers in, the minor is rostered');
SELECT t.reset();

-- ---- the guardian says no after the host said yes ---------------------------
SELECT pg_temp.ask('no');
SELECT pg_temp.host_approves('no');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, false)', t.id('req-no')),
  'the guardian can decline a request the host already approved');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.join_requests WHERE id = t.id('req-no')), 'rejected',
  'a declined request is rejected, whatever the host said');
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'no', t.id('teenmid')),
  'GUARDIAN_APPROVAL_REQUIRED', 'and the minor cannot be rostered');
SELECT t.reset();

-- ---- once the child is in, the request is no longer the way out -------------
SELECT t.as_user(t.id('guardian'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, false)', t.id('req-first')),
  'ALREADY_ON_ROSTER', 'a guardian cannot decline a request the child is already rostered from');
SELECT t.reset();

-- A request that was already answered by the guardian's decline stays answered.
SELECT t.as_user(t.id('guardian'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-no')),
  'REQUEST_NOT_PENDING', 'a declined request cannot be approved afterwards');
SELECT t.reset();

ROLLBACK;
