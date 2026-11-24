-- A declined join request keeps the host's decision and loses the guardian's approval
-- (20261130110000_guardian_cancel_keeps_declined_request).
-- 1. public.guardian_cancel_child_game no longer deletes the child's join request when it is 'rejected', whatever its
--    note: a host's Decline, the removal's 'Removed by host' (host_remove_player), a guardian's 'Declined by guardian'.
--    The request stays as it was (last_rejected_at and attempt_count included), so the child's resend straight after the
--    cancel is refused by the cooldown, as it was before the cancel. Any guardian approval left on it (a host's decline or
--    removal keeps it) is taken back. Everything else the function does is unchanged and pinned here: pending and
--    approved requests and the roster row are deleted, unreviewed payment claims deleted and verified ones kept, the host
--    told when a place opens, the same answers ('cancelled', 'withdrawn', 'nothing'), the same refusals, and the same
--    owner, SECURITY DEFINER, search_path and grants (sections 1-8).
-- 2. With no guardian cancel, a declined request reopened to 'approved' (an accepted invitation, or any direct writer)
--    loses the guardian approval left on it (trg_join_request_reopen_needs_guardian, widened), and game_respond_invite
--    holds a guarded minor for the guardian: approved, no roster row, in the guardian's list, seated only after the
--    guardian approves, on a free or a paid game, after a host's removal, a host's decline or a lapsed payment hold.
--    Adults and minors with no guardian link are seated on a free game as before; the child's resend is unchanged; a
--    guarded minor still on the roster under a host's decline who accepts keeps the place and the declined request as
--    they were, with room or on a full game, and nothing lands in the guardian's list, while an adult in that spot has
--    the request reopened as before, so the host's later removal declines it again with its cooldown (section 9).
--    Section 10 pins both functions and the trigger.
-- On the definitions before 20261130110000 (docs/rollbacks/20261130110000_guardian_cancel_keeps_declined_request.down.sql),
-- the assertions marked KEPT fail: the declined request is deleted and the child can send a new one at once. The two
-- marked STAMP fail if the cancel keeps the declined request with the guardian's approval still on it: they read the kept
-- row (they fail on the old body too, which deletes it). Whether a later invitation seats the child does not hang on the
-- cancel's take-back any more (section 8): the widened trigger and game_respond_invite hold a guarded minor on any
-- reopened declined request. The assertions marked REOPEN fail on the old trigger and game_respond_invite: the minor is
-- seated on the old approval, or the approval stays on the request. Some unmarked ones fail there too: those that follow
-- from them, and 9h's request checks for rio and sam (the old body reopens the declined request of a guarded minor still
-- on the roster).
BEGIN;
SELECT t.person('host', 35), t.person('mom', 42), t.person('stranger', 33), t.person('ada', 15), t.person('ben', 15),
       t.person('cyd', 15), t.person('dee', 15), t.person('eli', 15), t.person('fay', 15), t.person('gus', 15),
       t.person('hal', 15), t.person('ivo', 15);
SELECT t.guardian('mom', k) FROM unnest(ARRAY['ada', 'ben', 'cyd', 'dee', 'eli', 'fay', 'gus', 'hal', 'ivo']) k;

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('gkeep', t.id('host'), 'basketball', 'Keep run', now() + interval '3 days', 12, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('gkeep', t.id('host'), 0, true);
-- ada and cyd wait for a decision; ben was approved and joined; dee waits; eli was approved and joined; fay was approved
-- and has not joined; gus joined and his request was declined since; hal was declined two minutes ago. ivo has nothing.
-- The minors' places carry their guardian's approval where they were approved.
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  reviewer_notes, guardian_approved_at, guardian_approved_by, created_at) VALUES
  (t.id('req-ada'), 'gkeep', t.id('host'), t.id('ada'), 'pending',  'join:gkeep:a', NULL, NULL, NULL, NULL, NULL, now() - interval '1 hour'),
  (t.id('req-ben'), 'gkeep', t.id('host'), t.id('ben'), 'approved', 'join:gkeep:b', now() - interval '50 minutes', NULL, NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-cyd'), 'gkeep', t.id('host'), t.id('cyd'), 'pending',  'join:gkeep:c', NULL, NULL, NULL, NULL, NULL, now() - interval '1 hour'),
  (t.id('req-dee'), 'gkeep', t.id('host'), t.id('dee'), 'pending',  'join:gkeep:d', NULL, NULL, NULL, NULL, NULL, now() - interval '1 hour'),
  (t.id('req-eli'), 'gkeep', t.id('host'), t.id('eli'), 'approved', 'join:gkeep:e', now() - interval '50 minutes', NULL, NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-fay'), 'gkeep', t.id('host'), t.id('fay'), 'approved', 'join:gkeep:f', now() - interval '50 minutes', NULL, NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-gus'), 'gkeep', t.id('host'), t.id('gus'), 'rejected', 'join:gkeep:g', now() - interval '2 minutes',
   now() - interval '2 minutes', 'Full up', now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-hal'), 'gkeep', t.id('host'), t.id('hal'), 'rejected', 'join:gkeep:h', now() - interval '2 minutes',
   now() - interval '2 minutes', 'Full up', NULL, NULL, now() - interval '1 hour');
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('gkeep', t.id('ben')), ('gkeep', t.id('eli')), ('gkeep', t.id('gus'));
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id);
-- Unreviewed payment claims (dee, eli, hal) and one verified payment (eli).
INSERT INTO public.payment_submissions (id, game_id, host_id, player_id, payment_type, status) VALUES
  (t.id('pay-dee'), 'gkeep', t.id('host'), t.id('dee'), 'venmo', 'pending'),
  (t.id('pay-eli'), 'gkeep', t.id('host'), t.id('eli'), 'venmo', 'pending'),
  (t.id('pay-eli-ok'), 'gkeep', t.id('host'), t.id('eli'), 'venmo', 'verified'),
  (t.id('pay-hal'), 'gkeep', t.id('host'), t.id('hal'), 'venmo', 'pending');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION pg_temp.req(who text) RETURNS text LANGUAGE sql AS $$
  SELECT status FROM public.join_requests WHERE game_id = 'gkeep' AND player_id = t.id(who) $$;
