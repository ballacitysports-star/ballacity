-- A host's removal sticks, on open games too (20261202100000_removal_sticks). Owner decisions 2026-11-24: "Removal
-- sticks on open games"; the way back is "Ask the host, or an invite".
-- 1. host_remove_player records the removal (public.game_removals) for a player who had something in the game (a roster
--    place, a request, a pending invitation); never the host's own seat, never a stranger, an unknown id or a deleted
--    account's leftover request (no error either), and its answer keeps its shape.
-- 2. The join gate refuses a removed player (REMOVED_BY_HOST) on any game: their own join and the server's place after
--    a payment. Anyone else's insert for that player gets the roster's row-level refusal, as for a player not removed.
-- 3. The way back: an approved request for the game. An accepted invitation, or the host approving the player's request
--    (on an open game the player sends one to ask back), deletes the record. A resend alone, a guardian's approval, an
--    accept answered full, or leaving does not. The request's resend cooldown and attempt cap apply to a resend; a
--    deleted request sent again starts over (an older gap, pinned as NOT CLOSED; owner item).
-- 4. Paid games: no payment (PayPal, manual claim, terms) for a removed player; a verified payment stays and is not a
--    way back.
-- 5. Guarded minors go through their guardian as before; age ranges and capacity apply as before.
-- 6. The waitlist notice skips a removed player, in the roster trigger and in the payment-hold release.
-- 7. Row level security: the player sees their own records, the host those for their games, a guardian their child's,
--    nobody else any; nobody writes through the API.
-- 8. A roster place keeps its game and its player (older hole: a player who hosts a game could move her own seat in it
--    into the game she was removed from, or a full or approval game, past every INSERT check). Position and attendance
--    updates by the player, the host and the service role work as before.
-- 9. A removed player cannot move her own claim back to pending (older hole: the claim check runs on INSERT only). Her
--    dispute and cancel, the host's changes, the service role and every player not removed work as before; after a
--    lift she may reopen again.
-- 10. Deleting the account or the game deletes the records.
-- 11. The definitions are pinned.
-- On a database without 20261202100000 (its rollback applied) the file still runs to the end: the table is read through
-- pg_temp helpers that answer -1 when it is missing, and the key assertions fail.
BEGIN;
SELECT t.person('host', 35), t.person('oth', 36), t.person('mod', 40), t.person('ana', 28), t.person('bob', 29),
       t.person('cal', 30), t.person('dee', 31), t.person('pay', 27), t.person('kid', 16), t.person('mom', 42),
       t.person('wes', 33), t.person('wil', 34), t.person('zed', 25), t.person('fox', 26), t.person('rq', 27),
       t.person('rd', 28), t.person('ri', 29), t.person('ru', 30), t.person('hp', 31), t.person('rwl', 32),
       t.person('nwl', 33), t.person('reg', 29), t.person('yon', 19), t.person('old', 45), t.person('gus', 24),
       t.person('gone', 30), t.person('sma', 27), t.person('smb', 28), t.person('smc', 29), t.person('smx', 30),
       t.person('rca', 26), t.person('rcb', 27), t.person('rcc', 28), t.person('rcd', 29), t.person('rce', 30),
       t.person('rcf', 31), t.person('rcj', 16), t.person('rck', 16), t.person('rcm', 44);
SELECT t.guardian('mom', 'kid'), t.guardian('rcm', 'rcj'), t.guardian('rcm', 'rck');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('mod'), 'moderator');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('gopen', t.id('host'), 'basketball', 'Open run',     now() + interval '3 days', 10, 0),
  ('gtwo',  t.id('host'), 'basketball', 'Other open',   now() + interval '3 days', 10, 0),
  ('gappr', t.id('host'), 'basketball', 'Approval run', now() + interval '3 days', 10, 0),
  ('gpaid', t.id('host'), 'basketball', 'Paid open',    now() + interval '3 days', 10, 10),
  ('gfull', t.id('host'), 'basketball', 'Small open',   now() + interval '3 days', 2, 0),
  ('glink', t.id('host'), 'basketball', 'Links',        now() + interval '3 days', 10, 0),
  ('ghold', t.id('host'), 'basketball', 'Hold run',     now() + interval '3 days', 2, 10),
  ('gpast', t.id('host'), 'basketball', 'Past run',     now() - interval '10 days', 10, 0),
  ('gage',  t.id('host'), 'basketball', 'Age range',    now() + interval '3 days', 10, 0);
UPDATE public.hosted_games SET min_age = 21 WHERE id = 'gage';
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('gopen', t.id('host'), 0, false), ('gtwo', t.id('host'), 0, false), ('gappr', t.id('host'), 0, true),
  ('gpaid', t.id('host'), 10, false), ('gfull', t.id('host'), 0, false), ('glink', t.id('host'), 0, false),
  ('gage', t.id('host'), 0, false);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_hold_minutes) VALUES
  ('ghold', t.id('host'), 10, true, 30);
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  created_at) VALUES
  (t.id('req-cal'), 'gappr', t.id('host'), t.id('cal'), 'approved', 'k1', now() - interval '3 hours', NULL, now() - interval '4 hours'),
  (t.id('req-kid'), 'gopen', t.id('host'), t.id('kid'), 'pending',  'guardian-only:gopen', NULL, NULL, now() - interval '4 hours'),
  (t.id('req-rq'),  'glink', t.id('host'), t.id('rq'),  'approved', 'k2', now() - interval '3 hours', NULL, now() - interval '4 hours'),
  (t.id('req-rd'),  'glink', t.id('host'), t.id('rd'),  'rejected', 'k3', now() - interval '2 hours', now() - interval '2 hours', now() - interval '4 hours'),
  -- ghold: hp was approved an hour ago and has not paid (the 30-minute window has run out).
  (t.id('req-hp'),  'ghold', t.id('host'), t.id('hp'),  'approved', 'k4', now() - interval '1 hour', NULL, now() - interval '90 minutes'),
  -- gtwo: gone was approved and then deleted their account (join_requests has no foreign key to auth.users).
  (t.id('req-gone'), 'gtwo', t.id('host'), t.id('gone'), 'approved', 'k5', now() - interval '3 hours', NULL, now() - interval '4 hours');
UPDATE public.join_requests SET guardian_approved_at = now() - interval '3 hours', guardian_approved_by = t.id('mom')
 WHERE id = t.id('req-kid');
INSERT INTO public.payment_submissions (game_id, player_id, host_id, paid_amount, status, payment_type) VALUES
  ('gpaid', t.id('pay'), t.id('host'), 10, 'verified', 'venmo');
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('gopen', t.id('ana')), ('gtwo', t.id('ana')), ('gappr', t.id('cal')), ('gpaid', t.id('pay')), ('gopen', t.id('kid')),
  ('gfull', t.id('wes')), ('gfull', t.id('zed')), ('gpaid', t.id('dee')), ('ghold', t.id('rwl')), ('gpast', t.id('reg')),
  ('gage', t.id('old')), ('gopen', t.id('gus'));
