-- WP 5.5 (20261127120000_invite_accept_roster): accepting an invitation to a free game with no guardian approval outstanding
-- puts the player on the roster in the same step, through every roster trigger (a refusal undoes the whole accept); a game
-- whose other players fill it answers "full" and writes nothing; paid games and places a guardian still has to approve keep
-- the old path (approved request, no roster row); an invitation whose request the host declined since it was sent cannot
-- be accepted, and is marked expired (a decline the host did not make, the payment window running out or a guardian's
-- no, does not take it back).
BEGIN;
SELECT t.person('host', 35), t.person('ana', 28), t.person('ben', 30), t.person('cal', 31), t.person('dee', 25),
       t.person('fay', 29), t.person('gus', 33), t.person('hal', 27), t.person('ivy', 26), t.person('jon', 32),
       t.person('mom', 42), t.person('kid', 15), t.person('kidb', 15), t.person('kidc', 15), t.person('liz', 34),
       t.person('kat', 24), t.person('max', 36), t.person('ned', 30), t.person('oli', 31), t.person('kidd', 15);
SELECT t.guardian('mom', 'kid'), t.guardian('mom', 'kidb'), t.guardian('mom', 'kidc'), t.guardian('mom', 'kidd');

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('gfree',  t.id('host'), 'basketball', 'Free run',      now() + interval '3 days', 10, 0),
  ('gzero',  t.id('host'), 'basketball', 'Priced at 0',   now() + interval '3 days', 10, 0),
  ('gpaid',  t.id('host'), 'basketball', 'Paid run',      now() + interval '3 days', 10, 0),
  ('gprice', t.id('host'), 'basketball', 'Priced run',    now() + interval '3 days', 10, 15),
  ('glast',  t.id('host'), 'basketball', 'Last place',    now() + interval '3 days', 2,  0),
  ('gown',   t.id('host'), 'basketball', 'Own place',     now() + interval '3 days', 1,  0),
  ('gkid',   t.id('host'), 'basketball', 'Teen run',      now() + interval '3 days', 10, 0),
  ('gblock', t.id('host'), 'basketball', 'Blocked',       now() + interval '3 days', 10, 0),
  ('gtb',    t.id('host'), 'basketball', 'Taken back',    now() + interval '3 days', 10, 0),
  ('ghold',  t.id('host'), 'basketball', 'Hold run',      now() + interval '3 days', 10, 0);
-- gzero and gprice have no settings row: the game's price decides, as in the join gate.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('gfree', t.id('host'), 0, true), ('gpaid', t.id('host'), 10, true), ('glast', t.id('host'), 0, true),
  ('gown', t.id('host'), 0, true), ('gkid', t.id('host'), 0, true), ('gblock', t.id('host'), 0, true),
  ('gtb', t.id('host'), 0, true);
-- ghold: paid, and an approved place is held for 30 minutes for the payment.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_hold_minutes) VALUES
  ('ghold', t.id('host'), 10, true, 30);
-- glast: one of its two places taken. gown: dee already holds its one place.
INSERT INTO public.game_participants (game_id, user_id) VALUES ('glast', t.id('gus')), ('gown', t.id('dee'));
-- Requests written before the invitations: kidb's carries mom's approval; cal's and fay's are pending; kidc's carries
-- mom's approval too.
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, guardian_approved_at, guardian_approved_by,
                                  created_at) VALUES
  (t.id('req-kidb'), 'gkid', t.id('host'), t.id('kidb'), 'pending', 'k', now() - interval '3 hours', t.id('mom'), now() - interval '3 hours'),
  (t.id('req-kidc'), 'gkid', t.id('host'), t.id('kidc'), 'pending', 'k', now() - interval '3 hours', t.id('mom'), now() - interval '3 hours'),
  (t.id('req-cal'),  'gblock', t.id('host'), t.id('cal'), 'pending', 'k', NULL, NULL, now() - interval '3 hours'),
  (t.id('req-fay'),  'gblock', t.id('host'), t.id('fay'), 'pending', 'k', NULL, NULL, now() - interval '3 hours'),
  (t.id('req-kidd'), 'gkid', t.id('host'), t.id('kidd'), 'pending', 'k', NULL, NULL, now() - interval '3 hours');