CREATE FUNCTION pg_temp.row_of(who text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT to_jsonb(jr) FROM public.join_requests jr WHERE game_id = 'gkeep' AND player_id = t.id(who) $$;
CREATE FUNCTION pg_temp.seats(who text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.game_participants WHERE game_id = 'gkeep' AND user_id = t.id(who) $$;
CREATE FUNCTION pg_temp.pays(who text, st text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.payment_submissions WHERE game_id = 'gkeep' AND player_id = t.id(who) AND status = st $$;
-- The guardian's Cancel spot / Withdraw request in the Parent Center (cancelChildGame), as mom.
CREATE FUNCTION pg_temp.cancel(who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM t.as_user(t.id('mom'));
  r := public.guardian_cancel_child_game(t.id(who), 'gkeep');
  PERFORM t.reset();
  RETURN r;
END $$;
-- The game page's Request a spot (createJoinRequest), as the child: insert a request; if the child already has one for
-- the game (unique violation), send the declined one again (rejected -> pending), which the resubmit trigger checks.
-- 'new request' / 'resent', or the refusal's text.
CREATE FUNCTION pg_temp.resend(who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
    VALUES ('gkeep', t.id('host'), t.id(who), 'join:gkeep');
    PERFORM t.reset();
    RETURN 'new request';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
  BEGIN
    UPDATE public.join_requests SET status = 'pending' WHERE game_id = 'gkeep' AND player_id = t.id(who) AND status = 'rejected';
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN SQLERRM;
  END;
  PERFORM t.reset();
  RETURN 'resent ' || n;
END $$;
CREATE TEMP TABLE before_cancel (who text PRIMARY KEY, r jsonb);

-- ================= 1. who may cancel (unchanged) =================
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT public.guardian_cancel_child_game(t.id('dee'), 'gkeep')$q$, 'linked to your account',
  'a stranger cannot cancel for someone else''s child');
SELECT t.as_user(t.id('dee'));
SELECT t.throws($q$SELECT public.guardian_cancel_child_game(t.id('dee'), 'gkeep')$q$, 'linked to your account',
  'the child cannot use the guardian path');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$SELECT public.guardian_cancel_child_game(t.id('dee'), 'gkeep')$q$, 'linked to your account',
  'nor can the host');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.guardian_cancel_child_game(t.id('dee'), 'gkeep')$q$, '', 'a visitor is refused outright');
SELECT t.as_service();
SELECT t.throws($q$SELECT public.guardian_cancel_child_game(t.id('dee'), 'gkeep')$q$, 'linked to your account',
  'no signed-in user: refused');
SELECT t.as_user(t.id('mom'));
SELECT t.throws($q$SELECT public.guardian_cancel_child_game(t.id('dee'), 'nope')$q$, 'Game not found', 'a missing game');
SELECT t.reset();
SELECT t.eq(pg_temp.req('dee') || '/' || pg_temp.pays('dee', 'pending'), 'pending/1', 'the refusals changed nothing');

-- ================= 2. a host's decline is kept =================
-- The host's Decline from the app (reviewJoinRequest, no reason): the server stamps last_rejected_at.
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'rejected', reviewer_notes = NULL, reviewed_at = now()
                         WHERE id = t.id('req-ada')$q$), 1, 'the host declines ada');
SELECT t.reset();
SELECT t.eq((SELECT last_rejected_at >= now() FROM public.join_requests WHERE id = t.id('req-ada')), true,
  'the decline is stamped by the server');
SELECT t.eq(left(pg_temp.resend('ada'), 11), 'Please wait', 'before any cancel, her resend is refused by the cooldown');
INSERT INTO before_cancel SELECT 'ada', pg_temp.row_of('ada');
SELECT t.eq(pg_temp.cancel('ada'), 'withdrawn', 'mom cancels for ada: the answer is unchanged (withdrawn)');
SELECT t.eq(pg_temp.row_of('ada'), (SELECT r FROM before_cancel WHERE who = 'ada'),
  'KEPT: ada''s declined request stays exactly as it was (status, notes, last_rejected_at, attempt_count)');
SELECT t.eq(left(pg_temp.resend('ada'), 11), 'Please wait',
  'KEPT: her resend straight after the cancel is still refused by the cooldown');
SELECT t.eq(pg_temp.row_of('ada'), (SELECT r FROM before_cancel WHERE who = 'ada'), 'and the refusal changed nothing');

-- ================= 3. 'Removed by host' is kept =================
-- The host removes ben (host_remove_player), then mom's cancel arrives (a list loaded earlier, or the app's retry after
-- a deadlock with the removal).
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('gkeep', t.id('ben')),
  '{"removed": true, "request_declined": true, "invites_cancelled": 0}'::jsonb, 'the host removes ben');
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || reviewer_notes FROM public.join_requests WHERE id = t.id('req-ben')),
  'rejected/Removed by host', 'his request is declined by the removal');
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE id = t.id('req-ben')), t.id('mom'),
  'the removal leaves mom''s earlier approval on the declined request');
INSERT INTO before_cancel SELECT 'ben', pg_temp.row_of('ben');
SELECT t.eq(pg_temp.cancel('ben'), 'withdrawn', 'mom cancels for ben after the removal: withdrawn, as before');
SELECT t.eq(pg_temp.row_of('ben') - 'guardian_approved_at' - 'guardian_approved_by',
            (SELECT r - 'guardian_approved_at' - 'guardian_approved_by' FROM before_cancel WHERE who = 'ben'),
  'KEPT: the ''Removed by host'' request stays as the removal left it (status, notes, last_rejected_at, attempt_count)');