INSERT INTO public.game_position_waitlist (game_id, position, user_id, created_at) VALUES
  ('gfull', 'any', t.id('wes'), now() - interval '2 hours'), ('gfull', 'any', t.id('wil'), now() - interval '1 hour');
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id);
SET LOCAL session_replication_role = origin;
-- glink: ri has only a pending invitation.
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, created_at)
VALUES (t.id('inv-ri'), 'glink', t.id('host'), t.id('ri'), now() - interval '2 hours');

-- The player's own roster insert (the game page's join). Rows written, or the refusal's code.
CREATE FUNCTION pg_temp.join_as(game text, who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    INSERT INTO public.game_participants (game_id, user_id) VALUES (game, t.id(who));
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN PERFORM t.reset(); RETURN split_part(SQLERRM, ':', 1); END;
  PERFORM t.reset(); RETURN 'joined ' || n;
END $$;
-- `actor` inserts a roster row for `who`: the full refusal text.
CREATE FUNCTION pg_temp.insert_for(game text, who text, actor text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id(actor));
  BEGIN
    INSERT INTO public.game_participants (game_id, user_id) VALUES (game, t.id(who));
  EXCEPTION WHEN OTHERS THEN PERFORM t.reset(); RETURN SQLERRM; END;
  PERFORM t.reset(); RETURN 'inserted';
END $$;
CREATE FUNCTION pg_temp.remove(game text, who uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN PERFORM t.as_user(t.id('host')); r := public.host_remove_player(game, who); PERFORM t.reset(); RETURN r; END $$;
CREATE FUNCTION pg_temp.remove(game text, who text) RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.remove(game, t.id(who)) $$;
-- The player's record for the game, read as the table owner: 1 or 0, or -1 when there is no such table.
CREATE FUNCTION pg_temp.rec(game text, who uuid) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF to_regclass('public.game_removals') IS NULL THEN RETURN -1; END IF;
  EXECUTE 'SELECT count(*)::int FROM public.game_removals WHERE game_id = $1 AND user_id = $2' INTO n USING game, who;
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.rec(game text, who text) RETURNS int LANGUAGE sql AS $$ SELECT pg_temp.rec(game, t.id(who)) $$;
-- How many records `who` sees through the API (row level security), or -1 when there is no such table.
CREATE FUNCTION pg_temp.seen(who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF to_regclass('public.game_removals') IS NULL THEN RETURN -1; END IF;
  PERFORM t.as_user(t.id(who));
  n := t.count('SELECT 1 FROM public.game_removals');
  PERFORM t.reset();
  RETURN n;
END $$;
-- t.changed for a statement on the table, or -1 when there is no such table.
CREATE FUNCTION pg_temp.changed_rm(stmt text) RETURNS int LANGUAGE plpgsql AS $$
BEGIN
  IF to_regclass('public.game_removals') IS NULL THEN RETURN -1; END IF;
  RETURN t.changed(stmt);
END $$;
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
CREATE FUNCTION pg_temp.precond(game text, who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN PERFORM t.as_user(t.id(who)); r := public.paypal_payment_precondition(game); PERFORM t.reset(); RETURN COALESCE(r, 'NULL'); END $$;
-- The player asks the host (the game page's "Ask the host to let you back in"): a new request, or the declined one
-- sent again. 'sent', or the refusal's text.
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
-- The host approves the player's request (reviewJoinRequest, through the host's rule).
CREATE FUNCTION pg_temp.approve(game text, who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id('host'));
  n := t.changed(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now()
                           WHERE game_id = %L AND player_id = %L$q$, game, t.id(who)));
  PERFORM t.reset();
  RETURN n;
END $$;
-- Move a request's last decline back past the 15-minute resend cooldown.
CREATE FUNCTION pg_temp.past_cooldown(game text, who text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  UPDATE public.join_requests SET last_rejected_at = now() - interval '1 hour' WHERE game_id = game AND player_id = t.id(who);
  SET LOCAL session_replication_role = origin;
END $$;
CREATE FUNCTION pg_temp.waitlist_told(game text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(p.handle, ',' ORDER BY p.handle)
    FROM public.notifications n
    JOIN (VALUES ('wes'), ('wil'), ('rwl'), ('nwl')) p(handle) ON n.user_id = t.id(p.handle)
   WHERE n.type = 'waitlist_spot_open' AND n.link = '/games/' || game $$;

-- ================= 1. the removal is recorded, for a player who had something in the game =================
SELECT t.eq(pg_temp.remove('gopen', 'ana'), '{"removed": true, "request_declined": false, "invites_cancelled": 0}'::jsonb,
  'host_remove_player answers as before (a roster place, no request, no invitation)');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'REMOVAL: a roster place taken is recorded');
SELECT t.eq(pg_temp.rec('gtwo', 'ana'), 0, 'only for that game');
SELECT t.eq(pg_temp.remove('glink', 'rq'), '{"removed": false, "request_declined": true, "invites_cancelled": 0}'::jsonb,
  'an approved player not on the roster yet: the request is declined');
SELECT t.eq(pg_temp.rec('glink', 'rq'), 1, 'REMOVAL: an approved request is a link: recorded');
SELECT t.eq(pg_temp.remove('glink', 'rd'), '{"removed": false, "request_declined": false, "invites_cancelled": 0}'::jsonb,
  'an already declined request: nothing else changes');
SELECT t.eq(pg_temp.rec('glink', 'rd'), 1, 'REMOVAL: a declined request is a link too: recorded');
SELECT t.eq(pg_temp.remove('glink', 'ri'), '{"removed": false, "request_declined": false, "invites_cancelled": 1}'::jsonb,
  'a pending invitation only: it is cancelled');
SELECT t.eq(pg_temp.rec('glink', 'ri'), 1, 'REMOVAL: a pending invitation is a link: recorded');
SELECT t.eq(pg_temp.remove('glink', 'ru'), '{"removed": false, "request_declined": false, "invites_cancelled": 0}'::jsonb,
  'a user with nothing in the game: the same answer as before');
SELECT t.eq(pg_temp.rec('glink', 'ru'), 0, 'NO LINK: and nothing is recorded (a host cannot ban a stranger in advance)');
SELECT t.eq(pg_temp.remove('glink', '00000000-0000-4000-8000-00000000d00d'::uuid),
  '{"removed": false, "request_declined": false, "invites_cancelled": 0}'::jsonb,
  'NO LINK: an id with no account: the same answer, no error (no account check)');
SELECT t.eq(pg_temp.rec('glink', '00000000-0000-4000-8000-00000000d00d'::uuid), 0, 'NO LINK: and nothing is recorded');
-- A deleted account's leftover request: declined as before, nothing recorded, no error naming the missing account.
DELETE FROM auth.users WHERE id = t.id('gone');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE game_id = 'gtwo' AND player_id = t.id('gone')), 1,
  'a deleted account leaves its request behind');
SELECT t.eq(pg_temp.remove('gtwo', 'gone'), '{"removed": false, "request_declined": true, "invites_cancelled": 0}'::jsonb,
  'DELETED ACCOUNT: removing its leftover request answers as before, with no error');
SELECT t.eq((SELECT status FROM public.join_requests WHERE game_id = 'gtwo' AND player_id = t.id('gone')), 'rejected',
  'DELETED ACCOUNT: the request is declined');
SELECT t.eq(pg_temp.rec('gtwo', 'gone'), 0, 'DELETED ACCOUNT: and nothing is recorded');
SELECT t.eq(pg_temp.remove('gopen', 'ana'), '{"removed": false, "request_declined": false, "invites_cancelled": 0}'::jsonb,
  'removing ana again (no place, no request, no invitation left): the answer as before');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'and her record stays');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('gopen', t.id('host')) ->> 'removed', 'false', 'the host''s own seat (not on this roster)');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gtwo', t.id('host'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('gtwo', t.id('host')) ->> 'removed', 'true', 'the host takes their own seat');
