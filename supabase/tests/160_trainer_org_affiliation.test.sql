-- A trainer's facility shows on their public profile, so only the trainer can put
-- it there. An admin used to be able to attach anyone's trainer profile, in a row
-- the trainer could neither see nor remove.
BEGIN;

SELECT t.person('orgowner', 35), t.person('victim', 33), t.person('accomplice', 30), t.person('joiner', 28);
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES
  ('coach-victim',     t.id('victim'),     'coach', 'Famous Coach',  'famous'),
  ('coach-accomplice', t.id('accomplice'), 'coach', 'Other Coach',   'other'),
  ('coach-owner',      t.id('orgowner'),   'coach', 'Gym Owner',     'gymowner'),
  ('coach-joiner',     t.id('joiner'),     'coach', 'Joining Coach', 'joiner');

SELECT t.as_user(t.id('orgowner'));
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org'), t.id('orgowner'), 'Shady Gym', 'shady');
SELECT t.reset();

-- ---- direct adds -----------------------------------------------------------
SELECT t.as_user(t.id('orgowner'));
SELECT t.throws(format('INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role) VALUES (%L, %L, %L, ''member'')',
  t.id('org'), 'coach-victim', t.id('orgowner')),
  'row-level security', 'an admin cannot attach someone else''s trainer profile to their facility');
SELECT t.throws(format('INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role) VALUES (%L, %L, %L, ''member'')',
  t.id('org'), 'coach-victim', t.id('victim')),
  'row-level security', 'nor add another person without their say');
SELECT t.lives(format('INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role) VALUES (%L, %L, %L, ''member'')',
  t.id('org'), 'coach-owner', t.id('orgowner')),
  'an admin can put their own trainer profile on their facility');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.trainer_org_members WHERE trainer_id = 'coach-victim'), 0,
  'the victim''s profile is not on the facility');

-- ---- invites ---------------------------------------------------------------
SELECT t.as_user(t.id('orgowner'));
SELECT t.throws(format('INSERT INTO public.trainer_org_invites (id, org_id, invited_trainer_id, invited_user_id, invited_by) VALUES (%L, %L, %L, %L, %L)',
  t.id('forged'), t.id('org'), 'coach-victim', t.id('accomplice'), t.id('orgowner')),
  'row-level security', 'an invite cannot name one person and another person''s trainer profile');
SELECT t.lives(format('INSERT INTO public.trainer_org_invites (id, org_id, invited_trainer_id, invited_user_id, invited_by) VALUES (%L, %L, %L, %L, %L)',
  t.id('genuine'), t.id('org'), 'coach-joiner', t.id('joiner'), t.id('orgowner')),
  'an invite to a trainer for their own profile is fine');
SELECT t.reset();

-- An invite made before the rule (written without the policy) is refused on acceptance.
INSERT INTO public.trainer_org_invites (id, org_id, invited_trainer_id, invited_user_id, invited_by)
VALUES (t.id('old-forged'), t.id('org'), 'coach-victim', t.id('accomplice'), t.id('orgowner'));
SELECT t.as_user(t.id('accomplice'));
SELECT t.throws(format('SELECT public.accept_trainer_org_invite(%L)', t.id('old-forged')),
  'not yours', 'accepting an invite for someone else''s trainer profile is refused');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.trainer_org_members WHERE trainer_id = 'coach-victim'), 0,
  'and the victim''s profile is still not on the facility');

SELECT t.as_user(t.id('joiner'));
SELECT t.lives(format('SELECT public.accept_trainer_org_invite(%L)', t.id('genuine')),
  'the invited trainer can accept an invite for their own profile');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.trainer_org_members WHERE trainer_id = 'coach-joiner' AND org_id = t.id('org')), 1,
  'and is then on the facility');

-- ---- editing a member ------------------------------------------------------
SELECT t.as_user(t.id('orgowner'));
SELECT t.throws(format('UPDATE public.trainer_org_members SET trainer_id = %L WHERE trainer_id = %L', 'coach-victim', 'coach-joiner'),
  'MEMBER_IDENTITY_LOCKED', 'an admin cannot repoint a member row at another trainer profile');
SELECT t.throws(format('UPDATE public.trainer_org_members SET user_id = %L WHERE trainer_id = %L', t.id('orgowner'), 'coach-joiner'),
  'MEMBER_IDENTITY_LOCKED', 'nor at another person');
SELECT t.lives(format('UPDATE public.trainer_org_members SET role = ''admin'' WHERE trainer_id = %L', 'coach-joiner'),
  'an admin can still change a member''s role');
SELECT t.reset();

-- ---- the trainer can still ask to join and be approved ---------------------
SELECT t.as_user(t.id('victim'));
SELECT t.lives(format('INSERT INTO public.trainer_org_join_requests (id, org_id, trainer_id, requested_by) VALUES (%L, %L, %L, %L)',
  t.id('ask'), t.id('org'), 'coach-victim', t.id('victim')),
  'a trainer can ask to join a facility');
SELECT t.as_user(t.id('orgowner'));
SELECT t.lives(format('SELECT public.approve_trainer_org_join(%L)', t.id('ask')), 'and the facility approves it');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.trainer_org_members WHERE trainer_id = 'coach-victim' AND user_id = t.id('victim')), 1,
  'the trainer is then on the facility, as themselves');

ROLLBACK;
