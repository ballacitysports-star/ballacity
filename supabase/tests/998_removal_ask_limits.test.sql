-- A removed player's asks are limited on the removal record, and a player the host blocked cannot send a declined
-- request again (20261204100000_removal_ask_limits).
-- 1. Each ask by the removed player (a new request, or the declined one sent again) is counted on the record. A fourth
--    is refused, and an ask within 15 minutes of the previous one is refused, in the request row's own sentences
--    (P0001), also after the player deletes their request and asks again. A refused ask is not counted.
-- 2. An accepted invitation is never refused or counted, and neither is other SECURITY DEFINER code writing as the player.
-- 3. The host's approval lifts the record, and a later removal starts a fresh count; a repeated removal keeps it.
-- 4. The host, a guardian and the service role are not counted.
-- 5. A player the host blocked cannot move their declined request back to pending (BLOCKED_BY_HOST, the insert path's
--    words); a player not blocked, or one who blocked the host, sends it again as before, and the insert path is as it was.
-- 6. A player who was not removed is limited by the request row only, as before.
-- 7. The definitions are pinned.
-- On a database without 20261204100000 the file still runs to the end: the new columns are read through pg_temp
-- helpers that answer 'no columns' or -1 when they are missing, and the key assertions fail.
BEGIN;
SELECT t.person('host', 35), t.person('ana', 28), t.person('bob', 29), t.person('cal', 30), t.person('dee', 31),
       t.person('eve', 32), t.person('fay', 33), t.person('kid', 16), t.person('mom', 42), t.person('blk', 26),
       t.person('blkb', 27), t.person('blkc', 28), t.person('nob', 29), t.person('rev', 30), t.person('rbk', 31),
       t.person('zed', 25);
SELECT t.guardian('mom', 'kid');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('gopen', t.id('host'), 'basketball', 'Open run',     now() + interval '3 days', 20, 0),
  ('gappr', t.id('host'), 'basketball', 'Approval run', now() + interval '3 days', 20, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('gopen', t.id('host'), 0, false), ('gappr', t.id('host'), 0, true);
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  created_at) VALUES
  (t.id('req-kid'),  'gopen', t.id('host'), t.id('kid'),  'pending',  'guardian-only:gopen', NULL, NULL, now() - interval '4 hours'),
  -- gappr: declined long ago (past the request's own cooldown), except blkb, declined just now.
  (t.id('req-blk'),  'gappr', t.id('host'), t.id('blk'),  'rejected', 'k1', now() - interval '2 hours', now() - interval '2 hours', now() - interval '4 hours'),
  (t.id('req-blkb'), 'gappr', t.id('host'), t.id('blkb'), 'rejected', 'k2', now(), now(), now() - interval '4 hours'),
  (t.id('req-nob'),  'gappr', t.id('host'), t.id('nob'),  'rejected', 'k3', now() - interval '2 hours', now() - interval '2 hours', now() - interval '4 hours'),
  (t.id('req-rev'),  'gappr', t.id('host'), t.id('rev'),  'rejected', 'k4', now() - interval '2 hours', now() - interval '2 hours', now() - interval '4 hours');
UPDATE public.join_requests SET guardian_approved_at = now() - interval '3 hours', guardian_approved_by = t.id('mom')
 WHERE id = t.id('req-kid');
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('gopen', t.id('ana')), ('gopen', t.id('bob')), ('gopen', t.id('cal')), ('gopen', t.id('dee')), ('gopen', t.id('eve')),
  ('gopen', t.id('fay')), ('gopen', t.id('kid')), ('gopen', t.id('rbk'));
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id);
SET LOCAL session_replication_role = origin;
-- The host has blocked blk, blkb and blkc; rev has blocked the host (the other direction).
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
  (t.id('host'), t.id('blk')), (t.id('host'), t.id('blkb')), (t.id('host'), t.id('blkc')), (t.id('rev'), t.id('host'));