SELECT t.reset();
SELECT t.eq(pg_temp.rec('gtwo', 'host'), 0, 'NO RECORD: the host''s own seat is never recorded');
SELECT t.as_user(t.id('oth'));
SELECT t.throws($q$SELECT public.host_remove_player('gopen', t.id('bob'))$q$, 'NOT_GAME_HOST', 'another user cannot remove anyone');
SELECT t.reset();
SELECT t.as_user(t.id('mod'));
SELECT t.throws($q$SELECT public.host_remove_player('gopen', t.id('gus'))$q$, 'NOT_GAME_HOST', 'nor can a moderator (the roster rule has no moderator clause)');
SELECT t.reset();
SELECT t.eq(pg_temp.rec('gopen', 'gus'), 0, 'and nothing is recorded');

-- ================= 2. the gate refuses a removed player =================
SELECT t.eq(pg_temp.join_as('gopen', 'ana'), 'REMOVED_BY_HOST', 'GATE: a removed player cannot join the open game again');
SELECT t.eq(pg_temp.join_as('gopen', 'bob'), 'joined 1', 'another player joins as before');
SELECT t.eq(pg_temp.join_as('glink', 'ru'), 'joined 1', 'a stranger the host tried to remove joins as before');
SELECT t.as_service();
SELECT t.throws($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('gopen', t.id('ana'))$q$, 'REMOVED_BY_HOST',
  'GATE: the server''s write (no signed-in user, as after a payment) is refused too');
SELECT t.reset();
-- Anyone else's insert for her is refused by the roster's row-level rule, exactly as for a player not removed.
SELECT t.eq(pg_temp.insert_for('gopen', 'ana', 'oth'), pg_temp.insert_for('gopen', 'dee', 'oth'),
  'PRIVATE: a stranger''s insert for a removed player gets the same refusal as for one not removed');
SELECT t.ok(pg_temp.insert_for('gopen', 'ana', 'oth') LIKE '%row-level security%',
  'PRIVATE: and that refusal is the row-level rule, not REMOVED_BY_HOST');
SELECT t.ok(pg_temp.insert_for('gopen', 'ana', 'bob') LIKE '%row-level security%', 'PRIVATE: so is another player''s');
SELECT t.eq((SELECT count(*)::int FROM public.game_participants WHERE game_id = 'gopen' AND user_id = t.id('ana')), 0,
  'ana stays off the roster');

-- ================= 3. row level security =================
SELECT t.eq(pg_temp.seen('ana'), 1, 'RLS: the player sees her own record');
SELECT t.as_user(t.id('ana'));
SELECT t.eq(pg_temp.changed_rm($q$DELETE FROM public.game_removals$q$), 0, 'RLS: she cannot delete it');
SELECT t.throws($q$INSERT INTO public.game_removals (game_id, user_id) VALUES ('gtwo', t.id('ana'))$q$, 'permission denied',
  'RLS: nor write one');
SELECT t.reset();
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'the record is still there');
SELECT t.eq(pg_temp.seen('host'), 4, 'RLS: the host sees the records for their games (ana, rq, rd, ri)');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$INSERT INTO public.game_removals (game_id, user_id) VALUES ('gopen', t.id('bob'))$q$, 'permission denied',
  'RLS: the host cannot write one directly');
SELECT t.throws($q$DELETE FROM public.game_removals WHERE game_id = 'gopen'$q$, 'permission denied',
  'RLS: nor delete one (only an approved request lifts it)');
SELECT t.reset();
SELECT t.eq(pg_temp.seen('oth'), 0, 'RLS: another host sees none');
SELECT t.eq(pg_temp.seen('bob'), 0, 'RLS: another player sees none');
SELECT t.eq(pg_temp.seen('mod'), 0, 'RLS: a moderator sees none through the API');
SELECT t.eq((SELECT CASE WHEN to_regclass('public.game_removals') IS NOT NULL
                          THEN has_table_privilege('anon', 'public.game_removals', 'SELECT') END), false, 'RLS: visitors have no access');

-- ================= 4. the way back =================
-- a) An accepted invitation seats her and deletes the record; leaving after that leaves it deleted.
SELECT t.eq(pg_temp.accept(pg_temp.invite('gopen', 'ana'), 'ana') ->> 'on_roster', 'true', 'INVITE: an accepted invitation seats ana');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 0, 'INVITE: and deletes the record');
SELECT t.as_user(t.id('ana'));
SELECT t.eq(t.changed($q$DELETE FROM public.game_participants WHERE game_id = 'gopen' AND user_id = t.id('ana')$q$), 1, 'she leaves');
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')$q$), 1,
  'and withdraws her request');
SELECT t.reset();
SELECT t.eq(pg_temp.join_as('gopen', 'ana'), 'joined 1', 'INVITE: after a voluntary leave she can rejoin (the lift stays)');
-- b) Asking the host on an open game: her request waits for the host; the host's approval lets her back.
SELECT t.eq(pg_temp.remove('gopen', 'ana') ->> 'request_declined', 'false', 'ana removed again (no request now)');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent', 'ASK: a removed player can ask the host on an open game');
SELECT t.eq((SELECT status FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')), 'pending',
  'ASK: the request is pending');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'ASK: sending it does not lift the removal');
SELECT t.eq(pg_temp.join_as('gopen', 'ana'), 'REMOVED_BY_HOST', 'ASK: so she still cannot join');
SELECT t.eq(pg_temp.approve('gopen', 'ana'), 1, 'ASK: the host approves it');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 0, 'ASK: which deletes the record');
SELECT t.eq(pg_temp.join_as('gopen', 'ana'), 'joined 1', 'ASK: and she joins');
-- c) A declined request: the cooldown and the attempt cap apply to the ask.
SELECT t.eq(pg_temp.remove('gopen', 'ana') ->> 'request_declined', 'true', 'removed again: her approved request is declined');
SELECT t.ok(pg_temp.ask('gopen', 'ana') LIKE 'Please wait%', 'COOLDOWN: asking again at once is refused');
SELECT pg_temp.past_cooldown('gopen', 'ana');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent', 'COOLDOWN: after the cooldown she can ask again');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now()
                          WHERE game_id = 'gopen' AND player_id = t.id('ana')$q$), 1, 'the host says no');
