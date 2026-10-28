-- A coach cannot put a minor on a roster by writing the row. A minor joins through
-- an invite their guardian approves; the coach can still add an adult directly.
BEGIN;

SELECT t.person('coach', 35), t.person('guardian', 41), t.person('adult', 29),
       t.person('teenmid', 14), t.person('teenold', 17), t.person('kidyoung', 10);
SELECT t.guardian('guardian', 'teenmid');
SELECT t.guardian('guardian', 'teenold');
SELECT t.guardian('guardian', 'kidyoung');
SELECT t.team('squad', 'coach');

SELECT t.as_user(t.id('coach'));
SELECT t.lives(format('INSERT INTO public.team_members (team_id, user_id, role) VALUES (%L, %L, ''player'')', 'squad', t.id('adult')),
  'a coach can add an adult directly');
SELECT t.throws(format('INSERT INTO public.team_members (team_id, user_id, role) VALUES (%L, %L, ''player'')', 'squad', t.id('teenmid')),
  'row-level security', 'a coach cannot add a 14 year old by writing the row');
SELECT t.throws(format('INSERT INTO public.team_members (team_id, user_id, role) VALUES (%L, %L, ''player'')', 'squad', t.id('teenold')),
  'row-level security', 'nor a 17 year old');
SELECT t.throws(format('INSERT INTO public.team_members (team_id, user_id, role) VALUES (%L, %L, ''player'')', 'squad', t.id('kidyoung')),
  'row-level security', 'nor a 10 year old');
SELECT t.reset();

SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id IN (t.id('teenmid'), t.id('teenold'), t.id('kidyoung'))), 0,
  'none of the minors is on the team');

-- The invite is the way in, and it still works.
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by)
VALUES (t.id('invite-teen'), 'squad', t.id('teenmid'), t.id('coach'));
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('invite-teen')),
  'a minor still joins through an invite their guardian approves');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('teenmid')), 1,
  'and is then on the team');

ROLLBACK;
