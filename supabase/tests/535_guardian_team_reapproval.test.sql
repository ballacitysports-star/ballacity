-- SEC-7 item 5: after a guardian change a current verified guardian re-approves the child's existing team membership in place, which restores
-- the team as a messaging context. Only a current verified guardian can do it.
BEGIN;
SELECT t.person('coach', 38), t.person('kid', 15), t.person('oldg', 44), t.person('newg', 41), t.person('pendg', 43), t.person('stranger', 35),
       t.person('adultm', 30);
SELECT t.guardian('oldg', 'kid');
SELECT t.team('squad', 'coach');
SELECT t.team('other', 'coach');
SELECT t.invited_member('squad', 'kid', 'oldg');
SELECT t.invited_member('squad', 'adultm');
SELECT t.ok(private_sec.messaging_connection(t.id('coach'), t.id('kid')), 'setup: the guardian-approved membership is a messaging context');

-- the guardian changes: the old link is revoked, a new verified guardian is linked, and an unverified link exists
UPDATE public.guardian_links SET status = 'revoked' WHERE parent_user_id = t.id('oldg') AND child_user_id = t.id('kid');
SELECT t.guardian('newg', 'kid');
INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at) VALUES (t.id('pendg'), t.id('kid'), 'parent', 'active', NULL);
SELECT t.ok(NOT private_sec.team_membership_authorizes('squad', t.id('kid')), 'the old approval no longer counts');
SELECT t.ok(NOT private_sec.messaging_connection(t.id('coach'), t.id('kid')), 'so the team is no longer a messaging context');
SELECT t.as_user(t.id('coach'));
SELECT t.throws(format($q$SELECT public.team_invite_player('squad', %L)$q$, t.id('kid')), 'ALREADY_MEMBER', 'and a new invitation is refused');
SELECT t.reset();

SELECT t.as_user(t.id('newg'));
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_team_reapprovals()'), 1, 'the new guardian sees one membership waiting for approval');
SELECT t.eq((SELECT team_id FROM public.guardian_team_reapprovals()), 'squad', 'on this team');
SELECT t.reset();

-- only a current verified guardian
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('squad', %L)$q$, t.id('kid')), 'NOT_GUARDIAN', 'a stranger cannot re-approve');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_team_reapprovals()'), 0, 'or list anything');
SELECT t.as_user(t.id('oldg'));
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('squad', %L)$q$, t.id('kid')), 'NOT_GUARDIAN', 'nor the former guardian');
SELECT t.as_user(t.id('pendg'));
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('squad', %L)$q$, t.id('kid')), 'NOT_GUARDIAN', 'nor an unverified guardian link');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('squad', %L)$q$, t.id('kid')), 'NOT_GUARDIAN', 'nor the child');
SELECT t.as_user(t.id('coach'));
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('squad', %L)$q$, t.id('kid')), 'NOT_GUARDIAN', 'nor the coach');
SELECT t.as_anon();
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('squad', %L)$q$, t.id('kid')), 'permission denied', 'visitors cannot call it');
SELECT t.reset();
SELECT t.ok(NOT private_sec.messaging_connection(t.id('coach'), t.id('kid')), 'none of those restored the context');

SELECT t.as_user(t.id('newg'));
SELECT t.throws(format($q$SELECT public.guardian_reapprove_team_membership('other', %L)$q$, t.id('kid')), 'NOT_MEMBER', 'a team the child is not on is refused');
SELECT t.eq(public.guardian_reapprove_team_membership('squad', t.id('kid')), 'approved', 'the new verified guardian re-approves in place');
SELECT t.reset();
SELECT t.ok(private_sec.team_membership_authorizes('squad', t.id('kid')), 'the membership counts again');
SELECT t.ok(private_sec.messaging_connection(t.id('coach'), t.id('kid')), 'and the team is a messaging context again');
SELECT t.eq((SELECT guardian_approved_by FROM public.team_invites WHERE team_id = 'squad' AND invitee_id = t.id('kid') AND status = 'accepted'), t.id('newg'),
  'the invitation now carries the new guardian''s approval');
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('kid')), 1, 'the membership itself is unchanged');
SELECT t.ok((SELECT context ->> 'team_id' = 'squad' AND (context ->> 'previous_approver')::uuid = t.id('oldg') FROM public.family_audit_log
              WHERE child_user_id = t.id('kid') AND action = 'team_membership_reapproved' AND actor_user_id = t.id('newg')), 'an audit row records it');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('newg') AND type = 'team_membership_reapproved'), 1, 'the new guardian is notified');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id IN (t.id('oldg'), t.id('pendg')) AND type = 'team_membership_reapproved'), 0,
  'the former and the unverified guardian are not');
SELECT t.as_user(t.id('newg'));
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_team_reapprovals()'), 0, 'nothing is waiting any more');
SELECT t.eq(public.guardian_reapprove_team_membership('squad', t.id('kid')), 'already_approved', 'a second call changes nothing');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE child_user_id = t.id('kid') AND action = 'team_membership_reapproved'), 1, 'and writes no second audit row');

ROLLBACK;