-- ghold: ned's and oli's requests were approved an hour ago, after their invitations, and neither has paid.
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, created_at) VALUES
  (t.id('req-ned'), 'ghold', t.id('host'), t.id('ned'), 'approved', 'k', now() - interval '1 hour', now() - interval '90 minutes'),
  (t.id('req-oli'), 'ghold', t.id('host'), t.id('oli'), 'approved', 'k', now() - interval '1 hour', now() - interval '90 minutes');
-- Taken back, on gtb (invitations sent two hours ago):
--   hal: declined an hour ago (last_rejected_at), still declined.
--   ivy: declined an hour ago, then sent again (pending; resubmitting clears reviewed_at).
--   jon: declined with only reviewed_at recorded, an hour ago.
--   ben: declined three hours ago, before the invitation.
--   liz: declined three hours ago (last_rejected_at, the server's clock), before the invitation; the host's device clock ran
--        ahead, so the reviewed_at it wrote reads an hour ago, after the invitation.
--   kat, max: declined an hour ago, still declined (they act on their own rows below).
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  created_at) VALUES
  (t.id('req-hal'), 'gtb', t.id('host'), t.id('hal'), 'rejected', 'k', now() - interval '1 hour',  now() - interval '1 hour',  now() - interval '4 hours'),
  (t.id('req-ivy'), 'gtb', t.id('host'), t.id('ivy'), 'pending',  'k', NULL,                       now() - interval '1 hour',  now() - interval '4 hours'),
  (t.id('req-jon'), 'gtb', t.id('host'), t.id('jon'), 'rejected', 'k', now() - interval '1 hour',  NULL,                       now() - interval '4 hours'),
  (t.id('req-ben'), 'gtb', t.id('host'), t.id('ben'), 'rejected', 'k', now() - interval '3 hours', now() - interval '3 hours', now() - interval '4 hours'),
  (t.id('req-liz'), 'gtb', t.id('host'), t.id('liz'), 'rejected', 'k', now() - interval '1 hour',  now() - interval '3 hours', now() - interval '4 hours'),
  (t.id('req-kat'), 'gtb', t.id('host'), t.id('kat'), 'rejected', 'k', now() - interval '1 hour',  now() - interval '1 hour',  now() - interval '4 hours'),
  (t.id('req-max'), 'gtb', t.id('host'), t.id('max'), 'rejected', 'k', now() - interval '1 hour',  now() - interval '1 hour',  now() - interval '4 hours');
SET LOCAL session_replication_role = origin;

INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, created_at)
SELECT t.id('inv-' || g || '-' || w), g, t.id('host'), t.id(w), now() - interval '2 hours'
  FROM (VALUES ('gfree', 'ana'), ('gfree', 'ben'), ('gzero', 'ana'), ('gpaid', 'ana'), ('gprice', 'ana'), ('glast', 'ana'),
               ('glast', 'ben'), ('gown', 'dee'), ('gkid', 'kid'), ('gkid', 'kidb'), ('gkid', 'kidc'), ('gblock', 'cal'),
               ('gblock', 'fay'), ('gtb', 'hal'), ('gtb', 'ivy'), ('gtb', 'jon'), ('gtb', 'ben'), ('gtb', 'ana'),
               ('gtb', 'liz'), ('gtb', 'kat'), ('gtb', 'max'), ('ghold', 'ned'), ('ghold', 'oli'), ('gkid', 'kidd')) v(g, w);

