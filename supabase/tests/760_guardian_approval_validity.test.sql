-- Audit F03 (P0-5): a guardian's approval of a minor's game request counts only while the guardian who gave it still
-- has authority, and nobody but that guardian can write it.
--
-- teen (16) has two guardians, ga and gb. Payment (enforce_guardian_before_payment), a roster place
-- (enforce_child_game_participation) and accepting a team invite (team_respond_invite) all need a valid approval.
BEGIN;

SELECT t.person('host', 40), t.person('ga', 41), t.person('gb', 44), t.person('teen', 16), t.person('adult', 28),
       t.person('coach', 35);
SELECT t.guardian('ga', 'teen');
SELECT t.guardian('gb', 'teen');

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('paid', t.id('host'), 'Paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10),
       ('roster', t.id('host'), 'Roster run', 'Basketball', now() + interval '4 days', 'Gym', 10, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('paid', t.id('host'), 10, false);

CREATE TEMP TABLE pay_stmt AS
SELECT format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'paid', %L)$q$,
              t.id('teen'), t.id('host')) AS sql;
GRANT SELECT ON pay_stmt TO authenticated;

-- ---- 1. the approval stamp is not writable through the API ------------------------------------------------------
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format($q$INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key,
                                                            guardian_approved_at, guardian_approved_by)
                          VALUES (%L, 'paid', %L, %L, 'forged', now(), %L)$q$,
                       t.id('req-forged'), t.id('teen'), t.id('host'), t.id('ga')),
  'GUARDIAN_APPROVAL_FORBIDDEN', 'a child cannot create a request already marked approved by their guardian');
SELECT t.lives(format($q$INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
                        VALUES (%L, 'paid', %L, %L, 'k-paid')$q$, t.id('req'), t.id('teen'), t.id('host')),
  'a child can still ask to join');
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED', 'and cannot pay before a guardian approves');

SELECT t.as_user(t.id('host'));
SELECT t.throws(format($q$UPDATE public.join_requests SET guardian_approved_at = now(), guardian_approved_by = %L
                          WHERE id = %L$q$, t.id('ga'), t.id('req')),
  'GUARDIAN_APPROVAL_FORBIDDEN', 'the host cannot stamp a guardian''s approval on a request for their game');
SELECT t.lives(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = %L$q$, t.id('req')),
  'the host can still answer the request');
SELECT t.reset();
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE id = t.id('req')), NULL::uuid,
  'no approval was recorded by those attempts');

-- ---- 2. a current guardian's approval works ----------------------------------------------------------------------
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'ga approves');
SELECT t.as_user(t.id('teen'));
SELECT t.lives((SELECT sql FROM pay_stmt), 'with ga''s approval the child can pay');
SELECT t.reset();

-- ---- 3. ending the link voids that guardian's open approvals -------------------------------------------------------
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.revoke_guardian_link(%L)', t.id('teen')), 'ga ends their link');
SELECT t.reset();
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE id = t.id('req')), NULL::uuid,
  'ga''s approval of the open request is cleared');
SELECT t.as_user(t.id('teen'));
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED',
  'while gb''s link keeps the gate on, the child cannot pay on the removed guardian''s approval');
SELECT t.as_user(t.id('ga'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'NOT_GUARDIAN',
  'the removed guardian cannot approve again');
SELECT t.as_user(t.id('gb'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'the remaining guardian approves');
SELECT t.as_user(t.id('teen'));
SELECT t.lives((SELECT sql FROM pay_stmt), 'and the child can pay again');
SELECT t.reset();

-- ---- 4. a stale stamp does not count, however it got there ---------------------------------------------------------
-- The server writes as service_role and stays trusted; here it leaves a stamp naming someone who is not a guardian.
SELECT t.as_service();
SELECT t.lives(format($q$UPDATE public.join_requests SET guardian_approved_by = %L WHERE id = %L$q$, t.id('adult'), t.id('req')),
  'the server (service role) can still write the stamp');
SELECT t.reset();
SELECT t.as_user(t.id('teen'));
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED',
  'a stamp naming someone who is not the child''s guardian does not unlock payment');
SELECT t.as_user(t.id('gb'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'gb approves again');
SELECT t.reset();
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE id = t.id('req')), t.id('gb'),
  'the stale approver is replaced, not kept');

-- A link that loses its verification no longer carries approvals either.
UPDATE public.guardian_links SET verified_at = NULL WHERE parent_user_id = t.id('gb') AND child_user_id = t.id('teen');
SELECT t.as_user(t.id('teen'));
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED', 'an unverified guardian''s approval does not count');
SELECT t.reset();
UPDATE public.guardian_links SET verified_at = now() WHERE parent_user_id = t.id('gb') AND child_user_id = t.id('teen');

-- ---- 5. an ineligible guardian cannot approve, and their approval stops counting ---------------------------------
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('gb');
SELECT t.as_user(t.id('teen'));
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED', 'a suspended guardian''s approval stops counting');
SELECT t.as_user(t.id('gb'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'GUARDIAN_NOT_ELIGIBLE',
  'a suspended guardian cannot approve');
SELECT t.reset();
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('gb');

-- ---- 6. the roster gate ----------------------------------------------------------------------------------------------
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
                        VALUES (%L, 'roster', %L, %L, 'k-roster')$q$, t.id('req-roster'), t.id('teen'), t.id('host')),
  'the child asks to join the free game');
SELECT t.reset();
UPDATE public.join_requests SET guardian_approved_at = now(), guardian_approved_by = t.id('ga') WHERE id = t.id('req-roster');
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'roster', t.id('teen')),
  'GUARDIAN_APPROVAL_REQUIRED', 'an approval by a former guardian does not put the child on the roster');
SELECT t.as_user(t.id('gb'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-roster')), 'the current guardian approves');
SELECT t.reset();
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'roster', t.id('teen')),
  'then the child can take the place');

-- ---- 7. team invites ---------------------------------------------------------------------------------------------------
SELECT t.team('squad', 'coach');
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by, guardian_approved_at, guardian_approved_by)
VALUES (t.id('invite-stale'), 'squad', t.id('teen'), t.id('coach'), now(), t.id('ga'));
SELECT t.as_user(t.id('teen'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', t.id('invite-stale')),
  'GUARDIAN_APPROVAL_REQUIRED', 'an invite approved by a former guardian cannot be accepted');
SELECT t.reset();
UPDATE public.team_invites SET guardian_approved_by = t.id('gb') WHERE id = t.id('invite-stale');
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format('SELECT public.team_respond_invite(%L, true)', t.id('invite-stale')),
  'with a current guardian''s approval it can');
SELECT t.reset();

-- ---- 8. adults are unaffected ---------------------------------------------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'paid', %L)$q$,
                      t.id('adult'), t.id('host')), 'an adult pays as before');
SELECT t.reset();

ROLLBACK;