SELECT t.reset();
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'a no keeps the record');
SELECT pg_temp.past_cooldown('gopen', 'ana');
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent', 'she asks once more');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now()
                          WHERE game_id = 'gopen' AND player_id = t.id('ana')$q$), 1, 'no again');
SELECT t.reset();
SELECT pg_temp.past_cooldown('gopen', 'ana');
SELECT t.ok(pg_temp.ask('gopen', 'ana') LIKE '%maximum of 3%', 'CAP: the third resend is refused (attempt cap)');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'CAP: and the removal stays');
-- The cooldown and the cap live on the request row: a player may delete their own request ("Players withdraw own join
-- requests") and send a new one, which starts over. Older than this change (20261129130000, 20261130110000); owner item.
SELECT t.as_user(t.id('ana'));
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')$q$), 1,
  'she deletes her declined request');
SELECT t.reset();
SELECT t.eq(pg_temp.ask('gopen', 'ana'), 'sent',
  'NOT CLOSED: a new request after deleting the declined one skips the cooldown and the cap (older gap; owner item)');
SELECT t.eq(pg_temp.rec('gopen', 'ana'), 1, 'the removal itself stays: only the host''s approval or an invitation lifts it');
SELECT t.eq(pg_temp.join_as('gopen', 'ana'), 'REMOVED_BY_HOST', 'and she still cannot join');
SELECT t.as_user(t.id('ana'));
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'gopen' AND player_id = t.id('ana')$q$), 1,
  'she cancels that ask');
SELECT t.reset();
-- d) An accept that answers full keeps the record; an approval on a full game lifts it but there is no seat.
SELECT t.eq(pg_temp.remove('gfull', 'zed') ->> 'removed', 'true', 'zed removed from the small game');
SELECT t.eq(pg_temp.join_as('gfull', 'fox'), 'joined 1', 'fox takes the place: full again');
SELECT t.eq(pg_temp.accept(pg_temp.invite('gfull', 'zed'), 'zed') ->> 'status', 'full', 'CAPACITY: an accept on a full game answers full');
SELECT t.eq(pg_temp.rec('gfull', 'zed'), 1, 'CAPACITY: and keeps the record');
SELECT t.eq(pg_temp.ask('gfull', 'zed'), 'sent', 'zed asks the host instead');
SELECT t.eq(pg_temp.approve('gfull', 'zed'), 1, 'the host approves');
SELECT t.eq(pg_temp.rec('gfull', 'zed'), 0, 'CAPACITY: the approval lifts the removal');
SELECT t.eq(pg_temp.join_as('gfull', 'zed'), 'GAME_FULL', 'CAPACITY: but a full game is still full');
-- e) A game that needs approval: her own join meets the approval check first; a resend alone keeps the record.
SELECT t.eq(pg_temp.remove('gappr', 'cal') ->> 'request_declined', 'true', 'cal removed: request declined');
SELECT t.eq(pg_temp.join_as('gappr', 'cal'), 'GAME_APPROVAL_REQUIRED', 'APPROVAL GAME: her own join reads the approval check first');
SELECT pg_temp.past_cooldown('gappr', 'cal');
SELECT t.eq(pg_temp.ask('gappr', 'cal'), 'sent', 'she resends after the cooldown');
SELECT t.eq(pg_temp.rec('gappr', 'cal'), 1, 'APPROVAL GAME: a resend alone keeps the record');
SELECT t.eq(pg_temp.approve('gappr', 'cal'), 1, 'the host approves');
SELECT t.eq(pg_temp.rec('gappr', 'cal'), 0, 'APPROVAL GAME: the approval lifts it');
SELECT t.eq(pg_temp.join_as('gappr', 'cal'), 'joined 1', 'APPROVAL GAME: and cal joins');
-- f) Invitations through game_invite_player: a removed regular can be invited and the accept lets them back; a removed
--    adult with no post and no past game cannot be invited (their way back is the request).
SELECT t.eq(pg_temp.join_as('gopen', 'reg'), 'joined 1', 'reg (who played the host''s past game) joins the open game');
SELECT t.eq(pg_temp.remove('gopen', 'reg') ->> 'removed', 'true', 'and is removed');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$SELECT public.game_invite_players('gopen', ARRAY[t.id('reg')])$q$, 'INVITE: the host can invite a removed regular');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.game_invites WHERE game_id = 'gopen' AND invitee_id = t.id('reg') AND status = 'pending'),
  1, 'INVITE: the invitation is pending');
SELECT t.eq(pg_temp.accept((SELECT id FROM public.game_invites WHERE game_id = 'gopen' AND invitee_id = t.id('reg') AND status = 'pending'),
                           'reg') ->> 'on_roster', 'true', 'INVITE: accepting it seats the regular');
SELECT t.eq(pg_temp.rec('gopen', 'reg'), 0, 'INVITE: and lifts the removal');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$SELECT public.game_invite_player('gopen', t.id('ana'))$q$, 'INVITE_NOT_AVAILABLE',
  'INVITE: a removed adult with no open post and no past game cannot be invited (as for anyone)');
SELECT t.reset();

-- ================= 5. paid open game =================
SELECT t.eq(pg_temp.remove('gpaid', 'pay') ->> 'removed', 'true', 'the paid player is removed');
SELECT t.eq((SELECT status FROM public.payment_submissions WHERE game_id = 'gpaid' AND player_id = t.id('pay')), 'verified',
  'PAID: the verified payment is untouched');
SELECT t.eq(pg_temp.join_as('gpaid', 'pay'), 'REMOVED_BY_HOST', 'PAID: a verified payment does not let him back');
SELECT t.eq(pg_temp.precond('gpaid', 'pay'), 'ALREADY_PAID', 'PAID: PayPal answers already paid (no second charge)');
SELECT t.eq(pg_temp.remove('gpaid', 'dee') ->> 'removed', 'true', 'dee (on the roster, not paid) is removed');
SELECT t.eq(pg_temp.precond('gpaid', 'dee'), 'REMOVED_BY_HOST', 'PAID: PayPal refuses a removed player before any order');
SELECT t.as_user(t.id('dee'));
SELECT t.throws($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type) VALUES ('gpaid', t.id('host'), t.id('dee'), 'venmo')$q$,
  'REMOVED_BY_HOST: the host removed you from this game, so a payment for it cannot be recorded',
  'PAID: the manual claim is refused, in words that name the payment');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_payment_terms('gpaid')), 0, 'PAID: no payment terms for a removed player');
SELECT t.reset();
SELECT t.eq(pg_temp.accept(pg_temp.invite('gpaid', 'dee'), 'dee') ->> 'status', 'accepted', 'PAID: an invitation is accepted (a paid game seats on payment)');
SELECT t.eq(pg_temp.rec('gpaid', 'dee'), 0, 'PAID: the accept lifts the removal although it does not seat');
SELECT t.eq(pg_temp.precond('gpaid', 'dee'), 'NULL', 'PAID: and dee may pay');

