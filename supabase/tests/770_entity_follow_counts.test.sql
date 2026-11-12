-- P1-1: follower counts for a list of teams, trainers or facilities in one call (entity_follow_counts), with the same
-- rule as entity_follow_state: counts only, never who; nothing for an entity the caller cannot see; signed in only.
BEGIN;

SELECT t.person('owner', 35), t.person('fan1', 30), t.person('fan2', 31), t.person('teenfan', 15),
       t.person('guardian', 42), t.person('viewer', 29);
SELECT t.guardian('guardian', 'teenfan');

SELECT t.as_service();
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES
  ('fc-team', t.id('owner'), 'team', 'Count FC', 'count-fc'),
  ('fc-coach', t.id('owner'), 'coach', 'Coach Count', 'coach-count'),
  ('fc-quiet', t.id('owner'), 'team', 'Quiet FC', 'quiet-fc'),
  ('fc-hidden', t.id('owner'), 'team', 'Hidden FC', 'hidden-fc');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('gym'), t.id('owner'), 'Count Gym', 'count-gym');
SELECT t.reset();

SELECT t.as_user(t.id('fan1'));
SELECT public.follow_entity('team', 'fc-team'), public.follow_entity('team', 'fc-coach'),
       public.follow_entity('team', 'fc-hidden'), public.follow_entity('org', t.id('gym')::text);
SELECT t.as_user(t.id('fan2'));
SELECT public.follow_entity('team', 'fc-team');
SELECT t.as_user(t.id('teenfan'));
SELECT public.follow_entity('team', 'fc-team');
SELECT t.reset();
UPDATE public.teams SET hidden_at = now() WHERE id = 'fc-hidden';

-- ---------------------------------------------------------------- counts for a list, matching the single-entity read
SELECT t.as_user(t.id('viewer'));
SELECT t.eq((SELECT followers FROM public.entity_follow_counts('team', ARRAY['fc-team', 'fc-coach', 'fc-quiet']) WHERE id = 'fc-team'),
  3, 'three people follow the team, a minor among them');
SELECT t.eq((SELECT followers FROM public.entity_follow_state('team', 'fc-team')),
  (SELECT followers FROM public.entity_follow_counts('team', ARRAY['fc-team']) WHERE id = 'fc-team'),
  'the list count equals the single-entity count');
SELECT t.eq((SELECT followers FROM public.entity_follow_counts('team', ARRAY['fc-team', 'fc-coach', 'fc-quiet']) WHERE id = 'fc-coach'),
  1, 'a trainer listing has its own count');
SELECT t.eq((SELECT followers FROM public.entity_follow_counts('team', ARRAY['fc-team', 'fc-coach', 'fc-quiet']) WHERE id = 'fc-quiet'),
  0, 'an entity nobody follows comes back with 0, not missing');
SELECT t.eq((SELECT followers FROM public.entity_follow_counts('org', ARRAY[t.id('gym')::text])), 1, 'facilities are counted too');
SELECT t.eq((SELECT bool_or(following) FROM public.entity_follow_counts('team', ARRAY['fc-team'])), false,
  'the viewer does not follow the team');
SELECT t.as_user(t.id('fan1'));
SELECT t.eq((SELECT following FROM public.entity_follow_counts('team', ARRAY['fc-team']) WHERE id = 'fc-team'), true,
  'a follower sees that they follow');

-- ---------------------------------------------------------------- what is left out
SELECT t.as_user(t.id('viewer'));
SELECT t.eq((SELECT count(*)::int FROM public.entity_follow_counts('team', ARRAY['fc-hidden', 'no-such-team'])), 0,
  'a hidden or missing entity returns nothing');
SELECT t.as_user(t.id('owner'));
SELECT t.eq((SELECT followers FROM public.entity_follow_counts('team', ARRAY['fc-hidden']) WHERE id = 'fc-hidden'), 1,
  'the owner still sees their hidden team''s count');
SELECT t.as_user(t.id('viewer'));
SELECT t.eq((SELECT count(*)::int FROM public.entity_follow_counts('person', ARRAY['fc-team'])), 0, 'an unknown kind returns nothing');
SELECT t.eq((SELECT count(*)::int FROM public.entity_follow_counts('org', ARRAY['not-a-uuid'])), 0,
  'a malformed facility id returns nothing, not an error');
SELECT t.eq((SELECT count(*)::int FROM public.entity_follow_counts('team', ARRAY['fc-team', 'fc-team', NULL])), 1,
  'duplicates and nulls collapse to one row per entity');
SELECT t.eq((SELECT count(*)::int FROM public.entity_follow_counts('team',
             array_cat(ARRAY(SELECT 'pad-' || g FROM generate_series(1, 200) g), ARRAY['fc-team']))), 0,
  'only the first 200 ids are read');
SELECT t.eq((SELECT count(*)::int FROM public.entity_follow_counts('team', NULL)), 0, 'no ids, no rows');

-- ---------------------------------------------------------------- never who, and not for visitors
SELECT t.eq(t.count($$SELECT 1 FROM public.entity_follows WHERE target_id = 'fc-team'$$), 0,
  'the viewer still cannot read who follows the team');
SELECT t.as_anon();
SELECT t.throws($$SELECT * FROM public.entity_follow_counts('team', ARRAY['fc-team'])$$, 'permission denied',
  'signed-out visitors cannot call it');
SELECT t.reset();

ROLLBACK;