-- Whether the columns 20261204100000 adds are there.
CREATE FUNCTION pg_temp.has_cols() RETURNS boolean LANGUAGE sql AS $$
  SELECT to_regclass('public.game_removals') IS NOT NULL
     AND (SELECT count(*) FROM pg_attribute WHERE attrelid = to_regclass('public.game_removals')
             AND attname IN ('asks', 'last_ask_at') AND NOT attisdropped) = 2 $$;
CREATE FUNCTION pg_temp.remove(game text, who text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN PERFORM t.as_user(t.id('host')); r := public.host_remove_player(game, t.id(who)); PERFORM t.reset(); RETURN r; END $$;
-- The player's record for the game, read as the table owner: 1 or 0, or -1 when there is no such table.
CREATE FUNCTION pg_temp.rec(game text, who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF to_regclass('public.game_removals') IS NULL THEN RETURN -1; END IF;
  EXECUTE 'SELECT count(*)::int FROM public.game_removals WHERE game_id = $1 AND user_id = $2' INTO n USING game, t.id(who);
  RETURN n;
END $$;
-- The record's count and last ask, read as the table owner: 'asks/never', 'asks/now' (stamped in this transaction, whose
-- now() is frozen) or 'asks/earlier'; 'no record', or 'no columns' without 20261204100000.
CREATE FUNCTION pg_temp.state(game text, who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  IF NOT pg_temp.has_cols() THEN RETURN 'no columns'; END IF;
  EXECUTE $q$SELECT asks || '/' || CASE WHEN last_ask_at IS NULL THEN 'never' WHEN last_ask_at = now() THEN 'now' ELSE 'earlier' END
               FROM public.game_removals WHERE game_id = $1 AND user_id = $2$q$ INTO r USING game, t.id(who);
  RETURN coalesce(r, 'no record');
END $$;
-- Move the record's last ask back by `ago`, or set its count (setup, as the table owner). Nothing without the columns.
CREATE FUNCTION pg_temp.past_ask(game text, who text, ago interval) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF pg_temp.has_cols() THEN
    EXECUTE 'UPDATE public.game_removals SET last_ask_at = now() - $3 WHERE game_id = $1 AND user_id = $2' USING game, t.id(who), ago;
  END IF;
END $$;
CREATE FUNCTION pg_temp.set_asks(game text, who text, n int) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF pg_temp.has_cols() THEN
    EXECUTE 'UPDATE public.game_removals SET asks = $3 WHERE game_id = $1 AND user_id = $2' USING game, t.id(who), n;
  END IF;
END $$;
-- Move a request's last decline back past the request's own 15-minute resend cooldown.
CREATE FUNCTION pg_temp.past_cooldown(game text, who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.join_requests SET last_rejected_at = now() - interval '1 hour' WHERE game_id = game AND player_id = t.id(who);
  SET LOCAL session_replication_role = origin;
END $$;
-- The player asks the host, as the app's createJoinRequest does: the declined request sent again, or a new one.
-- 'sent', or the refusal's text; ask_code gives 'sent' or the refusal's SQLSTATE.
CREATE FUNCTION pg_temp.ask(game text, who text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    IF EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = game AND player_id = t.id(who)) THEN
      UPDATE public.join_requests SET status = 'pending' WHERE game_id = game AND player_id = t.id(who) AND status = 'rejected';
    ELSE
      INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
      VALUES (game, t.id('host'), t.id(who), 'join:' || game);
    END IF;
  EXCEPTION WHEN OTHERS THEN PERFORM t.reset(); RETURN SQLERRM; END;
  PERFORM t.reset(); RETURN 'sent';
END $$;
CREATE FUNCTION pg_temp.ask_code(game text, who text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    IF EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = game AND player_id = t.id(who)) THEN
      UPDATE public.join_requests SET status = 'pending' WHERE game_id = game AND player_id = t.id(who) AND status = 'rejected';
    ELSE
      INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
      VALUES (game, t.id('host'), t.id(who), 'join:' || game);
    END IF;
  EXCEPTION WHEN OTHERS THEN PERFORM t.reset(); RETURN SQLSTATE; END;
  PERFORM t.reset(); RETURN 'sent';
END $$;
-- The player deletes their own request (the app's cancel of a pending ask): rows deleted.
CREATE FUNCTION pg_temp.withdraw(game text, who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(who));
  n := t.changed(format($q$DELETE FROM public.join_requests WHERE game_id = %L AND player_id = %L$q$, game, t.id(who)));
  PERFORM t.reset();
  RETURN n;
END $$;
-- The host's answer (reviewJoinRequest, through the host's rule): rows changed.
CREATE FUNCTION pg_temp.decide(game text, who text, st text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id('host'));
  n := t.changed(format($q$UPDATE public.join_requests SET status = %L, reviewed_at = now()
                           WHERE game_id = %L AND player_id = %L$q$, st, game, t.id(who)));
  PERFORM t.reset();
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.req_status(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce((SELECT status FROM public.join_requests WHERE game_id = game AND player_id = t.id(who)), 'none') $$;
-- An invitation written straight into the table after the removal (created_at later than now(): a test runs in one
-- transaction with now() frozen, and the take-back rule counts a decline at or after the invitation).
CREATE FUNCTION pg_temp.invite(game text, who text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE i uuid;
BEGIN
  INSERT INTO public.game_invites (game_id, host_id, invitee_id, created_at)
  VALUES (game, t.id('host'), t.id(who), now() + interval '1 second') RETURNING id INTO i;
  RETURN i;
END $$;
CREATE FUNCTION pg_temp.accept(inv uuid, who text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN PERFORM t.as_user(t.id(who)); r := public.game_respond_invite(inv, true); PERFORM t.reset(); RETURN r; END $$;
-- The service role acting with a player's id in the token (an edge function on the player's behalf): it passes
-- validate_join_request's own-request check, so only the ask limits' scope decides.
CREATE FUNCTION pg_temp.as_service_for(who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', t.id(who)::text, true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END $$;
-- SECURITY DEFINER code that writes the signed-in player's request, as game_respond_invite does. Rolled back with the
-- test.
CREATE FUNCTION t.ask_as_definer_998(game text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
  SELECT g.id, g.host_id, auth.uid(), 'definer:' || g.id FROM public.hosted_games g WHERE g.id = game;
END $$;

-- ================= 1. the count, the cooldown and the cap, across delete-and-ask-again =================
SELECT t.eq(pg_temp.remove('gopen', 'ana') ->> 'removed', 'true', 'ana is removed from the open game');
SELECT t.eq(pg_temp.state('gopen', 'ana'), '0/never', 'COUNTER: a new record starts with no asks');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent', 'the first ask after a removal goes through at once');
SELECT t.eq(pg_temp.state('gopen', 'ana'), '1/now', 'COUNTER: an ask by a new request is counted and stamped');
SELECT t.eq(pg_temp.decide('gopen', 'ana', 'rejected'), 1, 'the host says no');
SELECT pg_temp.past_cooldown('gopen', 'ana');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'Please wait 900 seconds before resubmitting this request.',
  'COOLDOWN: past the request''s own cooldown, a resend still waits 15 minutes from her previous ask (the record''s)');
SELECT t.eq(pg_temp.state('gopen', 'ana'), '1/now', 'COUNTER: a refused ask is not counted');
SELECT t.eq(pg_temp.req_status('gopen', 'ana'), 'rejected', 'and the request stays declined');
SELECT t.eq(pg_temp.withdraw('gopen', 'ana'), 1, 'she deletes her declined request');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'Please wait 900 seconds before resubmitting this request.',
  'COOLDOWN: deleting the request and asking again does not skip it (the older gap is closed)');
SELECT t.eq(pg_temp.ask_code('gopen', 'ana'), 'P0001', 'COOLDOWN: refused with P0001, as the request row''s cooldown');
SELECT t.eq(pg_temp.req_status('gopen', 'ana'), 'none', 'and the refused insert left no request behind');
SELECT pg_temp.past_ask('gopen', 'ana', interval '10 minutes');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'Please wait 300 seconds before resubmitting this request.',
  'COOLDOWN: the wait counts down from the previous ask (5 minutes left: 300 seconds)');
SELECT pg_temp.past_ask('gopen', 'ana', interval '1 hour');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent', 'after 15 minutes she may ask again');
SELECT t.eq(pg_temp.state('gopen', 'ana'), '2/now', 'COUNTER: the second ask');
SELECT t.eq(pg_temp.decide('gopen', 'ana', 'rejected'), 1, 'the host says no again');
SELECT pg_temp.past_cooldown('gopen', 'ana');
SELECT pg_temp.past_ask('gopen', 'ana', interval '1 hour');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent', 'she sends the declined request again');
SELECT t.eq(pg_temp.state('gopen', 'ana'), '3/now', 'COUNTER: a resend is counted too');
SELECT t.eq((SELECT attempt_count FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')), 2,
  'the request row keeps its own count as before');
SELECT t.eq(pg_temp.decide('gopen', 'ana', 'rejected'), 1, 'the host says no a third time');
SELECT pg_temp.past_cooldown('gopen', 'ana');
SELECT pg_temp.past_ask('gopen', 'ana', interval '1 hour');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'You have reached the maximum of 3 resubmit attempts for this game.',
  'CAP: a fourth ask is refused, although the request row itself allows one more resend');
SELECT t.eq(pg_temp.withdraw('gopen', 'ana'), 1, 'she deletes her declined request');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'You have reached the maximum of 3 resubmit attempts for this game.',
  'CAP: deleting the request and asking a fourth time is refused (the older gap is closed)');
SELECT t.eq(pg_temp.ask_code('gopen', 'ana'), 'P0001', 'CAP: refused with P0001, as the request row''s cap');
SELECT t.eq(pg_temp.state('gopen', 'ana'), '3/earlier', 'COUNTER: the refused asks are not counted or stamped');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'the removal stands');

-- ================= 2. an accepted invitation is never refused or counted =================
SELECT t.eq(pg_temp.accept(pg_temp.invite('gopen', 'ana'), 'ana') - 'join_request_id',
  '{"status": "accepted", "on_roster": true}'::jsonb, 'INVITE: at the cap, with her request deleted, ana accepts an invitation and is seated');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 0, 'INVITE: and the accept lifts the removal');
SELECT t.eq(pg_temp.remove('gopen', 'cal') ->> 'removed', 'true', 'cal is removed');
SELECT t.eq(pg_temp.ask('gopen', 'cal'), 'sent', 'cal asks the host');
SELECT t.eq(pg_temp.withdraw('gopen', 'cal'), 1, 'and cancels the ask');
SELECT t.eq(pg_temp.accept(pg_temp.invite('gopen', 'cal'), 'cal') ->> 'status', 'accepted',
  'INVITE: an accept right after an ask is not held to the cooldown');
SELECT t.eq(pg_temp.rec('gopen', 'cal'), 0, 'INVITE: it lifts the removal');
-- Other SECURITY DEFINER code writing the player's own request: CURRENT_USER is its owner, so the triggers' WHEN skips it.
SELECT t.eq(pg_temp.remove('gopen', 'dee') ->> 'removed', 'true', 'dee is removed');
SELECT pg_temp.set_asks('gopen', 'dee', 3);
SELECT t.as_user(t.id('dee'));
SELECT t.lives($q$SELECT t.ask_as_definer_998('gopen')$q$,
  'DEFINER: SECURITY DEFINER code writing her request is not refused at the cap');
SELECT t.reset();
SELECT t.eq(pg_temp.req_status('gopen', 'dee'), 'pending', 'DEFINER: the request was written');
SELECT t.eq(pg_temp.state('gopen', 'dee'), '3/never', 'DEFINER: and not counted');

-- ================= 3. the lift resets the count; a repeated removal keeps it =================
SELECT t.eq(pg_temp.remove('gopen', 'bob') ->> 'removed', 'true', 'bob is removed');
SELECT t.eq(pg_temp.ask('gopen', 'bob'), 'sent', 'bob asks');
SELECT t.eq(pg_temp.state('gopen', 'bob'), '1/now', 'one ask on the record');
SELECT t.eq(pg_temp.decide('gopen', 'bob', 'approved'), 1, 'the host approves');
SELECT t.eq(pg_temp.rec('gopen', 'bob'), 0, 'LIFT: the approval deletes the record, and its count with it');
SELECT t.eq(pg_temp.remove('gopen', 'bob') ->> 'request_declined', 'true', 'bob is removed again: his approved request is declined');
SELECT t.eq(pg_temp.state('gopen', 'bob'), '0/never', 'BUDGET: a new removal starts a fresh record, with no asks');
SELECT pg_temp.past_cooldown('gopen', 'bob');
SELECT t.eq(pg_temp.ask('gopen', 'bob'), 'sent', 'BUDGET: his first ask on it is not held to the old record''s cooldown');
SELECT t.eq(pg_temp.state('gopen', 'bob'), '1/now', 'and it is counted');
SELECT t.eq(pg_temp.remove('gopen', 'bob') ->> 'request_declined', 'true', 'the host removes him once more while the record stands');
SELECT t.eq(pg_temp.state('gopen', 'bob'), '1/now', 'REPEAT: a repeated removal keeps the count (it stamps removed_at only)');

-- ================= 4. the host, a guardian and the service role are not counted =================
SELECT t.eq(pg_temp.remove('gopen', 'eve') ->> 'removed', 'true', 'eve is removed');
SELECT t.eq(pg_temp.ask('gopen', 'eve'), 'sent', 'eve asks');
SELECT t.eq(pg_temp.decide('gopen', 'eve', 'rejected'), 1, 'the host says no');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$UPDATE public.join_requests SET status = 'pending' WHERE game_id = 'gopen' AND player_id = t.id('eve')$q$,
  'DECISION_FINAL', 'HOST: the host cannot send her declined request again (as before)');
