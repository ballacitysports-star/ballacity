-- What an anonymous visitor can read from `teams`: a short list of public
-- columns, and only the rows of teams that are not hidden and do not work with
-- under-18s. Signed-in people keep the wider read they had before.
BEGIN;

SELECT t.person('owner', 35), t.person('member', 28), t.person('other', 30);

SELECT t.team('adultfc', 'owner');
SELECT t.team('kidsfc', 'owner');
SELECT t.team('teenfc', 'owner');
SELECT t.team('hiddenfc', 'owner');
SELECT t.member('adultfc', 'member');
UPDATE public.teams SET age_groups = ARRAY['adult'] WHERE id = 'adultfc';
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'kidsfc';
UPDATE public.teams SET age_groups = ARRAY['adult', 'teen'] WHERE id = 'teenfc';
UPDATE public.teams SET hidden_at = now() WHERE id = 'hiddenfc';

-- Anonymous visitors
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''adultfc'''), 1, 'a visitor sees an ordinary team');
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''kidsfc'''), 0, 'but not a youth team');
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''teenfc'''), 0, 'nor a team that also works with teens');
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hiddenfc'''), 0, 'nor a hidden team');

SELECT t.lives(
  'SELECT id, name, city, sports, kind, tagline, age_groups, hidden_at, updated_at, handle, bio, verified, founded, positions_needed FROM public.teams',
  'a visitor can read the public columns');
SELECT t.throws('SELECT * FROM public.teams', 'permission denied', 'a visitor cannot select every column');
SELECT t.throws('SELECT owner_id FROM public.teams', 'permission denied', 'a visitor cannot read who owns a team');
SELECT t.throws('SELECT listed_by FROM public.teams', 'permission denied', 'nor who listed it');
SELECT t.throws('SELECT staff FROM public.teams', 'permission denied', 'nor its staff');
SELECT t.throws('SELECT refund_rule FROM public.teams', 'permission denied', 'nor its refund rules');

-- A team's posts and roster follow the team: a visitor still gets none of a youth team's.
SELECT t.reset();
INSERT INTO public.team_members (team_id, user_id, role) VALUES ('kidsfc', t.id('member'), 'player')
  ON CONFLICT (team_id, user_id) DO NOTHING;
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.team_members WHERE team_id = ''kidsfc'''), 0, 'a visitor sees no roster of a youth team');
SELECT t.reset();

-- Signed-in people
SELECT t.as_user(t.id('other'));
SELECT t.eq(t.count('SELECT owner_id FROM public.teams WHERE id = ''adultfc'''), 1, 'a signed-in user still reads every column of a team');
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''kidsfc'''), 1, 'and a youth team, which their families look for');
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hiddenfc'''), 0, 'but not a hidden team they do not manage');
SELECT t.reset();

SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count('SELECT 1 FROM public.teams WHERE id = ''hiddenfc'''), 1, 'the owner still sees their own hidden team');
SELECT t.reset();

ROLLBACK;