-- ================= 6. a guarded minor on an open game =================
SELECT t.eq(pg_temp.remove('gopen', 'kid') ->> 'request_declined', 'true', 'kid removed: the request to the guardian is declined');
SELECT pg_temp.past_cooldown('gopen', 'kid');
SELECT t.eq(pg_temp.ask('gopen', 'kid'), 'sent', 'YOUTH: kid asks again after the cooldown');
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-kid'), true);
SELECT t.reset();
SELECT t.eq(pg_temp.rec('gopen', 'kid'), 1, 'YOUTH: the guardian''s approval alone does not lift the removal');
SELECT t.eq(pg_temp.seen('mom'), 1,
  'YOUTH: the guardian sees the child''s record, and only it (the Parent Center says the host must also agree)');
SELECT t.eq(pg_temp.join_as('gopen', 'kid'), 'REMOVED_BY_HOST', 'YOUTH: so kid cannot join on it');
SELECT t.eq(pg_temp.approve('gopen', 'kid'), 1, 'YOUTH: the host approves the request');
SELECT t.eq(pg_temp.rec('gopen', 'kid'), 0, 'YOUTH: which lifts the removal');
SELECT t.eq(pg_temp.join_as('gopen', 'kid'), 'joined 1', 'YOUTH: and with the guardian''s approval kid joins');
-- Removed again, then an invitation accepted with no resend: held for the guardian, the removal lifted.
SELECT t.eq(pg_temp.remove('gopen', 'kid') ->> 'request_declined', 'true', 'kid removed again');
SELECT t.eq(pg_temp.accept(pg_temp.invite('gopen', 'kid'), 'kid') ->> 'on_roster', 'false', 'YOUTH: an accept holds kid for the guardian');
SELECT t.eq(pg_temp.rec('gopen', 'kid'), 0, 'YOUTH: the accept lifts the removal');
SELECT t.eq(pg_temp.join_as('gopen', 'kid'), 'GUARDIAN_APPROVAL_REQUIRED', 'YOUTH: the guardian rule still applies');
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-kid'), true);
SELECT t.reset();
SELECT t.eq(pg_temp.join_as('gopen', 'kid'), 'joined 1', 'YOUTH: after the guardian approves, kid joins');
SELECT t.eq(pg_temp.seen('mom'), 0, 'YOUTH: lifted, so the guardian has no record to see');
-- Age range: a removed player outside the range comes back only through the host's approval, which also clears the age.
SELECT t.ok(pg_temp.join_as('gage', 'yon') LIKE 'This game has an age requirement%', 'AGE: yon (19) cannot join the 21+ game directly');
SELECT t.eq(pg_temp.remove('gage', 'old') ->> 'removed', 'true', 'old (45) is removed from it');
SELECT t.eq(pg_temp.join_as('gage', 'old'), 'REMOVED_BY_HOST', 'AGE: inside the range, the removal still refuses old');
SELECT t.eq(pg_temp.ask('gage', 'old'), 'sent', 'old asks the host');
SELECT t.eq(pg_temp.approve('gage', 'old'), 1, 'the host approves');
SELECT t.eq(pg_temp.join_as('gage', 'old'), 'joined 1', 'AGE: old joins again');

-- ================= 7. the waitlist notice skips a removed player =================
SELECT pg_temp.remove('gfull', 'wes');
SELECT t.eq(pg_temp.waitlist_told('gfull'), 'wil', 'WAITLIST: the removal opens a place: wil is told (wes is the one leaving)');
SELECT t.as_user(t.id('fox'));
SELECT t.eq(t.changed($q$DELETE FROM public.game_participants WHERE game_id = 'gfull' AND user_id = t.id('fox')$q$), 1, 'fox leaves');
SELECT t.reset();
SELECT t.eq(pg_temp.waitlist_told('gfull'), 'wil', 'WAITLIST: the next place is not offered to wes (removed, first in line); wil was told already');
-- The payment-hold release picks the next waitlisted player itself.
SELECT t.eq(pg_temp.remove('ghold', 'rwl') ->> 'removed', 'true', 'rwl is removed from the hold game');
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('ghold', t.id('hp')), ('ghold', t.id('gus'));
INSERT INTO public.game_position_waitlist (game_id, position, user_id, created_at) VALUES
  ('ghold', 'any', t.id('rwl'), now() - interval '2 hours'), ('ghold', 'any', t.id('nwl'), now() - interval '1 hour');
SET LOCAL session_replication_role = origin;
SELECT t.eq(public.release_expired_payment_holds('ghold'), 1, 'the release frees hp''s unpaid place');
SELECT t.eq(pg_temp.waitlist_told('ghold'), 'nwl', 'WAITLIST: the release tells nwl, not rwl (removed, first in line)');

-- ================= 8. a roster place stays in its game and with its player =================
-- Older hole closed here: a player who hosts a game could UPDATE her own seat in it and point it at another game (the
-- one she was removed from, a full one, one that needs approval), skipping every INSERT check and the joined count.
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('smopen', t.id('host'), 'basketball', 'Seat open',     now() + interval '3 days', 10, 0),
  ('smmine', t.id('sma'),  'basketball', 'Seat own game', now() + interval '4 days', 10, 0),
  ('smappr', t.id('host'), 'basketball', 'Seat approval', now() + interval '3 days', 1, 0),
  ('smpast', t.id('host'), 'basketball', 'Seat started',  now() - interval '1 hour', 10, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('smopen', t.id('host'), 0, false), ('smmine', t.id('sma'), 0, false), ('smappr', t.id('host'), 0, true),
  ('smpast', t.id('host'), 0, false);
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('smopen', t.id('sma')), ('smopen', t.id('smb')), ('smmine', t.id('sma')), ('smappr', t.id('smx')),
  ('smpast', t.id('smc'));
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id)
 WHERE g.id IN ('smopen', 'smmine', 'smappr', 'smpast');
SET LOCAL session_replication_role = origin;
SELECT t.eq(pg_temp.remove('smopen', 'sma') ->> 'removed', 'true', 'sma (who hosts smmine and sits in it) is removed from smopen');
SELECT t.as_user(t.id('sma'));
SELECT t.throws($q$UPDATE public.game_participants SET game_id = 'smopen' WHERE game_id = 'smmine' AND user_id = t.id('sma')$q$,
  'ROW_IDENTITY_FIXED', 'SEAT: a removed player cannot move her seat in her own game into the game she was removed from');
SELECT t.throws($q$UPDATE public.game_participants SET game_id = 'smappr' WHERE game_id = 'smmine' AND user_id = t.id('sma')$q$,
  'ROW_IDENTITY_FIXED', 'SEAT: nor into a full game that needs the host''s approval');
SELECT t.throws($q$UPDATE public.game_participants SET user_id = t.id('smb') WHERE game_id = 'smmine' AND user_id = t.id('sma')$q$,
  'ROW_IDENTITY_FIXED', 'SEAT: nor hand her seat to another player');