SELECT t.reset();
SELECT t.eq(pg_temp.state('gopen', 'eve'), '1/now', 'HOST: and nothing is counted');
SELECT t.eq(pg_temp.remove('gopen', 'fay') ->> 'removed', 'true', 'fay is removed (no request)');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
                  VALUES ('gopen', t.id('host'), t.id('fay'), 'host-for-fay')$q$,
  'Cannot create a join request for another player', 'HOST: the host cannot write a request for her (as before)');
SELECT t.reset();
SELECT t.eq(pg_temp.state('gopen', 'fay'), '0/never', 'HOST: and nothing is counted');
-- The service role with the player's id: past the request's own checks, so only the ask limits' scope decides.
SELECT pg_temp.past_cooldown('gopen', 'eve');
SELECT pg_temp.as_service_for('eve');
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending' WHERE game_id = 'gopen' AND player_id = t.id('eve')$q$), 1,
  'SERVICE: the service role sends her declined request again within the record''s cooldown, not refused');
SELECT t.reset();
SELECT t.eq(pg_temp.state('gopen', 'eve'), '1/now', 'SERVICE: and it is not counted');
SELECT pg_temp.set_asks('gopen', 'fay', 3);
SELECT pg_temp.as_service_for('fay');
SELECT t.lives($q$INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
                  VALUES ('gopen', t.id('host'), t.id('fay'), 'service-for-fay')$q$,
  'SERVICE: the service role writes a request for a player at the cap, not refused');
