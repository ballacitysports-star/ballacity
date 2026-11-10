-- Entity follows: following a team, trainer or facility.
--
-- Only follow_entity / unfollow_entity write the table. No approval is needed. The entity
-- must be visible and claimed. A consent-locked account cannot follow. A block with the
-- owner refuses the follow and removes existing ones. Who follows is private: the follower
-- and their guardian read the row, and the owner sees only a count.
BEGIN;

SELECT t.person('owner', 35), t.person('adultfan', 30), t.person('teenfan', 14),
       t.person('guardian', 42), t.person('kidlocked', 11), t.person('stranger', 29),
       t.person('blocker', 33);
SELECT t.guardian('guardian', 'teenfan');

SELECT t.as_service();
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES
  ('ef-team', t.id('owner'), 'team', 'Follow FC', 'follow-fc'),
  ('ef-coach', t.id('owner'), 'coach', 'Coach Follow', 'coach-follow'),
  ('ef-unclaimed', NULL, 'team', 'Nobody FC', 'nobody-fc'),
  ('ef-hidden', t.id('owner'), 'team', 'Hidden FC', 'hidden-fc'),
  ('ef-blockers', t.id('blocker'), 'team', 'Blocker FC', 'blocker-fc');
UPDATE public.teams SET hidden_at = now() WHERE id = 'ef-hidden';
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('gym'), t.id('owner'), 'Follow Gym', 'follow-gym');
SELECT t.reset();

-- ---------------------------------------------------------------- nobody writes directly
SELECT t.as_user(t.id('adultfan'));
SELECT t.throws(format('INSERT INTO public.entity_follows (follower_id, target_kind, target_id) VALUES (%L, ''team'', ''ef-team'')', t.id('adultfan')),
  'permission denied', 'a member cannot insert an entity follow directly');

-- ---------------------------------------------------------------- following
SELECT t.eq(public.follow_entity('team', 'ef-team'), 'following', 'an adult follows a team');
SELECT t.eq(public.follow_entity('team', 'ef-team'), 'following', 'following again is a no-op');
SELECT t.eq(public.follow_entity('team', 'ef-coach'), 'following', 'an adult follows a trainer');
SELECT t.eq(public.follow_entity('org', t.id('gym')::text), 'following', 'an adult follows a facility');
SELECT t.eq(t.count('SELECT 1 FROM public.entity_follows'), 3, 'the follower sees their own entity follows');

SELECT t.throws($$SELECT public.follow_entity('team', 'ef-unclaimed')$$, 'INVALID_FOLLOW_TARGET', 'an unclaimed listing cannot be followed');
SELECT t.throws($$SELECT public.follow_entity('team', 'ef-hidden')$$, 'INVALID_FOLLOW_TARGET', 'a hidden team cannot be followed');
SELECT t.throws($$SELECT public.follow_entity('team', 'no-such-team')$$, 'INVALID_FOLLOW_TARGET', 'a missing team cannot be followed');
SELECT t.throws($$SELECT public.follow_entity('org', 'not-a-uuid')$$, 'INVALID_FOLLOW_TARGET', 'a malformed org id is refused, not an error');
SELECT t.throws($$SELECT public.follow_entity('user', 'ef-team')$$, 'INVALID_FOLLOW_TARGET', 'an unknown kind is refused');

SELECT t.as_user(t.id('owner'));
SELECT t.throws($$SELECT public.follow_entity('team', 'ef-team')$$, 'INVALID_FOLLOW_TARGET', 'an owner cannot follow their own team');

-- A teen needs no guardian approval to follow a team.
SELECT t.as_user(t.id('teenfan'));
SELECT t.eq(public.follow_entity('team', 'ef-team'), 'following', 'a teen with an approved account follows a team directly');
SELECT t.eq(t.count('SELECT 1 FROM public.follow_requests'), 0, 'no follow request is created for an entity');

-- A consent-locked child cannot.
SELECT t.as_user(t.id('kidlocked'));
SELECT t.throws($$SELECT public.follow_entity('team', 'ef-team')$$, 'FOLLOW_LOCKED', 'an account waiting for a parent cannot follow');

-- Signed out.
SELECT t.as_anon();
SELECT t.throws($$SELECT public.follow_entity('team', 'ef-team')$$, 'permission denied', 'an anonymous visitor cannot call follow_entity');
SELECT t.throws($$SELECT * FROM public.entity_follow_state('team', 'ef-team')$$, 'permission denied', 'an anonymous visitor cannot call entity_follow_state');
SELECT t.eq(t.count('SELECT 1 FROM public.entity_follows'), 0, 'an anonymous visitor reads no entity follows');

-- ---------------------------------------------------------------- who can see
SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count('SELECT 1 FROM public.entity_follows'), 0, 'the owner cannot list who follows their team');
SELECT t.eq((SELECT followers FROM public.entity_follow_state('team', 'ef-team')), 2, 'the owner sees the follower count');
SELECT t.eq((SELECT following FROM public.entity_follow_state('team', 'ef-team')), false, 'the owner is not a follower');

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.entity_follows'), 0, 'a stranger sees no one''s entity follows');
SELECT t.eq((SELECT followers FROM public.entity_follow_state('team', 'ef-team')), 2, 'a stranger sees the count');
SELECT t.eq(t.count($$SELECT 1 FROM public.entity_follow_state('team', 'ef-hidden')$$), 0, 'no state for a hidden team');

SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.entity_follows WHERE follower_id = %L', t.id('teenfan'))), 1,
  'a guardian sees what their child follows');

SELECT t.as_user(t.id('adultfan'));
SELECT t.eq((SELECT following FROM public.entity_follow_state('team', 'ef-team')), true, 'the follower sees they follow');

-- ---------------------------------------------------------------- unfollowing
SELECT public.unfollow_entity('team', 'ef-coach');
SELECT t.eq(t.count($$SELECT 1 FROM public.entity_follows WHERE target_id = 'ef-coach'$$), 0, 'unfollow removes the follow');

-- ---------------------------------------------------------------- blocks
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.follow_entity('team', 'ef-blockers'), 'following', 'a stranger follows the blocker''s team');
SELECT t.as_service();
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('stranger'));
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count($$SELECT 1 FROM public.entity_follows WHERE target_id = 'ef-blockers'$$), 0, 'blocking removes the blocked person''s follow of the blocker''s team');
SELECT t.throws($$SELECT public.follow_entity('team', 'ef-blockers')$$, 'FOLLOW_BLOCKED', 'a blocked person cannot follow the blocker''s team');

-- The other direction: the owner blocks nobody, but a follower blocks the owner.
SELECT t.as_service();
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('adultfan'), t.id('owner'));
SELECT t.reset();
SELECT t.as_user(t.id('adultfan'));
SELECT t.eq(t.count('SELECT 1 FROM public.entity_follows'), 0, 'blocking an owner drops your follows of their team and facility');
SELECT t.throws($$SELECT public.follow_entity('team', 'ef-team')$$, 'FOLLOW_BLOCKED', 'and you cannot follow them again while the block stands');

-- ---------------------------------------------------------------- deletion
SELECT t.as_service();
DELETE FROM public.teams WHERE id = 'ef-team';
SELECT t.eq(t.count($$SELECT 1 FROM public.entity_follows WHERE target_kind = 'team' AND target_id = 'ef-team'$$), 0,
  'deleting a team removes its follows');
SELECT t.reset();

ROLLBACK;