SELECT t.as_user(t.id('smb'));
SELECT t.throws($q$UPDATE public.game_participants SET game_id = 'smmine' WHERE game_id = 'smopen' AND user_id = t.id('smb')$q$,
  'ROW_IDENTITY_FIXED', 'SEAT: a player who hosts nothing cannot move a seat either');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(game_id || ':' || (SELECT handle FROM (VALUES ('sma'), ('smb'), ('smx'), ('smc')) h(handle)
                                                  WHERE t.id(h.handle) = user_id), ',' ORDER BY game_id, user_id)
               FROM public.game_participants WHERE game_id IN ('smopen', 'smmine', 'smappr', 'smpast')),
  (SELECT string_agg(x, ',' ORDER BY x) FROM unnest(ARRAY['smappr:smx', 'smmine:sma', 'smopen:smb', 'smpast:smc']) x),
  'SEAT: every place is where it was');
SELECT t.eq(pg_temp.rec('smopen', 'sma'), 1, 'SEAT: and sma''s removal stands');
SELECT t.eq((SELECT string_agg(g.id || '=' || g.joined || '/' || (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id),
                               ',' ORDER BY g.id)
               FROM public.hosted_games g WHERE g.id IN ('smopen', 'smmine', 'smappr')),
  'smappr=1/1,smmine=1/1,smopen=1/1', 'SEAT: each joined count matches its roster');
-- What a roster row may still change, as before.
SELECT t.as_user(t.id('smb'));
SELECT t.eq(t.changed($q$UPDATE public.game_participants SET position = 'guard' WHERE game_id = 'smopen' AND user_id = t.id('smb')$q$), 1,
  'POSITION: a player still sets her own position');
SELECT t.throws($q$UPDATE public.game_participants SET attended = true WHERE game_id = 'smopen' AND user_id = t.id('smb')$q$,
  'ATTENDANCE_FORBIDDEN', 'POSITION: and still cannot mark her own attendance');
SELECT t.as_user(t.id('sma'));
SELECT t.eq(t.changed($q$UPDATE public.game_participants SET position = 'center' WHERE game_id = 'smmine' AND user_id = t.id('sma')$q$), 1,
  'POSITION: a host still sets the position of her own seat');
SELECT t.as_user(t.id('host'));
SELECT public.host_mark_attendance('smpast', t.id('smc'), true);
SELECT t.reset();
SELECT t.eq((SELECT attended FROM public.game_participants WHERE game_id = 'smpast' AND user_id = t.id('smc')), true,
  'ATTENDANCE: the host still marks attendance (host_mark_attendance)');
SELECT t.as_service();
SELECT t.eq(t.changed($q$UPDATE public.game_participants SET position = 'wing' WHERE game_id = 'smopen' AND user_id = t.id('smb')$q$), 1,
  'SCOPE: the service role still updates a roster row (the lock binds the API roles, as for the waitlist and payments)');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(position, ',' ORDER BY game_id) FROM public.game_participants
              WHERE (game_id, user_id) IN (('smmine', t.id('sma')), ('smopen', t.id('smb')))), 'center,wing',
  'POSITION: the positions were written');

-- ================= 9. a removed player cannot reopen a payment claim =================
-- Older hole closed here: the claim check runs on INSERT only, and a player may move her own settled claim back to
-- pending. Removed, she may not; every other move stays as it was.
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('rcpaid', t.id('host'), 'basketball', 'Claims open', now() + interval '3 days', 12, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('rcpaid', t.id('host'), 10, false);
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('rcpaid', t.id('rca')), ('rcpaid', t.id('rcb')), ('rcpaid', t.id('rcd')), ('rcpaid', t.id('rce')),
  ('rcpaid', t.id('rcf')), ('rcpaid', t.id('rcj'));
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id) WHERE g.id = 'rcpaid';
INSERT INTO public.payment_submissions (game_id, player_id, host_id, paid_amount, status, payment_type)
SELECT 'rcpaid', t.id(h), t.id('host'), 10, s, 'venmo'
  FROM (VALUES ('rca', 'cancelled'), ('rcb', 'rejected'), ('rcc', 'cancelled'), ('rcd', 'verified'), ('rce', 'pending'),
               ('rcf', 'rejected'), ('rcj', 'cancelled'), ('rck', 'cancelled')) v(h, s);
SET LOCAL session_replication_role = origin;
SELECT t.eq((SELECT count(*)::int FROM (SELECT pg_temp.remove('rcpaid', h) ->> 'removed' AS r
                                          FROM unnest(ARRAY['rca', 'rcb', 'rcd', 'rce', 'rcf', 'rcj']) h) x WHERE r = 'true'),
  6, 'rca, rcb, rcd, rce, rcf and rcj (a minor) are removed from the paid game');
-- (the claim, as its player)
CREATE FUNCTION pg_temp.claim_to(who text, st text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    UPDATE public.payment_submissions SET status = st WHERE game_id = 'rcpaid' AND player_id = t.id(who);
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN PERFORM t.reset(); RETURN SQLERRM; END;
  PERFORM t.reset(); RETURN 'changed ' || n;
END $$;
CREATE FUNCTION pg_temp.claim_status(who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.payment_submissions WHERE game_id = 'rcpaid' AND player_id = t.id(who) $$;
SELECT t.eq(pg_temp.claim_to('rca', 'pending'),
  'REMOVED_BY_HOST: the host removed you from this game, so a payment for it cannot be recorded.',
  'CLAIM: a removed player cannot reopen her cancelled claim (the insert path''s code and words)');
SELECT t.eq(pg_temp.claim_to('rcb', 'pending'),
  'REMOVED_BY_HOST: the host removed you from this game, so a payment for it cannot be recorded.',
  'CLAIM: nor a claim the host declined');
SELECT t.eq(pg_temp.claim_to('rcb', 'disputed'), 'changed 1', 'CLAIM: she may still dispute the host''s decline, as before');
SELECT t.ok(pg_temp.claim_to('rcb', 'pending') LIKE 'REMOVED_BY_HOST:%', 'CLAIM: but not move the dispute back to pending');
SELECT t.eq(pg_temp.claim_to('rce', 'cancelled'), 'changed 1', 'CLAIM: a claim pending at the removal can still be cancelled');
SELECT t.ok(pg_temp.claim_to('rce', 'pending') LIKE 'REMOVED_BY_HOST:%', 'CLAIM: and then not reopened');
SELECT t.ok(pg_temp.claim_to('rcj', 'pending') LIKE 'REMOVED_BY_HOST:%', 'CLAIM: a removed minor cannot reopen hers either');
SELECT t.eq(pg_temp.claim_status('rca') || ',' || pg_temp.claim_status('rcb') || ',' || pg_temp.claim_status('rce') || ','
            || pg_temp.claim_status('rcj'), 'cancelled,disputed,cancelled,cancelled', 'CLAIM: no claim of a removed player went back to pending');
SELECT t.eq(pg_temp.claim_to('rcc', 'pending'), 'changed 1', 'NOT REMOVED: a player not removed reopens her cancelled claim as before');
SELECT t.eq(pg_temp.claim_to('rck', 'pending'), 'changed 1', 'NOT REMOVED: so does a minor not removed');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.payment_submissions SET status = 'pending' WHERE game_id = 'rcpaid' AND player_id = t.id('rcd')$q$), 1,
  'HOST: the host''s Mark unpaid (verified -> pending) for a removed player goes on as before');