SELECT t.reset();
SELECT t.eq(pg_temp.state('gopen', 'fay'), '3/never', 'SERVICE: and it is not counted');
-- A guarded minor: her own ask counts; her guardian's answers do not.
SELECT t.eq(pg_temp.remove('gopen', 'kid') ->> 'request_declined', 'true', 'kid is removed: her request is declined');
SELECT pg_temp.past_cooldown('gopen', 'kid');
SELECT t.eq(pg_temp.ask('gopen', 'kid'), 'sent', 'kid asks again');
SELECT t.eq(pg_temp.state('gopen', 'kid'), '1/now', 'YOUTH: her own ask is counted');
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-kid'), true);
SELECT t.reset();
SELECT t.eq(pg_temp.state('gopen', 'kid'), '1/now', 'GUARDIAN: the guardian''s approval is not an ask');
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-kid'), false);
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending' WHERE id = t.id('req-kid')$q$), 0,
  'GUARDIAN: the guardian cannot send the declined request again (as before)');
SELECT t.reset();
SELECT t.eq(pg_temp.req_status('gopen', 'kid'), 'rejected', 'the guardian''s no stands');
SELECT t.eq(pg_temp.state('gopen', 'kid'), '1/now', 'GUARDIAN: and nothing the guardian did is counted');