SELECT t.eq((SELECT guardian_approved_at IS NULL AND guardian_approved_by IS NULL FROM public.join_requests
              WHERE id = t.id('req-ben')), true,
  'STAMP: mom''s cancel takes back her approval on the kept request');
SELECT t.eq(left(pg_temp.resend('ben'), 11), 'Please wait', 'KEPT: so ben cannot ask again at once');
SELECT t.eq(pg_temp.seats('ben'), 0, 'ben is off the roster');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('host') AND type = 'participant_left'
              AND title LIKE 'Ben %'), 0, 'mom''s cancel after the removal sends the host no participant_left notice');

-- ================= 4. a guardian's own no is kept =================
SELECT t.as_user(t.id('mom'));
SELECT public.guardian_approve_join_request(t.id('req-cyd'), false);
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || reviewer_notes FROM public.join_requests WHERE id = t.id('req-cyd')),
  'rejected/Declined by guardian', 'mom says no to cyd''s request');
INSERT INTO before_cancel SELECT 'cyd', pg_temp.row_of('cyd');
SELECT t.eq(pg_temp.cancel('cyd'), 'withdrawn', 'then cancels for cyd: withdrawn');
SELECT t.eq(pg_temp.row_of('cyd'), (SELECT r FROM before_cancel WHERE who = 'cyd'),
  'KEPT: the guardian''s ''Declined by guardian'' stays in place');
SELECT t.eq(left(pg_temp.resend('cyd'), 11), 'Please wait', 'KEPT: cyd cannot ask again at once');

-- ================= 5. a declined request with a place or a claim =================
-- gus is on the roster with a declined request: the place goes and the host is told; the request stays.
INSERT INTO before_cancel SELECT 'gus', pg_temp.row_of('gus');
SELECT t.eq(pg_temp.cancel('gus'), 'cancelled', 'mom cancels gus''s place: cancelled');
SELECT t.eq(pg_temp.seats('gus'), 0, 'his roster row is deleted');
SELECT t.eq(pg_temp.row_of('gus') - 'guardian_approved_at' - 'guardian_approved_by',
            (SELECT r - 'guardian_approved_at' - 'guardian_approved_by' FROM before_cancel WHERE who = 'gus'),
  'KEPT: his declined request stays');
SELECT t.eq((SELECT guardian_approved_at IS NULL AND guardian_approved_by IS NULL FROM public.join_requests
              WHERE id = t.id('req-gus')), true,
  'STAMP: and mom''s approval on it is taken back');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('host') AND type = 'participant_left'
              AND title = 'Gus left Keep run' AND body LIKE 'Their parent or guardian cancelled for them.%'), 1,
  'the host is told his place is open, as before');
-- hal has only a declined request and an unreviewed payment claim: the claim goes, as before; the request stays.
INSERT INTO before_cancel SELECT 'hal', pg_temp.row_of('hal');
SELECT t.eq(pg_temp.cancel('hal'), 'withdrawn', 'mom cancels for hal: withdrawn, as before');
SELECT t.eq(pg_temp.pays('hal', 'pending'), 0, 'his unreviewed payment claim is deleted, as before');
SELECT t.eq(pg_temp.row_of('hal'), (SELECT r FROM before_cancel WHERE who = 'hal'), 'KEPT: his declined request stays');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('host') AND type = 'participant_left'
              AND title LIKE 'Hal %'), 0, 'no place opened, so the host is not told');

-- ================= 6. everything else, as before =================
SELECT t.eq(pg_temp.cancel('dee'), 'withdrawn', 'a pending request: withdrawn');
SELECT t.eq(pg_temp.req('dee'), NULL, 'and deleted, as before');
SELECT t.eq(pg_temp.pays('dee', 'pending'), 0, 'with her unreviewed payment claim');
SELECT t.eq((SELECT joined FROM public.hosted_games WHERE id = 'gkeep'), 1, 'only eli is left on the roster');
SELECT t.eq(pg_temp.cancel('eli'), 'cancelled', 'an approved place on the roster: cancelled');
SELECT t.eq(pg_temp.req('eli'), NULL, 'his request is deleted, as before');
SELECT t.eq(pg_temp.seats('eli'), 0, 'he is off the roster');
SELECT t.eq(pg_temp.pays('eli', 'pending'), 0, 'his unreviewed claim is deleted');
SELECT t.eq((SELECT count(*)::int FROM public.payment_submissions WHERE id = t.id('pay-eli-ok')), 1,
  'his verified payment is kept (the settle trigger decides any refund)');
SELECT t.eq((SELECT joined FROM public.hosted_games WHERE id = 'gkeep'), 0, 'the roster triggers ran (joined count follows)');
SELECT t.eq(pg_temp.cancel('fay'), 'cancelled', 'an approved request not yet on the roster: cancelled');
SELECT t.eq(pg_temp.req('fay'), NULL, 'and deleted, as before');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('host') AND type = 'participant_left'
              AND body LIKE 'Their parent or guardian cancelled for them.%' AND title IN ('Eli left Keep run', 'Fay left Keep run')), 2,
  'the host is told for each place that opened');
SELECT t.eq(pg_temp.cancel('ivo'), 'nothing', 'a child with nothing in the game: nothing');
SELECT t.eq(pg_temp.cancel('ada'), 'withdrawn', 'cancelling again for a kept declined request answers as before');
SELECT t.eq(pg_temp.req('ada'), 'rejected', 'and still keeps it');
SELECT t.eq((SELECT count(*)::int FROM public.late_cancellations WHERE ref_id = 'gkeep'), 0,
  'three days ahead, none of these is a late cancellation');

-- ================= 7. after the cooldown, a kept request is sent again as any declined one =================
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET last_rejected_at = now() - interval '20 minutes'
 WHERE id IN (t.id('req-ada'), t.id('req-cyd'));