-- The answer to `who` accepting (or declining) their invitation to `game`, as that player.
CREATE FUNCTION pg_temp.answer(game text, who text, accept boolean DEFAULT true) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_user(t.id(who));
  r := public.game_respond_invite(t.id('inv-' || game || '-' || who), accept);
  PERFORM t.reset();
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.seats(game text, who text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.game_participants WHERE game_id = game AND user_id = t.id(who) $$;
CREATE FUNCTION pg_temp.req(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.join_requests WHERE game_id = game AND player_id = t.id(who) $$;
CREATE FUNCTION pg_temp.inv(game text, who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.game_invites WHERE id = t.id('inv-' || game || '-' || who) $$;
CREATE FUNCTION pg_temp.told(game text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications
   WHERE user_id = t.id('host') AND type = 'game_invite_accepted' AND link = '/games/' || game $$;

-- ================= 1. a free game: on the roster =================
SELECT t.eq(pg_temp.answer('gfree', 'ana') - 'join_request_id', '{"status": "accepted", "on_roster": true}'::jsonb,
  'accepting a free game''s invitation answers accepted, on the roster');
SELECT t.eq((SELECT join_request_id FROM public.game_invites WHERE id = t.id('inv-gfree-ana')),
  (SELECT id FROM public.join_requests WHERE game_id = 'gfree' AND player_id = t.id('ana')), 'the invitation points at the request');
SELECT t.eq(pg_temp.seats('gfree', 'ana'), 1, 'the player has a roster row');
SELECT t.eq(pg_temp.req('gfree', 'ana'), 'approved', 'and an approved request');
SELECT t.eq(pg_temp.inv('gfree', 'ana'), 'accepted', 'the invitation is accepted');
SELECT t.eq((SELECT joined FROM public.hosted_games WHERE id = 'gfree'), 1, 'the game''s joined count follows (roster triggers ran)');
SELECT t.eq(pg_temp.told('gfree'), 1, 'the host is told once');
SELECT t.eq(pg_temp.answer('gfree', 'ana') ->> 'on_roster', 'true', 'accepting again answers on the roster');
SELECT t.eq(pg_temp.seats('gfree', 'ana'), 1, 'with no second row');
SELECT t.eq(pg_temp.told('gfree'), 1, 'and no second notice');
SELECT t.eq(pg_temp.answer('gzero', 'ana') ->> 'on_roster', 'true', 'no settings row and a price of 0 is free (the gate''s rule)');
SELECT t.eq(pg_temp.seats('gzero', 'ana'), 1, 'so the player is on that roster too');

-- ================= 2. declining writes nothing =================
SELECT t.eq(pg_temp.answer('gfree', 'ben', false), '{"status": "declined", "on_roster": false}'::jsonb, 'a decline answers declined');
SELECT t.eq(pg_temp.seats('gfree', 'ben'), 0, 'no roster row');
SELECT t.eq(pg_temp.req('gfree', 'ben'), NULL, 'no request');

-- ================= 3. paid games: the old path =================
SELECT t.eq(pg_temp.answer('gpaid', 'ana') - 'join_request_id', '{"status": "accepted", "on_roster": false}'::jsonb,
  'a paid game''s accept answers accepted, not on the roster');
SELECT t.eq(pg_temp.seats('gpaid', 'ana'), 0, 'no roster row on a paid game');
SELECT t.eq(pg_temp.req('gpaid', 'ana'), 'approved', 'the request is approved (payment follows)');
SELECT t.eq(pg_temp.answer('gprice', 'ana') ->> 'on_roster', 'false', 'no settings row and a price above 0 is paid');
SELECT t.eq(pg_temp.seats('gprice', 'ana'), 0, 'no roster row there either');

-- ================= 4. capacity =================
SELECT t.eq(pg_temp.answer('glast', 'ana') ->> 'on_roster', 'true', 'the last place of a free game is taken');
SELECT t.eq(pg_temp.answer('glast', 'ben'), '{"status": "full", "on_roster": false}'::jsonb, 'the next accept is told full');
SELECT t.eq(pg_temp.seats('glast', 'ben'), 0, 'full: no roster row');
SELECT t.eq(pg_temp.req('glast', 'ben'), NULL, 'full: no request');
SELECT t.eq(pg_temp.inv('glast', 'ben'), 'pending', 'full: the invitation stays pending');
SELECT t.eq(pg_temp.told('glast'), 1, 'full: the host is not told');
SELECT t.eq((SELECT count(*)::int FROM public.game_participants WHERE game_id = 'glast'), 2, 'the game holds max_players, not more');
-- A player already holding a place is not counted against themselves, and gets no second row.
SELECT t.eq(pg_temp.answer('gown', 'dee') ->> 'status', 'accepted', 'a player already on a full roster can accept');
SELECT t.eq(pg_temp.seats('gown', 'dee'), 1, 'and keeps their one row');

-- ================= 5. guardian-held places: the old path =================
SELECT t.eq(pg_temp.answer('gkid', 'kid') - 'join_request_id', '{"status": "accepted", "on_roster": false}'::jsonb,
  'a minor whose guardian has not approved this game accepts, not on the roster');
SELECT t.eq(pg_temp.seats('gkid', 'kid'), 0, 'no roster row before the guardian approves');
SELECT t.eq(pg_temp.req('gkid', 'kid'), 'approved', 'the request is approved by the host''s invitation');
SELECT t.eq((SELECT guardian_approved_at FROM public.join_requests WHERE game_id = 'gkid' AND player_id = t.id('kid')), NULL,
  'and still waits for the guardian');
SELECT t.eq(pg_temp.answer('gkid', 'kidb') ->> 'on_roster', 'true', 'a minor whose guardian approved this game goes on the roster');
SELECT t.eq(pg_temp.seats('gkid', 'kidb'), 1, 'one row');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('mom') AND type = 'child_game'), 1,
  'and the guardian is told their child joined (the roster trigger ran)');

-- ================= 6. a roster trigger's refusal undoes the accept =================
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('cal'));
SELECT t.as_user(t.id('cal'));
SELECT t.throws(format('SELECT public.game_respond_invite(%L, true)', t.id('inv-gblock-cal')), 'BLOCKED_BY_HOST',
  'a player the host blocked after they asked cannot take the place');
SELECT t.reset();
SELECT t.eq(pg_temp.inv('gblock', 'cal') || '/' || pg_temp.req('gblock', 'cal') || '/' || pg_temp.seats('gblock', 'cal')
            || '/' || pg_temp.told('gblock'), 'pending/pending/0/0', 'the block refusal writes nothing at all');
UPDATE public.profiles SET age_cohort = 'unknown' WHERE id = t.id('fay');
SELECT t.as_user(t.id('fay'));
SELECT t.throws(format('SELECT public.game_respond_invite(%L, true)', t.id('inv-gblock-fay')), 'AGE_VERIFICATION_REQUIRED',
  'a player with no confirmed age cannot take the place');
SELECT t.reset();
SELECT t.eq(pg_temp.inv('gblock', 'fay') || '/' || pg_temp.req('gblock', 'fay') || '/' || pg_temp.seats('gblock', 'fay'),
  'pending/pending/0', 'the age refusal writes nothing at all');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('kidc');
SELECT t.as_user(t.id('kidc'));
SELECT t.throws(format('SELECT public.game_respond_invite(%L, true)', t.id('inv-gkid-kidc')), 'CHILD_GAME_PARTICIPATION_BLOCKED',
  'a minor whose guardian turned games off cannot take the place, even with an earlier approval');
SELECT t.reset();
SELECT t.eq(pg_temp.inv('gkid', 'kidc') || '/' || pg_temp.req('gkid', 'kidc') || '/' || pg_temp.seats('gkid', 'kidc'),
  'pending/pending/0', 'the guardian refusal writes nothing at all');

-- ================= 7. taken back =================
SELECT t.eq(pg_temp.answer('gtb', 'hal'), '{"status": "expired", "on_roster": false}'::jsonb,
  'declined after the invitation: the accept is refused as expired');
SELECT t.eq(pg_temp.req('gtb', 'hal') || '/' || pg_temp.inv('gtb', 'hal') || '/' || pg_temp.seats('gtb', 'hal'), 'rejected/expired/0',
  'the declined request stays declined, the invitation is expired, no place');
SELECT t.eq(pg_temp.answer('gtb', 'ivy') ->> 'status', 'expired', 'declined after the invitation and sent again: expired');
SELECT t.eq(pg_temp.req('gtb', 'ivy') || '/' || pg_temp.seats('gtb', 'ivy'), 'pending/0', 'the resent request is not approved');
SELECT t.eq(pg_temp.answer('gtb', 'jon') ->> 'status', 'expired', 'declined after the invitation, by reviewed_at alone: expired');
SELECT t.eq(pg_temp.req('gtb', 'jon'), 'rejected', 'and stays declined');
SELECT t.eq(pg_temp.told('gtb'), 0, 'the host is told of none of these');
SELECT t.eq(pg_temp.answer('gtb', 'ben') ->> 'on_roster', 'true', 'declined before the invitation: the accept goes through');
SELECT t.eq(pg_temp.req('gtb', 'ben'), 'approved', 'and approves the request');
SELECT t.eq(pg_temp.answer('gtb', 'liz') ->> 'on_roster', 'true',
  'declined before the invitation by the server''s clock, after it by the host''s device clock: the server''s clock decides');
SELECT t.eq(pg_temp.req('gtb', 'liz'), 'approved', 'and the request is approved');
-- The host's own decline, through the API, after the invitation.
SELECT t.as_user(t.id('ana'));
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('gtb', t.id('ana'), t.id('host'), 'join:gtb');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now()
                          WHERE game_id = 'gtb' AND player_id = t.id('ana')$q$), 1, 'the host declines a request');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gtb', 'ana') ->> 'status', 'expired', 'the invitation sent before it can no longer be accepted');
