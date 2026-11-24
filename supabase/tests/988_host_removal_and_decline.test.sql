-- Host-control gaps left by WP 5.5 (20261129130000_host_removal_and_decline_end_invites).
-- 1. A host's removal (public.host_remove_player) takes the roster row, declines the player's request (as a host's decline:
--    'rejected', 'Removed by host', last_rejected_at stamped by the server) and cancels their pending invitation to that
--    game, so the removed player cannot come back through the game page's join or the old invitation. Only the game's
--    host may call it, exactly as the roster DELETE rule allows; a player, a moderator, another host or a visitor cannot.
--    The old app's statements (delete the roster row, then try to delete the request) are kept below as the
--    reproduction: the request stays approved and the player joins again.
-- 2. A host's decline (or a moderator's) cancels the player's pending invitation to that game at once, so deleting or
--    resending the declined request and then accepting approves nothing. The payment window running out and a guardian's
--    no (the declines game_respond_invite does not count as the host's) leave the invitation alone, even when the host runs
--    the release or is also the child's guardian. The service role ends nothing.
BEGIN;
SELECT t.person('host', 35), t.person('other', 38), t.person('mod', 40), t.person('ana', 28), t.person('bob', 29),
       t.person('cal', 30), t.person('dan', 31), t.person('eve', 27), t.person('fay', 26), t.person('gil', 33),
       t.person('hal', 34), t.person('ivy', 25), t.person('jon', 32), t.person('kid', 15), t.person('mom', 42),
       t.person('nan', 41), t.person('kim', 15), t.person('liv', 24), t.person('ola', 23);
SELECT t.guardian('mom', 'kid'), t.guardian('host', 'kim');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('mod'), 'moderator');

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('grm',   t.id('host'),  'basketball', 'Remove run',  now() + interval '3 days', 10, 0),
  ('gopen', t.id('host'),  'basketball', 'Open run',    now() + interval '3 days', 10, 0),
  ('goth',  t.id('other'), 'basketball', 'Other host',  now() + interval '3 days', 10, 0),
  ('gdec',  t.id('host'),  'basketball', 'Decline run', now() + interval '3 days', 10, 0),
  ('ghold', t.id('host'),  'basketball', 'Hold run',    now() + interval '3 days', 10, 0),
  ('gkid',  t.id('host'),  'basketball', 'Teen run',    now() + interval '3 days', 10, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('grm', t.id('host'), 0, true), ('gopen', t.id('host'), 0, false), ('goth', t.id('other'), 0, true),
  ('gdec', t.id('host'), 0, true), ('gkid', t.id('host'), 0, true);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_hold_minutes) VALUES
  ('ghold', t.id('host'), 10, true, 30);
-- grm: ana and cal were approved and joined; bob joined with no request (the host added him); gil is approved and has
-- not joined yet; hal was declined two hours ago. goth: ana is on another host's roster too.
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  created_at) VALUES
  (t.id('req-ana'), 'grm', t.id('host'), t.id('ana'), 'approved', 'k1', now() - interval '3 hours', NULL, now() - interval '4 hours'),
  (t.id('req-cal'), 'grm', t.id('host'), t.id('cal'), 'approved', 'k2', now() - interval '3 hours', NULL, now() - interval '4 hours'),
  (t.id('req-gil'), 'grm', t.id('host'), t.id('gil'), 'approved', 'k3', now() - interval '3 hours', NULL, now() - interval '4 hours'),
  (t.id('req-hal'), 'grm', t.id('host'), t.id('hal'), 'rejected', 'k4', now() - interval '2 hours', now() - interval '2 hours',
   now() - interval '4 hours'),
  (t.id('req-goth-ana'), 'goth', t.id('other'), t.id('ana'), 'approved', 'k5', now() - interval '3 hours', NULL, now() - interval '4 hours'),
  -- gdec: pending requests, sent after the invitations below.
  (t.id('req-dan'), 'gdec', t.id('host'), t.id('dan'), 'pending', 'k6', NULL, NULL, now() - interval '1 hour'),
  (t.id('req-eve'), 'gdec', t.id('host'), t.id('eve'), 'pending', 'k7', NULL, NULL, now() - interval '1 hour'),
  (t.id('req-ivy'), 'gdec', t.id('host'), t.id('ivy'), 'approved', 'k8', now() - interval '1 hour', NULL, now() - interval '1 hour'),
  (t.id('req-jon'), 'gdec', t.id('host'), t.id('jon'), 'pending', 'k9', NULL, NULL, now() - interval '1 hour'),
  (t.id('req-liv'), 'gdec', t.id('host'), t.id('liv'), 'pending', 'k10', NULL, NULL, now() - interval '1 hour'),
  (t.id('req-ola'), 'gdec', t.id('host'), t.id('ola'), 'pending', 'k11', NULL, NULL, now() - interval '1 hour'),
  -- ghold: fay's place was approved an hour ago and she has not paid (the 30-minute window has run out).
  (t.id('req-fay'), 'ghold', t.id('host'), t.id('fay'), 'approved', 'k12', now() - interval '1 hour', NULL, now() - interval '90 minutes'),
  -- gkid: two minors' pending requests; mom is kid's guardian, the host is kim's.
  (t.id('req-kid'), 'gkid', t.id('host'), t.id('kid'), 'pending', 'k13', NULL, NULL, now() - interval '1 hour'),
  (t.id('req-kim'), 'gkid', t.id('host'), t.id('kim'), 'pending', 'k14', NULL, NULL, now() - interval '1 hour');
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('grm', t.id('ana')), ('grm', t.id('bob')), ('grm', t.id('cal')), ('goth', t.id('ana')), ('gopen', t.id('cal'));
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id);
SET LOCAL session_replication_role = origin;