SET LOCAL session_replication_role = origin;
SELECT t.eq(pg_temp.resend('ada'), 'resent 1', 'KEPT: past the cooldown, ada sends her declined request again');
SELECT t.eq((SELECT status || '/' || attempt_count FROM public.join_requests WHERE id = t.id('req-ada')), 'pending/2',
  'KEPT: it counts as her second attempt (the cap still applies)');
SELECT t.eq(pg_temp.resend('cyd'), 'resent 1', 'KEPT: cyd sends hers again after the cooldown');
SELECT t.eq((SELECT status || '/' || (guardian_approved_at IS NULL)::text FROM public.join_requests WHERE id = t.id('req-cyd')),
  'pending/true', 'and it waits for mom''s approval again');

-- ================= 8. a new invitation after the cancel needs mom again =================
-- The host invites gus again after his decline and mom's cancel, and gus accepts. The accept moves his kept declined
-- request straight to approved, and gus waits for mom, as a child with no request would. Mom's cancel already took her
-- approval back (section 5, STAMP); the accept's reopening would take it back too, and hold him (section 9), so these
-- checks hold whether or not the cancel did.
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id) VALUES (t.id('inv-gus'), 'gkeep', t.id('host'), t.id('gus'));
SELECT t.as_user(t.id('gus'));
SELECT t.eq(public.game_respond_invite(t.id('inv-gus'), true) - 'join_request_id',
  '{"status": "accepted", "on_roster": false}'::jsonb,
  'gus accepts the new invitation: accepted, but not on the roster');
SELECT t.reset();
SELECT t.eq(pg_temp.seats('gus'), 0, 'no roster row for gus');
SELECT t.eq((SELECT status || '/' || (guardian_approved_at IS NULL AND guardian_approved_by IS NULL)::text
               FROM public.join_requests WHERE game_id = 'gkeep' AND player_id = t.id('gus')),
  'approved/true', 'his request is approved with no guardian approval: mom has to approve it first');

-- ================= 9. with no guardian cancel: a reopened declined request needs the guardian again =================
-- A host's decline or removal, and the payment window running out, leave the guardian's approval on the declined request.
-- When an accepted invitation reopens it (rejected -> approved), the widened trg_join_request_reopen_needs_guardian takes
-- the approval back and game_respond_invite holds a guarded minor for the guardian: approved, no roster row, listed for the
-- guardian, seated only after the guardian approves. Assertions marked REOPEN fail on the definitions before
-- 20261130110000 (the minor is seated, or the approval stays on the request).
-- jo: on gfix's roster with mom's approval, removed by the host. kai: asked for gfix, mom approved, the host declined.
-- lu: on gpay's (paid) roster with mom's approval, removed by the host. mo: approved on ghold (paid, 30-minute hold) with
-- mom's approval, not paid; the release declines it. ned (adult) and oy (17, no guardian link, a stale approval left on
-- the request): on gfix's roster, removed by the host. pia: asked for gfix, mom approved, the host declined (her resend).
-- quin: a declined gfix request with mom's approval (the service role's direct write). rio: on gfix's roster with mom's
-- approval; sam: alone on gone's roster (one place) with mom's approval; tad (adult): on gfix's roster. The host declines
-- the three without removing them.
SELECT t.person('jo', 15), t.person('kai', 15), t.person('lu', 15), t.person('mo', 15), t.person('ned', 30),
       t.person('oy', 17), t.person('pia', 15), t.person('quin', 15), t.person('rio', 15), t.person('sam', 15),
       t.person('tad', 30);
SELECT t.guardian('mom', k) FROM unnest(ARRAY['jo', 'kai', 'lu', 'mo', 'pia', 'quin', 'rio', 'sam']) k;
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, price) VALUES
  ('gfix',  t.id('host'), 'basketball', 'Fix run',  now() + interval '3 days', 12, 0),
  ('gpay',  t.id('host'), 'basketball', 'Paid run', now() + interval '3 days', 12, 10),
  ('ghold', t.id('host'), 'basketball', 'Hold run', now() + interval '3 days', 12, 10),
  ('gone',  t.id('host'), 'basketball', 'One run',  now() + interval '3 days', 1, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_hold_minutes) VALUES
  ('gfix', t.id('host'), 0, true, NULL), ('gpay', t.id('host'), 10, true, NULL), ('ghold', t.id('host'), 10, true, 30),
  ('gone', t.id('host'), 0, true, NULL);
INSERT INTO public.join_requests (id, game_id, host_id, player_id, status, idempotency_key, reviewed_at, last_rejected_at,
                                  guardian_approved_at, guardian_approved_by, created_at) VALUES
  (t.id('req-jo'),   'gfix',  t.id('host'), t.id('jo'),   'approved', 'k', now() - interval '50 minutes', NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-kai'),  'gfix',  t.id('host'), t.id('kai'),  'pending',  'k', NULL, NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-lu'),   'gpay',  t.id('host'), t.id('lu'),   'approved', 'k', now() - interval '50 minutes', NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-mo'),   'ghold', t.id('host'), t.id('mo'),   'approved', 'k', now() - interval '1 hour', NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '90 minutes'),
  (t.id('req-ned'),  'gfix',  t.id('host'), t.id('ned'),  'approved', 'k', now() - interval '50 minutes', NULL,
   NULL, NULL, now() - interval '1 hour'),
  (t.id('req-oy'),   'gfix',  t.id('host'), t.id('oy'),   'approved', 'k', now() - interval '50 minutes', NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-pia'),  'gfix',  t.id('host'), t.id('pia'),  'pending',  'k', NULL, NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-quin'), 'gfix',  t.id('host'), t.id('quin'), 'rejected', 'k', now() - interval '10 minutes',
   now() - interval '10 minutes', now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-rio'),  'gfix',  t.id('host'), t.id('rio'),  'approved', 'k', now() - interval '50 minutes', NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-sam'),  'gone',  t.id('host'), t.id('sam'),  'approved', 'k', now() - interval '50 minutes', NULL,
   now() - interval '55 minutes', t.id('mom'), now() - interval '1 hour'),
  (t.id('req-tad'),  'gfix',  t.id('host'), t.id('tad'),  'approved', 'k', now() - interval '50 minutes', NULL,
   NULL, NULL, now() - interval '1 hour');
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('gfix', t.id('jo')), ('gpay', t.id('lu')), ('gfix', t.id('ned')), ('gfix', t.id('oy')), ('gfix', t.id('rio')),
  ('gone', t.id('sam')), ('gfix', t.id('tad'));