SELECT t.eq(t.changed($q$UPDATE public.payment_submissions SET status = 'rejected' WHERE game_id = 'rcpaid' AND player_id = t.id('rcd')$q$), 1,
  'HOST: and the host declines it as before');
SELECT t.as_service();
SELECT t.eq(t.changed($q$UPDATE public.payment_submissions SET status = 'pending' WHERE game_id = 'rcpaid' AND player_id = t.id('rca')$q$), 1,
  'SERVICE: the service role may still move a removed player''s claim to pending (not the player)');
SELECT t.reset();
-- The way back reopens the way: once the host lets her back, she may reopen as before.
SELECT t.ok(pg_temp.claim_to('rcf', 'pending') LIKE 'REMOVED_BY_HOST:%', 'rcf cannot reopen while removed');
SELECT t.eq(pg_temp.ask('rcpaid', 'rcf'), 'sent', 'rcf asks the host');
SELECT t.eq(pg_temp.approve('rcpaid', 'rcf'), 1, 'the host approves');
SELECT t.eq(pg_temp.rec('rcpaid', 'rcf'), 0, 'which lifts the removal');
SELECT t.eq(pg_temp.claim_to('rcf', 'pending'), 'changed 1', 'LIFTED: rcf reopens her declined claim as before');

-- ================= 10. deleting the account or the game deletes the records =================
SELECT t.eq(pg_temp.rec('glink', 'rd'), 1, 'rd''s record is there');
DELETE FROM auth.users WHERE id = t.id('rd');
SELECT t.eq(pg_temp.rec('glink', 'rd'), 0, 'CASCADE: deleting the account deletes its records');
SELECT t.eq(pg_temp.rec('glink', 'rq'), 1, 'rq''s record is there');
DELETE FROM public.hosted_games WHERE id = 'glink';
SELECT t.eq(pg_temp.rec('glink', 'rq') + pg_temp.rec('glink', 'ri'), 0, 'CASCADE: deleting the game deletes its records');

-- ================= 11. the definitions are pinned =================
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('public.enforce_game_join_gate()'::regprocedure), $b$-- A player the host removed from this game (public.game_removals, written by host_remove_player; 20261202100000) is
  -- refused until the host lets them back: an approved request for the game (an accepted invitation, or the host's
  -- approval) deletes the record. Asked for the player's own join and for a write with no signed-in user (the server's
  -- place after a payment), as enforce_host_block scopes its check: anyone else's insert for that player is refused by
  -- the roster's row-level rule after this trigger, so it cannot tell whether the player was removed. The host's and
  -- a moderator's own writes returned above.
  IF (auth.uid() IS NULL OR _self)
     AND EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = NEW.game_id AND rm.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'REMOVED_BY_HOST: the host removed you from this game.'
      USING ERRCODE = 'P0001';
  END IF;

  $b$, ''))),
  '9d4924a2d53915fca8fa245e15281a25', 'PINNED: public.enforce_game_join_gate() is the live definition character for character apart from its one added block');
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('public.host_remove_player(text,uuid)'::regprocedure), $b$-- The removal itself (20261202100000), so the join gate keeps the player out until the host lets them back in. Only
  -- for a player who had something in this game: a roster place, a request (any status) or a pending invitation; a user
  -- with none of those, or no such user, writes nothing and gets the answer as before. Never the host's own seat. Taken
  -- last, after the request, as game_respond_invite's lift (through the request's approval) takes it. A repeated
  -- removal stamps the latest time.
  -- A deleted account's leftover request (join_requests has no foreign key to auth.users) writes nothing: the old
  -- answer, and no error that says the account is gone.
  IF _player IS DISTINCT FROM _me AND (_removed > 0 OR _jr.id IS NOT NULL OR _cancelled > 0) THEN
    BEGIN
      INSERT INTO public.game_removals AS rm (game_id, user_id)
      VALUES (_game, _player)
      ON CONFLICT (game_id, user_id) DO UPDATE SET removed_at = now();
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;
    END;
  END IF;

  $b$, ''))),
  'ebdc548c85bd4abf4545f48ced07fddd', 'PINNED: public.host_remove_player(text,uuid) is the live definition character for character apart from its one added block');
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('private_sec.payment_claim_block(text,uuid)'::regprocedure), $b$-- The join gate: a player the host removed from this game, until the host lets them back (20261202100000).
  IF EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = _game_id AND rm.user_id = _player) THEN
    RETURN 'REMOVED_BY_HOST';
  END IF;
  $b$, ''))),
  '46a3cc02d2146f73270e679d2284a1b9', 'PINNED: private_sec.payment_claim_block(text,uuid) is the live definition character for character apart from its one added block');
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('public.enforce_payment_claim_preconditions()'::regprocedure), $b$WHEN 'REMOVED_BY_HOST' THEN 'the host removed you from this game, so a payment for it cannot be recorded.'
      $b$, ''))),
  '8773e6a6822cd83426eb9d206e884b25', 'PINNED: public.enforce_payment_claim_preconditions() is the live definition character for character apart from its one added block');
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('public.notify_waitlist_on_spot_open()'::regprocedure), $b$removals rm WHERE rm.game_id = w.game_id AND rm.user_id = w.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.game_$b$, ''))),
  '0133bf0cb2c54557e05d56de2926daf1', 'PINNED: public.notify_waitlist_on_spot_open() is the live definition character for character apart from its one added block');
SELECT t.eq((SELECT md5(replace(pg_get_functiondef('public.release_expired_payment_holds(text)'::regprocedure), $b$EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = w.game_id AND rm.user_id = w.user_id)
       AND NOT $b$, ''))),
  '856c6a3999e1dfaf216e12a2ad998004', 'PINNED: public.release_expired_payment_holds(text) is the live definition character for character apart from its one added block');
SELECT t.eq((SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid = to_regprocedure(w.fn)), w.md5,
  'PINNED: ' || w.fn || ' is the one 20261202100000 created (the rollback guard expects it)')
  FROM (VALUES ('public.enforce_game_join_gate()', '2bdfe7df2e0abbedc2dd5045e8099165'),
               ('public.host_remove_player(text,uuid)', '58686b8ca8759ead2bfb2b4b4bfe5d22'),
               ('private_sec.payment_claim_block(text,uuid)', 'd2e6c529f15a03003261b677ff68d8fb'),
               ('public.enforce_payment_claim_preconditions()', 'a48c3474f7c9921a8796e66cdcb2cf84'),
               ('public.notify_waitlist_on_spot_open()', 'b036830532749c978470516b36ce40c5'),
               ('public.release_expired_payment_holds(text)', '84331f438d4dde5a3a0b312e8007a7e6'),
               ('private_sec.join_request_approval_lifts_removal()', 'b755c4e40e0ca5d6ef8ae90de73d4b5e')) AS w(fn, md5) ORDER BY w.fn;