-- Invitations sent two hours ago, all still waiting.
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, created_at)
SELECT t.id('inv-' || g || '-' || w), g, t.id('host'), t.id(w), now() - interval '2 hours'
  FROM (VALUES ('grm', 'ana'), ('grm', 'bob'), ('grm', 'gil'), ('grm', 'hal'), ('gdec', 'dan'), ('gdec', 'eve'),
               ('gdec', 'ivy'), ('gdec', 'jon'), ('gdec', 'liv'), ('gdec', 'ola'), ('ghold', 'fay'), ('gkid', 'kid'),
               ('gkid', 'kim')) v(g, w);

CREATE FUNCTION pg_temp.seats(game text, who text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.game_participants WHERE game_id = game AND user_id = t.id(who) $$;
CREATE FUNCTION pg_temp.req(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.join_requests WHERE game_id = game AND player_id = t.id(who) $$;
CREATE FUNCTION pg_temp.inv(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.game_invites WHERE id = t.id('inv-' || game || '-' || who) $$;
-- The game page's join (joinGame), as the player: the roster insert. Rows written, or the refusal's text.
CREATE FUNCTION pg_temp.join_as(game text, who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    INSERT INTO public.game_participants (game_id, user_id) VALUES (game, t.id(who));
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN split_part(SQLERRM, ':', 1);
  END;
  PERFORM t.reset();
  RETURN 'joined ' || n;
END $$;
-- `who` answers their invitation to `game` (accept by default), as that player.
CREATE FUNCTION pg_temp.answer(game text, who text, accept boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_user(t.id(who));
  r := public.game_respond_invite(t.id('inv-' || game || '-' || who), accept);
  PERFORM t.reset();
  RETURN r;
END $$;
-- The host's Decline from the app (reviewJoinRequest): an update through the host's rule.
CREATE FUNCTION pg_temp.decline(game text, who text, note text DEFAULT NULL) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id('host'));
  n := t.changed(format($q$UPDATE public.join_requests SET status = 'rejected', reviewer_notes = %L, reviewed_at = now()
                           WHERE game_id = %L AND player_id = %L$q$, note, game, t.id(who)));
  PERFORM t.reset();
  RETURN n;
END $$;

-- ================= 1. the gap, as it was: the old app's removal =================
-- hostRemoveParticipant before this change, as the host: delete the roster row, then try to delete the request.
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$DELETE FROM public.game_participants WHERE game_id = 'grm' AND user_id = t.id('cal')$q$), 1,
  'REPRODUCED: the old removal deletes the roster row');
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'grm' AND player_id = t.id('cal')$q$), 0,
  'REPRODUCED: but its delete of the request reaches nothing (hosts have no delete rule on requests)');
SELECT t.reset();
SELECT t.eq(pg_temp.req('grm', 'cal'), 'approved', 'REPRODUCED: so the request stays approved');
SELECT t.eq(pg_temp.join_as('grm', 'cal'), 'joined 1', 'REPRODUCED: and the game page''s join puts the player back');

-- ================= 2. host_remove_player closes it =================
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('grm', t.id('ana')),
  '{"removed": true, "request_declined": true, "invites_cancelled": 1}'::jsonb,
  'the host removes ana: roster row, request and invitation in one call');
SELECT t.reset();
SELECT t.eq(pg_temp.seats('grm', 'ana'), 0, 'ana is off the roster');
SELECT t.eq((SELECT status || '/' || reviewer_notes || '/' || (last_rejected_at >= now())::text || '/' || (reviewed_at >= now())::text
               FROM public.join_requests WHERE id = t.id('req-ana')),
  'rejected/Removed by host/true/true', 'her request is declined as a host''s decline is (server-stamped last_rejected_at)');