SELECT t.eq(pg_temp.req('gtb', 'ana'), 'rejected', 'the host''s decision stands');

-- Declines the host did not make are not a take-back; the host's re-invitation (the same pending invitation, created
-- before the decline) can then be accepted.
SELECT t.eq(public.release_expired_payment_holds('ghold'), 2, 'the payment window runs out on ned''s and oli''s places');
SELECT t.eq(pg_temp.req('ghold', 'ned'), 'rejected', 'ned''s request is declined by the release');
SELECT t.eq((SELECT last_rejected_at >= now() FROM public.join_requests WHERE id = t.id('req-ned')), true,
  'stamped now, after the invitation');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.game_invite_player('ghold', t.id('ned')), t.id('inv-ghold-ned'),
  'the host invites ned again: the same pending invitation answers');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('ghold', 'ned') - 'join_request_id', '{"status": "accepted", "on_roster": false}'::jsonb,
  'a place released for want of payment is not a take-back: the accept goes through (paid, no roster row)');
SELECT t.eq(pg_temp.req('ghold', 'ned') || '/' || pg_temp.inv('ghold', 'ned'), 'approved/accepted',
  'the request is approved again (a new payment window) and the invitation accepted');
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-kidd'), false);
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || reviewer_notes || '/' || (last_rejected_at >= now())::text FROM public.join_requests
              WHERE id = t.id('req-kidd')), 'rejected/Declined by guardian/true', 'a guardian says no, after the invitation');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.game_invite_player('gkid', t.id('kidd')), t.id('inv-gkid-kidd'),
  'the host invites the child again: the same pending invitation answers');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gkid', 'kidd') - 'join_request_id', '{"status": "accepted", "on_roster": false}'::jsonb,
  'a guardian''s no is not the host''s take-back: the accept goes through, not on the roster');