SELECT t.eq((SELECT string_agg(p.oid::regprocedure::text || '=' || p.proowner::regrole::text || '/' || p.prosecdef::text, ', '
                               ORDER BY p.oid::regprocedure::text)
               FROM pg_proc p WHERE p.oid IN (SELECT to_regprocedure(f) FROM unnest(ARRAY['public.enforce_game_join_gate()', 'public.host_remove_player(text,uuid)', 'private_sec.payment_claim_block(text,uuid)', 'public.enforce_payment_claim_preconditions()', 'public.notify_waitlist_on_spot_open()', 'public.release_expired_payment_holds(text)', 'private_sec.join_request_approval_lifts_removal()']) f)),
  'enforce_game_join_gate()=postgres/true, enforce_payment_claim_preconditions()=postgres/true, host_remove_player(text,uuid)=postgres/true, notify_waitlist_on_spot_open()=postgres/true, private_sec.join_request_approval_lifts_removal()=postgres/true, private_sec.payment_claim_block(text,uuid)=postgres/true, release_expired_payment_holds(text)=postgres/true', 'PINNED: owned by postgres and SECURITY DEFINER, as before');
SELECT t.eq((SELECT string_agg(f || '=' || coalesce((SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
                                FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                LEFT JOIN pg_roles r ON r.oid = x.grantee
                               WHERE p.oid = to_regprocedure(f) AND x.privilege_type = 'EXECUTE'
                                 AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')), '-'), '; ' ORDER BY f)
               FROM unnest(ARRAY['public.enforce_game_join_gate()', 'public.host_remove_player(text,uuid)', 'private_sec.payment_claim_block(text,uuid)', 'public.enforce_payment_claim_preconditions()', 'public.notify_waitlist_on_spot_open()', 'public.release_expired_payment_holds(text)', 'private_sec.join_request_approval_lifts_removal()']) f),
  'private_sec.join_request_approval_lifts_removal()=-; private_sec.payment_claim_block(text,uuid)=-; public.enforce_game_join_gate()=service_role; public.enforce_payment_claim_preconditions()=service_role; public.host_remove_player(text,uuid)=authenticated,service_role; public.notify_waitlist_on_spot_open()=service_role; public.release_expired_payment_holds(text)=authenticated,service_role', 'PINNED: the API-role grants are the ones each function had (the lift function: none)');
SELECT t.eq((SELECT md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_approval_lifts_removal'),
  '5717e06a7d4c0e7a04b5a348282c3d05/O', 'PINNED: the lift trigger fires after a request''s status becomes approved, enabled');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_approval_lifts_removal'),
  'CREATE TRIGGER trg_join_request_approval_lifts_removal AFTER UPDATE OF status ON public.join_requests FOR EACH ROW WHEN '
  || '(((old.status IS DISTINCT FROM ''approved''::text) AND (new.status = ''approved''::text))) '
  || 'EXECUTE FUNCTION private_sec.join_request_approval_lifts_removal()', 'PINNED: the lift trigger''s definition');
SELECT t.eq((SELECT string_agg(polname || ':' || polcmd::text, ', ' ORDER BY polname) FROM pg_policy
              WHERE polrelid = to_regclass('public.game_removals')),
  'Guardians see their children''s removals:r, Hosts see removals from their games:r, Players see their own removals:r',
  'PINNED: three read rules, no write rule');
SELECT t.eq((SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
              WHERE polrelid = to_regclass('public.game_removals') AND polname = 'Guardians see their children''s removals'),
  'private_sec.is_guardian_of(auth.uid(), user_id)', 'PINNED: the guardian rule is the join requests'' guardian rule');
SELECT t.eq((SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
               FROM pg_class c
               CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE c.oid = to_regclass('public.game_removals')
                AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated:SELECT,service_role:SELECT',
  'PINNED: the table''s API grants: read for signed-in users (rules decide which rows) and the service role; nothing else');
-- The roster's identity lock (8) and the claim reopen block (9).
SELECT t.eq((SELECT md5(pg_get_functiondef(p.oid)) FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.lock_row_identity()')),
  '9204d58bcb421322580ad4fb20c3029c', 'PINNED: private_sec.lock_row_identity() is unchanged, as 20261125100000 created it (the roster lock runs it)');
SELECT t.eq((SELECT md5(pg_get_functiondef(p.oid)) || '/' || p.proowner::regrole::text || '/' || p.prosecdef::text || '/'
                    || coalesce((SELECT string_agg(coalesce(r.rolname, 'PUBLIC'), ',' ORDER BY coalesce(r.rolname, 'PUBLIC'))
                                   FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                                   LEFT JOIN pg_roles r ON r.oid = x.grantee
                                  WHERE x.privilege_type = 'EXECUTE'
                                    AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')), '-')
               FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.removed_player_claim_reopen_block()')),
  '1e6dfeb3273b0ef6e7fb9d58ac7f0cfd/postgres/true/-',
  'PINNED: private_sec.removed_player_claim_reopen_block() is the one 20261202100000 created: owned by postgres, SECURITY DEFINER, no API grant');
SELECT t.eq((SELECT string_agg(c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text, ', ' ORDER BY t.tgname)
               FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
              WHERE t.tgname IN ('a0_game_participants_identity_locked', 'zz_payment_claim_reopen_removed') AND NOT t.tgisinternal),
  'game_participants.a0_game_participants_identity_locked=f59806a68e385137054282f471530f39/O, payment_submissions.zz_payment_claim_reopen_removed=38f2c4f9c52cc6f91209cfc07803d33a/O',
  'PINNED: the roster identity lock and the claim reopen block are the triggers 20261202100000 created, enabled');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.game_participants'::regclass AND t.tgname = 'a0_game_participants_identity_locked'),
  'CREATE TRIGGER a0_game_participants_identity_locked BEFORE UPDATE ON public.game_participants FOR EACH ROW '
  || 'EXECUTE FUNCTION private_sec.lock_row_identity(''user_id'', ''game_id'')', 'PINNED: the roster identity lock''s definition');
SELECT t.eq((SELECT min(t.tgname::text) FROM pg_trigger t WHERE t.tgrelid = 'public.game_participants'::regclass AND NOT t.tgisinternal),
  'a0_game_participants_identity_locked', 'PINNED: and it sorts first, so it fires before the roster''s other BEFORE UPDATE triggers');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.payment_submissions'::regclass AND t.tgname = 'zz_payment_claim_reopen_removed'),
  'CREATE TRIGGER zz_payment_claim_reopen_removed BEFORE UPDATE ON public.payment_submissions FOR EACH ROW WHEN '
  || '(((old.status IS DISTINCT FROM ''pending''::text) AND (new.status = ''pending''::text))) '
  || 'EXECUTE FUNCTION private_sec.removed_player_claim_reopen_block()', 'PINNED: the claim reopen block''s definition');
ROLLBACK;