SELECT t.eq(pg_temp.inv('grm', 'ana'), 'cancelled', 'her pending invitation is cancelled, as game_cancel_invite does');
SELECT t.eq((SELECT responded_at IS NULL FROM public.game_invites WHERE id = t.id('inv-grm-ana')), true,
  'and not marked answered (she did not answer it)');
SELECT t.eq((SELECT joined FROM public.hosted_games WHERE id = 'grm'), 2, 'the roster triggers ran (joined count follows)');
SELECT t.eq(pg_temp.seats('goth', 'ana'), 1, 'another host''s game is untouched');
SELECT t.eq(pg_temp.req('goth', 'ana'), 'approved', 'and so is her request there');
SELECT t.eq((SELECT count(*)::int FROM public.late_cancellations WHERE user_id = t.id('ana')), 0,
  'a host''s removal is not the player''s late cancellation');
SELECT t.eq(pg_temp.join_as('grm', 'ana'), 'GAME_APPROVAL_REQUIRED', 'the game page''s join cannot put her back');
SELECT t.eq(pg_temp.seats('grm', 'ana'), 0, 'still off the roster');
SELECT t.eq(pg_temp.answer('grm', 'ana') ->> 'status', 'cancelled', 'nor can her old invitation');
SELECT t.eq(pg_temp.req('grm', 'ana'), 'rejected', 'which approves nothing');
-- She deletes the declined request and sends a new one: it waits for the host.
SELECT t.as_user(t.id('ana'));
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'grm' AND player_id = t.id('ana')$q$), 1,
  'ana deletes her declined request');
INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key) VALUES ('grm', t.id('host'), t.id('ana'), 'again');
SELECT t.reset();
SELECT t.eq(pg_temp.req('grm', 'ana'), 'pending', 'a new request starts pending');
SELECT t.eq(pg_temp.join_as('grm', 'ana'), 'GAME_APPROVAL_REQUIRED', 'and does not let her join');
SELECT t.eq(pg_temp.answer('grm', 'ana') ->> 'status', 'cancelled', 'nor does the old invitation');

-- bob joined with no request (the host added him): removal takes the row and his invitation; there is no request.
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('grm', t.id('bob')),
  '{"removed": true, "request_declined": false, "invites_cancelled": 1}'::jsonb, 'removing a player with no request');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('grm', 'bob') ->> 'status', 'cancelled', 'his invitation cannot put him back');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE game_id = 'grm' AND player_id = t.id('bob')), 0,
  'and no request is created');
SELECT t.eq(pg_temp.seats('grm', 'bob'), 0, 'he stays off the roster');

-- gil: approved, not on the roster yet. Removing him ends the approval that would let him join.
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('grm', t.id('gil')),
  '{"removed": false, "request_declined": true, "invites_cancelled": 1}'::jsonb,
  'removing an approved player who has not joined yet declines the approval');
SELECT t.reset();
SELECT t.eq(pg_temp.join_as('grm', 'gil'), 'GAME_APPROVAL_REQUIRED', 'so the game page''s join is refused');

-- hal: already declined two hours ago. The decline is left as it was (its time included).
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('grm', t.id('hal')),
  '{"removed": false, "request_declined": false, "invites_cancelled": 1}'::jsonb, 'removing an already declined player');
SELECT t.reset();
SELECT t.eq((SELECT reviewer_notes IS NULL AND last_rejected_at < now() - interval '1 hour' FROM public.join_requests
              WHERE id = t.id('req-hal')), true, 'the earlier decline is not rewritten');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('grm', t.id('hal')),
  '{"removed": false, "request_declined": false, "invites_cancelled": 0}'::jsonb, 'a second removal changes nothing');
SELECT t.eq(public.host_remove_player('grm', t.id('jon')),
  '{"removed": false, "request_declined": false, "invites_cancelled": 0}'::jsonb,
  'a player with nothing in the game: nothing changes');
SELECT t.reset();

-- The open game: the gate never reads the request there, so a removed player can join again (not closed here).
SELECT t.as_user(t.id('host'));
SELECT public.host_remove_player('gopen', t.id('cal'));
SELECT t.reset();
SELECT t.eq(pg_temp.join_as('gopen', 'cal'), 'joined 1', 'NOT CLOSED: on an open game a removed player can join again');