-- ================= 5. a player the host blocked cannot send a declined request again =================
SELECT t.eq(pg_temp.ask('gappr', 'blk'), 'BLOCKED_BY_HOST: you can''t join this host''s games.',
  'BLOCK: a blocked player cannot move her declined request back to pending, in the insert path''s words');
SELECT t.eq(pg_temp.ask_code('gappr', 'blk'), 'P0001', 'BLOCK: P0001, as on insert');
SELECT t.eq(pg_temp.req_status('gappr', 'blk'), 'rejected', 'BLOCK: the request stays declined');
SELECT t.eq(pg_temp.ask('gappr', 'blkb'), 'BLOCKED_BY_HOST: you can''t join this host''s games.',
  'BLOCK: declined just now, she reads the block, not the cooldown');
SELECT t.eq(pg_temp.ask('gappr', 'nob'), 'sent', 'NOT BLOCKED: a player not blocked sends her declined request again, as before');
SELECT t.eq((SELECT status || '/' || attempt_count FROM public.join_requests WHERE id = t.id('req-nob')), 'pending/2',
  'NOT BLOCKED: pending, attempt 2, as before');
SELECT t.eq(pg_temp.ask('gappr', 'rev'), 'sent', 'ONE WAY: a player who blocked the host may still send hers again');
SELECT t.eq(pg_temp.ask('gappr', 'blkc'), 'BLOCKED_BY_HOST: you can''t join this host''s games.',
  'INSERT: a blocked player''s new request is refused as before');