UPDATE public.hosted_games g SET joined = (SELECT count(*) FROM public.game_participants p WHERE p.game_id = g.id)
 WHERE g.id IN ('gfix', 'gpay', 'ghold', 'gone');
-- mo's invitation was sent two hours ago, before her place was approved (the release does not take it back).
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id, created_at)
VALUES (t.id('inv-mo'), 'ghold', t.id('host'), t.id('mo'), now() - interval '2 hours');
SET LOCAL session_replication_role = origin;

-- The host's decisions, through the real paths.
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('gfix', t.id(w)) ->> 'request_declined', 'true', 'the host removes ' || w)
  FROM unnest(ARRAY['jo', 'ned', 'oy']) w;
SELECT t.eq(public.host_remove_player('gpay', t.id('lu')) ->> 'request_declined', 'true', 'the host removes lu from the paid game');
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now()
                         WHERE id IN (t.id('req-kai'), t.id('req-pia'), t.id('req-rio'), t.id('req-sam'),
                                      t.id('req-tad'))$q$), 5,
  'the host declines kai and pia, and rio, sam and tad without removing them');
SELECT t.reset();
SELECT t.eq(public.release_expired_payment_holds('ghold'), 1, 'the payment window runs out on mo''s place');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests
              WHERE id IN (t.id('req-jo'), t.id('req-kai'), t.id('req-lu'), t.id('req-mo'), t.id('req-oy'), t.id('req-pia'))
                AND status = 'rejected' AND guardian_approved_by = t.id('mom')), 6,
  'a host''s decline or removal and the payment window leave mom''s approval on the declined requests');
-- The host invites them again a few minutes later (the declines are moved back so the new invitations come after them,
-- as a real re-invitation would; written directly, as game_invite_player asks for an open post the fixtures do not have;
-- for rio, sam and tad, who are still on the roster, game_invite_player would refuse, ALREADY_IN_GAME; 9h says how a
-- player gets there).
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET last_rejected_at = now() - interval '5 minutes', reviewed_at = now() - interval '5 minutes'
 WHERE id IN (t.id('req-jo'), t.id('req-kai'), t.id('req-lu'), t.id('req-ned'), t.id('req-oy'), t.id('req-rio'),
              t.id('req-sam'), t.id('req-tad'));
SET LOCAL session_replication_role = origin;
INSERT INTO public.game_invites (id, game_id, host_id, invitee_id)
SELECT t.id('inv-' || w), g, t.id('host'), t.id(w)
  FROM (VALUES ('gfix', 'jo'), ('gfix', 'kai'), ('gpay', 'lu'), ('gfix', 'ned'), ('gfix', 'oy'), ('gfix', 'rio'),
               ('gone', 'sam'), ('gfix', 'tad')) v(g, w);

