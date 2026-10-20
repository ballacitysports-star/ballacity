-- A minor with an active guardian link cannot join a team or a game on their own
-- say-so. Their guardian approves first (guardian_approve_team_invite /
-- guardian_approve_join_request), a published team waiver must be signed, and a
-- child whose consent is withdrawn is locked out of all of it.
BEGIN;

SELECT t.person('coachone', 35), t.person('guardian', 41), t.person('stranger', 29),
       t.person('teenmid', 14), t.person('adultjoiner', 27), t.person('kidyoung', 10);
SELECT t.guardian('guardian', 'teenmid');
SELECT t.guardian('guardian', 'kidyoung');
SELECT t.team('squad', 'coachone');

-- ---- team invites ----------------------------------------------------------
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by) VALUES
  (t.id('invite-teen'), 'squad', t.id('teenmid'), t.id('coachone')),
  (t.id('invite-adult'), 'squad', t.id('adultjoiner'), t.id('coachone'));

SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', t.id('invite-teen')),
  'GUARDIAN_APPROVAL_REQUIRED', 'a minor cannot accept a team invite without their guardian');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('invite-teen')),
  'NOT_GUARDIAN', 'a stranger cannot approve a minor''s invite');
SELECT t.as_user(t.id('coachone'));
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('invite-teen')),
  'NOT_GUARDIAN', 'the inviting coach cannot approve it either');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('teenmid')), 0,
  'the minor is still not on the team');

-- A published waiver blocks joining until it is signed, adult or minor.
INSERT INTO public.team_waivers (id, team_id, version, title, content, published, published_at, created_by)
VALUES (t.id('waiver'), 'squad', '1', 'Team waiver', 'Terms.', true, now(), t.id('coachone'));

SELECT t.as_user(t.id('guardian'));
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('invite-teen')),
  'WAIVER_REQUIRED', 'the guardian''s approval is refused while the waiver is unsigned');
SELECT t.as_user(t.id('adultjoiner'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', t.id('invite-adult')),
  'WAIVER_REQUIRED', 'an adult cannot join past an unsigned waiver');
SELECT t.reset();

INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by)
VALUES (t.id('waiver'), 'squad', t.id('teenmid'), t.id('guardian')),
       (t.id('waiver'), 'squad', t.id('adultjoiner'), t.id('adultjoiner'));

-- Withdrawn consent locks the child out even with everything else in order.
UPDATE public.parental_consents SET status = 'revoked', revoked_at = now() WHERE child_user_id = t.id('teenmid');
SELECT t.as_user(t.id('guardian'));
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('invite-teen')),
  'CHILD_ACTIVITY_LOCKED', 'a child with withdrawn consent cannot be approved onto a team');
SELECT t.reset();
UPDATE public.parental_consents SET status = 'approved', revoked_at = NULL WHERE child_user_id = t.id('teenmid');

SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('invite-teen')),
  'the guardian can approve once the waiver is signed');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('teenmid')), 1,
  'the minor is on the team after the guardian approves');

SELECT t.as_user(t.id('adultjoiner'));
SELECT t.lives(format('SELECT public.team_respond_invite(%L, true)', t.id('invite-adult')),
  'an adult with a signed waiver joins on their own');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('adultjoiner')), 1,
  'the adult is on the team');

-- Declining is never gated.
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by) VALUES (t.id('invite-teen-2'), 'squad', t.id('kidyoung'), t.id('coachone'));
SELECT t.as_user(t.id('kidyoung'));
SELECT t.lives(format('SELECT public.team_respond_invite(%L, false)', t.id('invite-teen-2')), 'a minor can always decline an invite');
SELECT t.reset();

-- ---- game joins ------------------------------------------------------------
-- A join request is always made by the player themselves, so make them as that
-- player.
INSERT INTO public.hosted_games (id, host_id, sport, title, date)
VALUES ('game-1', t.id('coachone'), 'basketball', 'Pickup', now() + interval '2 days');

SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, %L, %L)',
  t.id('request-teen'), 'game-1', t.id('teenmid'), t.id('coachone'), 'k1'),
  'a minor can ask to join a game; the ask itself is not gated');
SELECT t.reset();

SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'game-1', t.id('teenmid')),
  'GUARDIAN_APPROVAL_REQUIRED', 'a minor cannot be added to a game before their guardian approves the request');

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('request-teen')),
  'NOT_GUARDIAN', 'a stranger cannot approve a minor''s join request');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('request-teen')), 'the guardian approves the join request');
SELECT t.reset();

SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'game-1', t.id('teenmid')),
  'the minor can be added once approved');

-- An under-13 also needs the guardian to have switched game participation on.
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('kidyoung');
SELECT t.as_user(t.id('kidyoung'));
SELECT t.throws(format('INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, %L, %L)',
  t.id('request-kid'), 'game-1', t.id('kidyoung'), t.id('coachone'), 'k2'),
  'CHILD_GAME_PARTICIPATION_BLOCKED', 'an under-13 cannot even request a game while participation is off');
SELECT t.reset();
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('kidyoung');
SELECT t.as_user(t.id('kidyoung'));
SELECT t.lives(format('INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, %L, %L)',
  t.id('request-kid'), 'game-1', t.id('kidyoung'), t.id('coachone'), 'k3'),
  'with participation on, an under-13 can request a game');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, false)', t.id('request-kid')), 'the guardian can decline');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.join_requests WHERE id = t.id('request-kid')), 'rejected', 'a declined request is rejected');
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'game-1', t.id('kidyoung')),
  'GUARDIAN_APPROVAL_REQUIRED', 'a declined request cannot be turned into a place in the game');

ROLLBACK;