SELECT pg_temp.past_cooldown('gappr', 'blkb');
SELECT t.as_service();
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending' WHERE id = t.id('req-blkb')$q$), 1,
  'SCOPE: the service role may still move a blocked player''s request (only the player acting is checked, as on insert)');
SELECT t.reset();
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host') AND blocked_id = t.id('blk');
SELECT t.eq(pg_temp.ask('gappr', 'blk'), 'sent', 'UNBLOCK: once unblocked she may send it again');
-- Removed and blocked: the block answers, and nothing is counted.
SELECT t.eq(pg_temp.remove('gopen', 'rbk') ->> 'removed', 'true', 'rbk is removed');
SELECT t.eq(pg_temp.ask('gopen', 'rbk'), 'sent', 'rbk asks');
SELECT t.eq(pg_temp.decide('gopen', 'rbk', 'rejected'), 1, 'the host says no');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('rbk'));
SELECT pg_temp.past_cooldown('gopen', 'rbk');
SELECT pg_temp.past_ask('gopen', 'rbk', interval '1 hour');
SELECT t.eq(pg_temp.ask('gopen', 'rbk'), 'BLOCKED_BY_HOST: you can''t join this host''s games.',
  'BLOCK: removed and then blocked, she cannot send her declined request again');
SELECT t.eq(pg_temp.state('gopen', 'rbk'), '1/earlier', 'BLOCK: and the refused resend is not counted');