CREATE FUNCTION pg_temp.accept(who text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_user(t.id(who));
  r := public.game_respond_invite(t.id('inv-' || who), true);
  PERFORM t.reset();
  RETURN r - 'join_request_id';
END $$;
-- The request's status and whether it carries a guardian approval: 'approved/none', 'approved/mom', ...
CREATE FUNCTION pg_temp.state(who text) RETURNS text LANGUAGE sql AS $$
  SELECT status || '/' || CASE WHEN guardian_approved_at IS NULL AND guardian_approved_by IS NULL THEN 'none'
                               WHEN guardian_approved_by = t.id('mom') THEN 'mom' ELSE 'partial' END
    FROM public.join_requests WHERE player_id = t.id(who) AND game_id IN ('gfix', 'gpay', 'ghold', 'gone') $$;
CREATE FUNCTION pg_temp.on_roster(who text, game text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.game_participants WHERE game_id = game AND user_id = t.id(who) $$;
-- The child takes the place themselves (the game page's join, or the roster write after a payment): 'seated' or the refusal.
CREATE FUNCTION pg_temp.take(who text, game text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id(who));
  BEGIN
    INSERT INTO public.game_participants (game_id, user_id) VALUES (game, t.id(who));
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN split_part(SQLERRM, ':', 1);
  END;
  PERFORM t.reset();
  RETURN 'seated';
END $$;
-- What mom's Parent Center reads (useGuardianApprovals), as mom under the read rules: her children's pending and approved
-- requests with no guardian approval.
CREATE FUNCTION pg_temp.listed_for_mom(who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id('mom'));
  SELECT count(*)::int INTO n FROM public.join_requests
   WHERE player_id = t.id(who) AND status IN ('pending', 'approved') AND guardian_approved_at IS NULL;
  PERFORM t.reset();
  RETURN n;
END $$;
-- Mom's Approve in the Parent Center: 'approved' or the refusal.
CREATE FUNCTION pg_temp.mom_approves(who text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id('mom'));
  BEGIN
    PERFORM public.guardian_approve_join_request(t.id('req-' || who), true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN split_part(SQLERRM, ':', 1);
  END;
  PERFORM t.reset();
  RETURN 'approved';
END $$;

-- 9a. Removed by the host, invited again, accepts: held for mom.
SELECT t.eq(pg_temp.accept('jo'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'REOPEN: jo, removed and invited again, accepts: accepted, not on the roster');
SELECT t.eq(pg_temp.on_roster('jo', 'gfix'), 0, 'REOPEN: no roster row for jo');
SELECT t.eq(pg_temp.state('jo'), 'approved/none', 'REOPEN: his request is approved and mom''s old approval is taken back');
SELECT t.eq((SELECT status FROM public.game_invites WHERE id = t.id('inv-jo')), 'accepted', 'the invitation is accepted');
SELECT t.eq(pg_temp.listed_for_mom('jo'), 1, 'REOPEN: the request is in mom''s Parent Center list');
SELECT t.eq(pg_temp.take('jo', 'gfix'), 'GUARDIAN_APPROVAL_REQUIRED', 'REOPEN: jo cannot take the place from the game page yet');
SELECT t.eq(pg_temp.mom_approves('jo'), 'approved', 'REOPEN: mom approves the reopened request from her list');
SELECT t.eq(pg_temp.state('jo'), 'approved/mom', 'it carries her approval');
SELECT t.eq(pg_temp.listed_for_mom('jo'), 0, 'and it leaves her list');
SELECT t.eq(pg_temp.take('jo', 'gfix'), 'seated', 'then jo takes the place');
SELECT t.eq(pg_temp.on_roster('jo', 'gfix'), 1, 'jo is on the roster');

-- 9b. Declined by the host (not removed), invited again, accepts: held the same way.
SELECT t.eq(pg_temp.accept('kai'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'REOPEN: kai, declined and invited again, accepts: accepted, not on the roster');
SELECT t.eq(pg_temp.state('kai') || '/' || pg_temp.on_roster('kai', 'gfix'), 'approved/none/0',
  'REOPEN: approved, mom''s approval taken back, no roster row');
SELECT t.eq(pg_temp.take('kai', 'gfix'), 'GUARDIAN_APPROVAL_REQUIRED', 'REOPEN: kai cannot take the place yet');
SELECT t.eq(pg_temp.mom_approves('kai'), 'approved', 'mom approves kai''s request');
SELECT t.eq(pg_temp.take('kai', 'gfix'), 'seated', 'after mom approves, kai takes the place');

-- 9c. A paid game: the guardian step is not skipped either.
SELECT t.eq(pg_temp.accept('lu'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'lu, removed from the paid game and invited again, accepts: accepted, not on the roster (paid)');
SELECT t.eq(pg_temp.state('lu'), 'approved/none', 'REOPEN: mom''s old approval is taken back on the paid game too');
SELECT t.eq(pg_temp.listed_for_mom('lu'), 1, 'REOPEN: the request is in mom''s list');
SET LOCAL session_replication_role = replica;
INSERT INTO public.payment_submissions (id, game_id, host_id, player_id, payment_type, status)
VALUES (t.id('pay-lu'), 'gpay', t.id('host'), t.id('lu'), 'venmo', 'verified');
SET LOCAL session_replication_role = origin;
SELECT t.eq(pg_temp.take('lu', 'gpay'), 'GUARDIAN_APPROVAL_REQUIRED',
  'REOPEN: even once lu''s payment is verified, the place waits for mom');
SELECT t.eq(pg_temp.mom_approves('lu'), 'approved', 'mom approves lu''s request');
SELECT t.eq(pg_temp.take('lu', 'gpay'), 'seated', 'after mom approves, the paid place is taken');

-- 9d. The payment window ran out (not a take-back): the old invitation is accepted, and mom is asked again.
SELECT t.eq(pg_temp.accept('mo'), '{"status": "accepted", "on_roster": false}'::jsonb,
  'mo accepts the invitation after her place was released: accepted, not on the roster (paid)');
SELECT t.eq(pg_temp.state('mo'), 'approved/none', 'REOPEN: mom''s approval given before the release is taken back');

-- 9e. Adults and minors with no guardian link: unchanged, seated on a free game.
SELECT t.eq(pg_temp.accept('ned'), '{"status": "accepted", "on_roster": true}'::jsonb,
  'an adult removed and invited again accepts: on the roster, as before');
SELECT t.eq(pg_temp.state('ned') || '/' || pg_temp.on_roster('ned', 'gfix'), 'approved/none/1', 'one roster row, as before');
SELECT t.eq(pg_temp.accept('oy'), '{"status": "accepted", "on_roster": true}'::jsonb,
  'a 17-year-old with no guardian link, removed and invited again, accepts: on the roster, as before');
SELECT t.eq(pg_temp.on_roster('oy', 'gfix'), 1, 'one roster row (the stale approval on the request plays no part)');

-- 9f. The child's resend (rejected -> pending) is unchanged: the approval is taken back, as since 20261110120000.
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET last_rejected_at = now() - interval '20 minutes' WHERE id = t.id('req-pia');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('pia'));
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'pending' WHERE id = t.id('req-pia') AND status = 'rejected'$q$),
  1, 'pia sends her declined request again after the cooldown');
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || attempt_count || '/' || (guardian_approved_at IS NULL AND guardian_approved_by IS NULL)::text
               FROM public.join_requests WHERE id = t.id('req-pia')), 'pending/2/true',
  'her resend counts as a second attempt and waits for mom again, as before');

-- 9g. Any writer: the service role moving a declined request to approved takes the approval back too.
SELECT t.as_service();
SELECT t.eq(t.changed($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-quin')$q$), 1,
  'the service role approves quin''s declined request directly');
SELECT t.reset();
SELECT t.eq(pg_temp.state('quin'), 'approved/none', 'REOPEN: and mom''s old approval is taken back');
SELECT t.eq(pg_temp.take('quin', 'gfix'), 'GUARDIAN_APPROVAL_REQUIRED', 'REOPEN: so quin waits for mom');
-- A client cannot: the host is refused (DECISION_FINAL), and the player may only send it again (pending).
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET status = 'rejected', last_rejected_at = now() - interval '20 minutes',
                                guardian_approved_at = now() - interval '55 minutes', guardian_approved_by = t.id('mom')
 WHERE id = t.id('req-quin');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$UPDATE public.join_requests SET status = 'approved' WHERE id = t.id('req-quin')$q$, 'DECISION_FINAL',
  'the host cannot reopen a declined request to approved');
SELECT t.as_user(t.id('quin'));
SELECT t.throws($q$UPDATE public.join_requests SET status = 'approved' WHERE id = t.id('req-quin')$q$, 'row-level security',
  'nor can the child (their update rule allows only rejected -> pending)');
SELECT t.reset();
SELECT t.eq(pg_temp.state('quin'), 'rejected/mom', 'so the request is as it was');

-- 9h. Still on the roster under a host's decline (not removed), with a pending invitation, accepts. A guarded minor: the
-- place and the declined request stay as they were (the accept does not reopen it), so nothing waits in mom's list, with
-- room or on a full game. An adult: the accept reopens the request as before (20261127120000), so the host's later
-- removal declines it again, with the resend cooldown. How a player gets there: game_invite_player refuses a player on
-- the roster (ALREADY_IN_GAME) and a host's decline cancels the pending invitations (20261129130000), but a player with a
-- declined request can be seated after an invitation was sent if the host opens the game (approval off): an adult or a
-- minor with no guardian link takes a place directly (the join gate allows it), then accepts. A guarded minor's own join on a declined request
-- is refused by the roster's guardian rule, so they get there only if the guardian link is made after such a join, or
-- through older data or a direct invitation write. The invitations here are written directly.
SELECT t.eq(pg_temp.accept('rio'), '{"status": "accepted", "on_roster": true}'::jsonb,
  'rio, still on the roster under the host''s decline, accepts: accepted, on the roster, as before');
SELECT t.eq(pg_temp.state('rio') || '/' || pg_temp.on_roster('rio', 'gfix'), 'rejected/mom/1',
  'his place stays, and his request stays declined with mom''s approval (not reopened)');
SELECT t.eq((SELECT status FROM public.game_invites WHERE id = t.id('inv-rio')), 'accepted', 'the invitation is accepted');
SELECT t.eq(pg_temp.listed_for_mom('rio'), 0, 'nothing lands in mom''s list that she could not act on');
SELECT t.eq(pg_temp.accept('sam'), '{"status": "accepted", "on_roster": true}'::jsonb,
  'sam, alone on a one-place game under the host''s decline, accepts: accepted, not full, as before');
SELECT t.eq(pg_temp.state('sam') || '/' || pg_temp.on_roster('sam', 'gone'), 'rejected/mom/1',
  'his place and his declined request stay as they were');
SELECT t.eq((SELECT status FROM public.game_invites WHERE id = t.id('inv-sam')), 'accepted', 'his invitation is accepted');
SELECT t.eq(pg_temp.listed_for_mom('sam'), 0, 'and nothing waits in mom''s list');
-- tad's decline is moved back past the 15-minute cooldown (still before his invitation), so only a fresh decline by
-- the removal can hold back his resend below.
SET LOCAL session_replication_role = replica;
UPDATE public.join_requests SET last_rejected_at = now() - interval '20 minutes', reviewed_at = now() - interval '20 minutes'
 WHERE id = t.id('req-tad');
SET LOCAL session_replication_role = origin;
SELECT t.eq(pg_temp.accept('tad'), '{"status": "accepted", "on_roster": true}'::jsonb,
  'an adult still on the roster under the host''s decline accepts: accepted, on the roster, as before');
SELECT t.eq((SELECT status || '/' || coalesce(reviewer_notes, '') FROM public.join_requests WHERE id = t.id('req-tad'))
            || '/' || pg_temp.on_roster('tad', 'gfix') || '/' || (SELECT status FROM public.game_invites WHERE id = t.id('inv-tad')),
  'approved/Invited by the host/1/accepted',
  'his request is reopened to approved, as before (the exception is for a guarded minor only); the invitation is accepted');
SELECT t.as_user(t.id('host'));
SELECT t.eq(public.host_remove_player('gfix', t.id('tad')) ->> 'request_declined', 'true',
  'the host then removes tad: his request is declined again, as before');
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || coalesce(reviewer_notes, '') || '/' || (last_rejected_at > now() - interval '1 minute')::text
               FROM public.join_requests WHERE id = t.id('req-tad')) || '/' || pg_temp.on_roster('tad', 'gfix'),
  'rejected/Removed by host/true/0', 'with the removal''s note and a fresh decline time, and off the roster');