-- ================= 3. who may remove =================
-- Exactly the roster DELETE rule: the game's host. Not a player, a moderator, another host, or a visitor.
SELECT t.eq((SELECT polcmd::text || ':' || pg_get_expr(polqual, polrelid) FROM pg_policy
              WHERE polrelid = 'public.game_participants'::regclass AND polname = 'Hosts can remove participants from their games'),
  'd:(EXISTS ( SELECT 1' || E'\n' || '   FROM hosted_games hg' || E'\n' ||
  '  WHERE ((hg.id = game_participants.game_id) AND (hg.host_id = auth.uid()))))',
  'the roster DELETE rule the function matches is unchanged (the game''s host only)');
SELECT t.as_user(t.id('dan'));
SELECT t.throws($q$SELECT public.host_remove_player('grm', t.id('cal'))$q$, 'NOT_GAME_HOST', 'a player cannot remove someone');
SELECT t.throws($q$SELECT public.host_remove_player('grm', t.id('dan'))$q$, 'NOT_GAME_HOST',
  'nor remove themselves this way (leaving is the player''s own delete)');
SELECT t.as_user(t.id('cal'));
SELECT t.throws($q$SELECT public.host_remove_player('grm', t.id('jon'))$q$, 'NOT_GAME_HOST',
  'a player on the roster cannot remove another');
SELECT t.as_user(t.id('mod'));
SELECT t.throws($q$SELECT public.host_remove_player('grm', t.id('cal'))$q$, 'NOT_GAME_HOST',
  'a moderator cannot (the roster rule has no moderator clause)');
SELECT t.as_user(t.id('other'));
SELECT t.throws($q$SELECT public.host_remove_player('grm', t.id('cal'))$q$, 'NOT_GAME_HOST', 'another game''s host cannot');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$SELECT public.host_remove_player('goth', t.id('ana'))$q$, 'NOT_GAME_HOST',
  'the host cannot remove from another host''s game');
SELECT t.throws($q$SELECT public.host_remove_player('nope', t.id('ana'))$q$, 'NOT_GAME_HOST',
  'a game that does not exist answers the same');
SELECT t.as_service();
SELECT t.throws($q$SELECT public.host_remove_player('grm', t.id('cal'))$q$, 'AUTH_REQUIRED', 'no signed-in user: refused');
SELECT t.reset();
SELECT t.eq(pg_temp.seats('grm', 'cal') || '/' || pg_temp.req('grm', 'cal') || '/' || pg_temp.seats('goth', 'ana'), '1/approved/1',
  'the refusals changed nothing');
SELECT t.eq(has_function_privilege('anon', 'public.host_remove_player(text,uuid)', 'EXECUTE'), false, 'visitors cannot call it');
SELECT t.eq(has_function_privilege('authenticated', 'public.host_remove_player(text,uuid)', 'EXECUTE'), true, 'members can');
SELECT t.eq(has_function_privilege('service_role', 'public.host_remove_player(text,uuid)', 'EXECUTE'), true,
  'the service role keeps the default grant (the rollback guard expects it; refused AUTH_REQUIRED above)');
SELECT t.eq((SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
              WHERE oid = 'public.host_remove_player(text,uuid)'::regprocedure), true,
  'SECURITY DEFINER with an empty search_path');
SELECT t.eq((SELECT count(*)::int FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r
              WHERE has_function_privilege(r, 'private_sec.join_request_host_decline_ends_invites()', 'EXECUTE')), 0,
  'no API role can call the trigger function');
SELECT t.eq((SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
              WHERE oid = 'private_sec.join_request_host_decline_ends_invites()'::regprocedure), true,
  'the trigger function is SECURITY DEFINER with an empty search_path');
SELECT t.ok((SELECT pg_get_triggerdef(oid) ~ 'AFTER UPDATE OF status ON public.join_requests FOR EACH ROW WHEN'
               FROM pg_trigger WHERE tgname = 'trg_join_request_host_decline_ends_invites'),
  'the trigger is AFTER UPDATE OF status, per row, with a WHEN');

-- ================= 4. a host's decline ends the invitation =================
SELECT t.eq(pg_temp.decline('gdec', 'dan'), 1, 'the host declines dan (the app''s Decline)');
SELECT t.eq(pg_temp.inv('gdec', 'dan'), 'cancelled', 'his pending invitation is cancelled at once');
SELECT t.as_user(t.id('dan'));
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'gdec' AND player_id = t.id('dan')$q$), 1,
  'dan deletes his declined request (allowed)');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gdec', 'dan') - 'join_request_id', '{"status": "cancelled", "on_roster": false}'::jsonb,
  'GAP CLOSED: the old invitation then answers cancelled');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE game_id = 'gdec' AND player_id = t.id('dan')), 0,
  'and creates or approves no request');