-- ================= 6. a player who was not removed: the request row only, as before =================
SELECT t.eq(pg_temp.ask('gopen', 'zed'), 'sent', 'zed (not removed) asks');
SELECT t.eq(pg_temp.withdraw('gopen', 'zed'), 1, 'cancels');
SELECT t.eq(pg_temp.ask('gopen', 'zed'), 'sent', 'SCOPE: and asks again at once (no removal record, no record limits)');
SELECT t.eq(pg_temp.rec('gopen', 'zed'), 0, 'SCOPE: asking writes no record');

-- ================= 7. the columns are read under the existing rules; nobody writes them =================
CREATE FUNCTION pg_temp.seen_asks(who text, whose text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  IF NOT pg_temp.has_cols() THEN RETURN 'no columns'; END IF;
  PERFORM t.as_user(t.id(who));
  EXECUTE 'SELECT string_agg(asks::text, '','') FROM public.game_removals WHERE user_id = $1' INTO r USING t.id(whose);
  PERFORM t.reset();
  RETURN coalesce(r, 'none');
END $$;
SELECT t.eq(pg_temp.seen_asks('bob', 'bob'), '1', 'RLS: the player reads his own count');
SELECT t.eq(pg_temp.seen_asks('host', 'bob'), '1', 'RLS: the host reads it');
SELECT t.eq(pg_temp.seen_asks('mom', 'kid'), '1', 'RLS: a guardian reads her child''s');
SELECT t.eq(pg_temp.seen_asks('zed', 'bob'), 'none', 'RLS: another player reads none');
SELECT t.as_user(t.id('bob'));
SELECT t.throws($q$UPDATE public.game_removals SET asks = 0 WHERE user_id = t.id('bob')$q$, 'permission denied',
  'RLS: the player cannot reset his count');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$UPDATE public.game_removals SET asks = 0 WHERE game_id = 'gopen'$q$, 'permission denied',
  'RLS: nor can the host');
SELECT t.reset();

-- ================= 8. the definitions are pinned =================
SELECT t.eq((SELECT md5(pg_get_functiondef(p.oid)) || '/' || p.proowner::regrole::text || '/' || p.prosecdef::text || '/'
                    || array_to_string(p.proconfig, ';') || '/'
                    || coalesce((SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                   LEFT JOIN pg_roles r ON r.oid = x.grantee
                                  WHERE x.privilege_type = 'EXECUTE'
                                    AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')), '-')
               FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.removed_player_ask_limits()')),
  '546985774379162ec78158745a071138/postgres/true/search_path=""/-',
  'PINNED: private_sec.removed_player_ask_limits() is the one 20261204100000 created: owned by postgres, SECURITY DEFINER, empty search_path, no API grant (the rollback guard expects it)');
SELECT t.eq((SELECT string_agg(t.tgname || '=' || md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text, ', ' ORDER BY t.tgname)
               FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass
                AND t.tgname IN ('enforce_host_block_resend', 'trg_join_request_removed_ask_insert', 'trg_join_request_removed_ask_resend')),
  'enforce_host_block_resend=22d086340dff97a68b3088586f94e9a8/O, trg_join_request_removed_ask_insert=3b73758ffddeef6665b199a830beea11/O, trg_join_request_removed_ask_resend=ee897bf53cb82b01fdb49c464ff47088/O',
  'PINNED: the three triggers are the ones 20261204100000 created, enabled (the rollback guard expects them)');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_removed_ask_insert'),
  'CREATE TRIGGER trg_join_request_removed_ask_insert AFTER INSERT ON public.join_requests FOR EACH ROW WHEN '
  || '((CURRENT_USER = ANY (ARRAY[''anon''::name, ''authenticated''::name]))) '
  || 'EXECUTE FUNCTION private_sec.removed_player_ask_limits()', 'PINNED: the insert trigger runs after the row, for the API roles only');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_removed_ask_resend'),
  'CREATE TRIGGER trg_join_request_removed_ask_resend AFTER UPDATE OF status ON public.join_requests FOR EACH ROW WHEN '
  || '(((old.status = ''rejected''::text) AND (new.status = ''pending''::text) '
  || 'AND (CURRENT_USER = ANY (ARRAY[''anon''::name, ''authenticated''::name])))) '
  || 'EXECUTE FUNCTION private_sec.removed_player_ask_limits()', 'PINNED: the resend trigger runs after a rejected -> pending move, for the API roles only');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'enforce_host_block_resend'),
  'CREATE TRIGGER enforce_host_block_resend BEFORE UPDATE OF status ON public.join_requests FOR EACH ROW WHEN '
  || '(((old.status = ''rejected''::text) AND (new.status = ''pending''::text))) EXECUTE FUNCTION enforce_host_block()',
  'PINNED: the block on resend runs enforce_host_block before a rejected -> pending move');