SELECT t.eq((SELECT status || '/' || COALESCE(guardian_approved_at::text, 'none') FROM public.join_requests
              WHERE id = t.id('req-kidd')), 'approved/none', 'the host side is approved; the guardian''s approval is still missing');
SELECT t.eq(pg_temp.seats('gkid', 'kidd'), 0, 'so the guardian rule still holds the place: no roster row');
-- LIMITATION (recorded by name; see the migration header): sending the request again clears the note that marks a
-- decline as the payment window's or a guardian's, so a resent request after one reads as the host's decline.
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET last_rejected_at = now() - interval '20 minutes' WHERE id = t.id('req-oli'); -- past the cooldown
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('oli'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending' WHERE id = t.id('req-oli')$q$), 1,
  'oli sends the released request again');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('ghold', 'oli') ->> 'status', 'expired',
  'LIMITATION: after a resend, a released place''s old invitation answers expired');
SELECT t.eq(pg_temp.req('ghold', 'oli'), 'pending', 'and the resent request is left as it is');
-- KNOWN GAP (WP 5.5 follow-up, recorded by name; see the migration header): the rule reads the player's own request row,
-- which the player can delete, or rewrite when sending it again. Closing the gap needs another object changed (the decline
-- ending the invitation on the server, or last_rejected_at pinned on a resubmit) and turns these two into refusals.
SELECT t.as_user(t.id('kat'));
SELECT t.eq(t.changed($q$DELETE FROM public.join_requests WHERE game_id = 'gtb' AND player_id = t.id('kat')$q$), 1,
  'KNOWN GAP: a player deletes their own declined request');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gtb', 'kat') ->> 'status', 'accepted', 'KNOWN GAP: then the old invitation is accepted');
SELECT t.as_user(t.id('max'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending', last_rejected_at = NULL
                          WHERE game_id = 'gtb' AND player_id = t.id('max')$q$), 1,
  'KNOWN GAP: a player sends a declined request again and clears its last_rejected_at');
SELECT t.reset();
SELECT t.eq(pg_temp.answer('gtb', 'max') ->> 'status', 'accepted', 'KNOWN GAP: then the old invitation is accepted');

-- ================= 8. the function =================
SELECT t.eq(has_function_privilege('anon', 'public.game_respond_invite(uuid,boolean)', 'EXECUTE'), false, 'visitors cannot answer');
SELECT t.eq(has_function_privilege('authenticated', 'public.game_respond_invite(uuid,boolean)', 'EXECUTE'), true, 'members can');
SELECT t.eq((SELECT prosecdef AND proconfig = ARRAY['search_path=""'] FROM pg_proc
              WHERE oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure), true,
  'still SECURITY DEFINER with an empty search_path');

ROLLBACK;