SELECT t.as_user(t.id('tad'));
SELECT t.throws($q$UPDATE public.join_requests SET status = 'pending' WHERE id = t.id('req-tad')$q$, 'Please wait',
  'so tad''s resend straight after the removal is refused by the cooldown, as before');
SELECT t.reset();
-- rio leaves (the player's own Leave): the declined request he kept does not let him back without mom.
SELECT t.as_user(t.id('rio'));
SELECT t.eq(t.changed($q$DELETE FROM public.game_participants WHERE game_id = 'gfix' AND user_id = t.id('rio')$q$), 1,
  'rio leaves the game');
SELECT t.reset();
SELECT t.eq(pg_temp.take('rio', 'gfix'), 'GUARDIAN_APPROVAL_REQUIRED',
  'and cannot take the place again on the approval left on his declined request');

-- ================= 10. the functions and the trigger =================
SELECT t.eq((SELECT md5(replace(replace(pg_get_functiondef(p.oid), ' AND status <> ''rejected''', ''),
                                E'  UPDATE public.join_requests SET guardian_approved_at = NULL, guardian_approved_by = NULL\n'
                                || E'   WHERE game_id = _game AND player_id = _child AND status = ''rejected''\n'
                                || E'     AND (guardian_approved_at IS NOT NULL OR guardian_approved_by IS NOT NULL);\n', ''))
               FROM pg_proc p WHERE p.oid = 'public.guardian_cancel_child_game(uuid,text)'::regprocedure),
  'db2a64a1cda58c6180ba3080a3b1ede0',
  'apart from the predicate and the update that takes back a guardian''s approval, the definition is 20261008160000''s character for character');
SELECT t.eq((SELECT md5(pg_get_functiondef('public.guardian_cancel_child_game(uuid,text)'::regprocedure))),
  '791f8fe8e4412acd7fe80b34a516809a', 'KEPT: the definition is the one 20261130110000 created (the rollback guard expects it)');
SELECT t.eq((SELECT proowner::regrole::text || '/' || prosecdef::text || '/' || proconfig::text || '/' || prorettype::regtype::text
               FROM pg_proc WHERE oid = 'public.guardian_cancel_child_game(uuid,text)'::regprocedure),
  'postgres/true/{search_path=public}/text', 'same owner, SECURITY DEFINER, search_path and return type');
SELECT t.eq((SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE p.oid = 'public.guardian_cancel_child_game(uuid,text)'::regprocedure
                AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated:EXECUTE,service_role:EXECUTE', 'the same grants: members and the service role, not PUBLIC or visitors');
SELECT t.eq(has_function_privilege('anon', 'public.guardian_cancel_child_game(uuid,text)', 'EXECUTE'), false,
  'visitors cannot call it');
SELECT t.eq(has_function_privilege('authenticated', 'public.guardian_cancel_child_game(uuid,text)', 'EXECUTE'), true,
  'members can (the guardian check is inside)');

SELECT t.eq((SELECT md5(replace(replace(replace(replace(pg_get_functiondef(p.oid),
                E'  _guarded boolean;\n  _on   boolean;\n', ''),
                E'  -- The roster trigger''s guardian rule, for the request as it stands once approved. A declined request carries no\n'
                || E'  -- guardian approval once approved: the update below reopens it, and trg_join_request_reopen_needs_guardian clears it.\n'
                || E'  -- A guarded minor already on the roster under a declined request (a host''s decline that did not remove them) keeps\n'
                || E'  -- both as they are: the update below leaves that request declined, with its approval. Anyone else''s is reopened.\n'
                || E'  _guarded := COALESCE(public.is_minor(_me), false)\n'
                || E'              AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = ''active'');\n'
                || E'  _on := _guarded AND private_sec.is_game_participant(_i.game_id, _me);\n'
                || E'  _held := _guarded\n',
                E'  -- The roster trigger''s guardian rule, for the request as it stands once approved.\n'
                || E'  _held := COALESCE(public.is_minor(_me), false)\n'
                || E'           AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = ''active'')\n'),
                E'NOT COALESCE((_jr.status IS DISTINCT FROM ''rejected'' OR _on)\n                            AND _jr.guardian_approved_at',
                'NOT COALESCE(_jr.guardian_approved_at'),
                E' AND status <> ''approved'' AND NOT (status = ''rejected'' AND _on);\n',
                E' AND status <> ''approved'';\n'))
               FROM pg_proc p WHERE p.oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure),
  '9c24daeafcdd5dd4443c612a7cf040d3',
  'apart from the declined-request tests (the guardian-held test and the reopen update, both sparing a guarded minor already on the roster), the guarded test worked out once, and their comment, game_respond_invite is 20261127120000''s character for character');
SELECT t.eq((SELECT md5(pg_get_functiondef('public.game_respond_invite(uuid,boolean)'::regprocedure))),
  '79fa287fb3126c74dce0f902542d3e4e', 'REOPEN: game_respond_invite is the one 20261130110000 created (the rollback guard expects it)');
SELECT t.eq((SELECT proowner::regrole::text || '/' || prosecdef::text || '/' || proconfig::text || '/' || prorettype::regtype::text
               FROM pg_proc WHERE oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure),
  'postgres/true/{"search_path=\"\""}/jsonb', 'game_respond_invite: same owner, SECURITY DEFINER, empty search_path and return type');
SELECT t.eq((SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
               FROM pg_proc p
               CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               LEFT JOIN pg_roles r ON r.oid = x.grantee
              WHERE p.oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure
                AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role')),
  'authenticated:EXECUTE,service_role:EXECUTE', 'game_respond_invite: the same grants, not PUBLIC or visitors');
SELECT t.eq((SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_reopen_needs_guardian'),
  'CREATE TRIGGER trg_join_request_reopen_needs_guardian BEFORE UPDATE OF status ON public.join_requests FOR EACH ROW WHEN '
  || '(((old.status = ''rejected''::text) AND (new.status = ANY (ARRAY[''pending''::text, ''approved''::text])) '
  || 'AND ((new.guardian_approved_at IS NOT NULL) OR (new.guardian_approved_by IS NOT NULL)))) '
  || 'EXECUTE FUNCTION private_sec.join_request_reopen_needs_guardian()',
  'REOPEN: the trigger fires on a declined request reopened to pending or approved; same timing, name and function');
SELECT t.eq((SELECT md5(pg_get_triggerdef(t.oid)) FROM pg_trigger t
              WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_reopen_needs_guardian'),
  '5480c92ea0314eef6701e1b2d266ddce', 'REOPEN: the trigger is the one 20261130110000 created (the rollback guard expects it)');
SELECT t.eq((SELECT tgenabled FROM pg_trigger WHERE tgrelid = 'public.join_requests'::regclass
              AND tgname = 'trg_join_request_reopen_needs_guardian'), 'O'::"char", 'and it is enabled');
SELECT t.eq((SELECT md5(pg_get_functiondef('private_sec.join_request_reopen_needs_guardian()'::regprocedure))),
  'c9fb75dd4172e2c5b76c8fed9e9c4c9c', 'the trigger''s function is unchanged (20261110120000''s)');

ROLLBACK;