SELECT t.eq((SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND NOT t.tgisinternal
                AND (t.tgtype & 2) = 2 AND (t.tgtype & 16) = 16),
  'a1_join_requests_closed_locked,enforce_host_block_resend,trg_enforce_join_request_resubmit_rules,'
  || 'trg_guard_join_request_guardian_stamp,trg_join_request_approver_gone,trg_join_request_reopen_needs_guardian,'
  || 'trg_validate_join_request_upd',
  'PINNED: the BEFORE UPDATE triggers in firing order: the block answers after the closed-decision lock and before the resend limits');
SELECT t.eq((SELECT md5(pg_get_functiondef('public.enforce_host_block()'::regprocedure))), '6b1d17279ccbb3238ceecd2bde49ba2d',
  'PINNED: public.enforce_host_block() is unchanged, as 20261028150000 created it');
SELECT t.eq((SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t
              WHERE t.tgfoid = 'public.enforce_host_block()'::regprocedure AND NOT t.tgisinternal),
  'enforce_host_block_participants,enforce_host_block_requests,enforce_host_block_resend',
  'PINNED: it runs on the two insert triggers and the new resend trigger');
SELECT t.eq((SELECT md5(pg_get_functiondef('public.enforce_join_request_resubmit_rules()'::regprocedure))),
  'fdb952aee7902dcfc719ff3728914839', 'PINNED: the request row''s limits (whose sentences are copied) are unchanged');
SELECT t.eq((SELECT p.proowner::regrole::text || '/' || p.prosecdef::text FROM pg_proc p
              WHERE p.oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure),
  'postgres/true', 'PINNED: game_respond_invite runs as its owner, so its insert is not counted');
SELECT t.eq((SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                               || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || ':' || coalesce(a.attacl::text, '-'),
                               ',' ORDER BY a.attnum)
               FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
              WHERE a.attrelid = to_regclass('public.game_removals') AND a.attnum > 0 AND NOT a.attisdropped),
  'game_id:text:true::-,user_id:uuid:true::-,removed_at:timestamp with time zone:true:now():-,'
  || 'asks:integer:true:0:-,last_ask_at:timestamp with time zone:false::-',
  'PINNED: the record gains asks (not null, 0) and last_ask_at, with no column grants');
SELECT t.eq((SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
               FROM pg_class c
               CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE c.oid = to_regclass('public.game_removals')
                AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated:SELECT,service_role:SELECT', 'PINNED: the table stays SELECT only for the API roles');
SELECT t.eq((SELECT string_agg(polname || ':' || polcmd::text, ', ' ORDER BY polname) FROM pg_policy
              WHERE polrelid = to_regclass('public.game_removals')),
  'Guardians see their children''s removals:r, Hosts see removals from their games:r, Players see their own removals:r',
  'PINNED: the same three read rules, no write rule');
ROLLBACK;