SELECT t.eq(pg_temp.seats('gdec', 'dan'), 0, 'and puts him on no roster');

SELECT t.eq(pg_temp.decline('gdec', 'eve', 'Full up'), 1, 'the host declines eve');
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET last_rejected_at = now() - interval '20 minutes' WHERE id = t.id('req-eve'); -- past the cooldown
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('eve'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending', last_rejected_at = now() - interval '30 days'
                          WHERE id = t.id('req-eve')$q$), 1,
  'eve sends it again and back-dates its last_rejected_at (allowed)');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gdec', 'eve') ->> 'status', 'cancelled', 'GAP CLOSED: the old invitation answers cancelled');
SELECT t.eq(pg_temp.req('gdec', 'eve'), 'pending', 'the resent request is left waiting for the host');
SELECT t.eq(pg_temp.seats('gdec', 'eve'), 0, 'and she is not on the roster');

-- The roster's Remove declines an approved request through the same rule (RosterPlayerRow), with its note.
SELECT t.eq(pg_temp.decline('gdec', 'ivy', 'Removed by host'), 1, 'the host declines ivy''s approved request (Remove)');
SELECT t.eq(pg_temp.inv('gdec', 'ivy'), 'cancelled', 'her invitation is cancelled too');

-- A moderator's decline counts as the host's (made from staff tooling; the API has no moderator rule on requests).
SELECT set_config('request.jwt.claim.sub', t.id('mod')::text, true);
UPDATE public.join_requests SET status = 'rejected', reviewed_at = now() WHERE id = t.id('req-jon');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT t.eq(pg_temp.inv('gdec', 'jon'), 'cancelled', 'a moderator''s decline cancels the invitation');
-- The service role (no signed-in user) is not the host.
UPDATE public.join_requests SET status = 'rejected', reviewed_at = now() WHERE id = t.id('req-liv');
SELECT t.eq(pg_temp.inv('gdec', 'liv'), 'pending', 'a decline with no signed-in user leaves the invitation');

-- An approval, or a player's resend, is not a decline.
SELECT t.as_user(t.id('host'));
UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-ola');
SELECT t.reset();
SELECT t.eq(pg_temp.inv('gdec', 'ola'), 'pending', 'an approval leaves the invitation');
-- Another game's host, signed in, is not this game's host (a decline made by anyone but the host or a moderator).
SELECT set_config('request.jwt.claim.sub', t.id('other')::text, true);
UPDATE public.join_requests SET status = 'rejected', reviewed_at = now() WHERE id = t.id('req-ola');
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT t.eq(pg_temp.req('gdec', 'ola') || '/' || pg_temp.inv('gdec', 'ola'), 'rejected/pending',
  'a decline by a signed-in member who is not this game''s host or a moderator leaves the invitation');

-- The host's deliberate re-invitation after the decline is a new invitation, and accepting it works as before.
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id) VALUES (t.id('inv-again-dan'), 'gdec', t.id('host'), t.id('dan'));
SELECT t.as_user(t.id('dan'));
SELECT t.eq(public.game_respond_invite(t.id('inv-again-dan'), true) ->> 'status', 'accepted',
  'a new invitation after the decline can be accepted (the host invited him knowing)');
SELECT t.reset();

-- ================= 5. declines the host did not make leave the invitation =================
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.release_expired_payment_holds('ghold'), 1, 'the host runs the payment-window release for their game');
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || reviewer_notes FROM public.join_requests WHERE id = t.id('req-fay')),
  'rejected/Payment window expired — your spot was released.', 'fay''s place is released');
SELECT t.eq(pg_temp.inv('ghold', 'fay'), 'pending', 'the payment window running out does not cancel her invitation');
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-kid'), false);
SELECT t.reset();
SELECT t.eq(pg_temp.req('gkid', 'kid'), 'rejected', 'a guardian says no');
SELECT t.eq(pg_temp.inv('gkid', 'kid'), 'pending', 'a guardian''s no does not cancel the invitation');
SELECT t.as_user(t.id('host'));
SELECT public.guardian_approve_join_request(t.id('req-kim'), false);
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || reviewer_notes FROM public.join_requests WHERE id = t.id('req-kim')),
  'rejected/Declined by guardian', 'the host, as kim''s guardian, says no as guardian');
SELECT t.eq(pg_temp.inv('gkid', 'kim'), 'pending', 'that is a guardian''s no, not the host''s: the invitation stays');
SELECT t.eq((SELECT guardian_approved_at IS NULL FROM public.join_requests WHERE id = t.id('req-kim')), true,
  'and the guardian rule still holds the child''s place');

ROLLBACK;
