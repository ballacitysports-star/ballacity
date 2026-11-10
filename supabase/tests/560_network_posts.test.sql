-- Network posts: who may post as what, to which audience, and who can read it.
BEGIN;

SELECT t.person('poster', 30), t.person('fan', 28), t.person('stranger', 29), t.person('blocker', 31),
       t.person('coach', 40), t.person('gymowner', 45), t.person('mom', 42),
       t.person('teen15', 14), t.person('teen17', 17), t.person('kid', 11), t.person('locked', 14);
SELECT t.guardian('mom', 'teen15');
SELECT t.guardian('mom', 'teen17');
SELECT t.guardian('mom', 'kid');

SELECT t.team('pt-team', 'coach');
SELECT t.member('pt-team', 'teen15');
SELECT t.member('pt-team', 'teen17');
SELECT t.member('pt-team', 'poster');
SELECT t.as_service();
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('gym'), t.id('gymowner'), 'Post Gym', 'post-gym');
INSERT INTO public.follows (follower_id, followee_id) VALUES (t.id('fan'), t.id('poster'));
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('poster'));
SELECT t.reset();

-- Approves every pending post, as the server's moderation step does.
CREATE FUNCTION pg_temp.approve_all() RETURNS void LANGUAGE sql AS
  $$ UPDATE public.posts SET moderation_status = 'approved' WHERE moderation_status = 'pending' $$;

-- ---------------------------------------------------------------- an adult's audiences
SELECT t.as_user(t.id('poster'));
INSERT INTO public.posts (id, author_id, audience, body) VALUES
  (t.id('p-public'), t.id('poster'), 'public', 'Open run Saturday'),
  (t.id('p-followers'), t.id('poster'), 'followers', 'Training diary'),
  (t.id('p-family'), t.id('poster'), 'family', 'Family only');
SELECT t.eq((SELECT moderation_status FROM public.posts WHERE id = t.id('p-public')), 'pending', 'a new post starts pending');
SELECT t.throws(format('UPDATE public.posts SET moderation_status = ''approved'' WHERE id = %L', t.id('p-public')),
  'permission denied', 'an author cannot approve their own post');

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.posts'), 0, 'nobody else sees a pending post');

SELECT t.as_service(); SELECT pg_temp.approve_all(); SELECT t.reset();

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.posts'), 1, 'a signed-out visitor sees only the public post');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.posts'), 1, 'a stranger sees only the public post');
SELECT t.as_user(t.id('fan'));
SELECT t.eq(t.count('SELECT 1 FROM public.posts'), 2, 'a follower also sees the followers post');
SELECT t.as_user(t.id('blocker'));
SELECT t.eq(t.count('SELECT 1 FROM public.posts'), 0, 'someone with a block sees none of the author''s posts');
SELECT t.as_user(t.id('poster'));
SELECT t.eq(t.count('SELECT 1 FROM public.posts'), 3, 'the author sees all their posts');

-- ---------------------------------------------------------------- minors
SELECT t.as_user(t.id('teen15'));
SELECT t.throws($$INSERT INTO public.posts (author_id, audience, body) VALUES (auth.uid(), 'public', 'hi')$$,
  'POST_AUDIENCE_NOT_ALLOWED', 'a 13-15 cannot post publicly');
SELECT t.throws($$INSERT INTO public.posts (author_id, audience, body) VALUES (auth.uid(), 'followers', 'hi')$$,
  'POST_AUDIENCE_NOT_ALLOWED', 'or to followers');
SELECT t.lives($$INSERT INTO public.posts (id, author_id, audience, team_id, body) VALUES (t.id('p-teen-team'), auth.uid(), 'team', 'pt-team', 'Good practice')$$,
  'a 13-15 can post to their team');
SELECT t.lives($$INSERT INTO public.posts (id, author_id, audience, body) VALUES (t.id('p-teen-family'), auth.uid(), 'family', 'Home soon')$$,
  'and to their family');
SELECT t.throws($$INSERT INTO public.posts (author_id, audience, body) VALUES (auth.uid(), 'team', 'hi')$$,
  'POST_TARGET_INVALID', 'a team post needs a team');

SELECT t.as_user(t.id('teen17'));
SELECT t.throws($$INSERT INTO public.posts (author_id, audience, body) VALUES (auth.uid(), 'public', 'hi')$$,
  'POST_AUDIENCE_NOT_ALLOWED', 'a 16-17 cannot post publicly');
SELECT t.lives($$INSERT INTO public.posts (id, author_id, audience, body) VALUES (t.id('p-teen17'), auth.uid(), 'followers', 'New PB')$$,
  'a 16-17 can post to followers');
SELECT t.throws(format('UPDATE public.posts SET audience = ''public'' WHERE id = %L', t.id('p-teen17')),
  'POST_AUDIENCE_NOT_ALLOWED', 'an edit cannot widen a minor''s audience');

SELECT t.as_user(t.id('kid'));
SELECT t.throws($$INSERT INTO public.posts (author_id, audience, body) VALUES (auth.uid(), 'family', 'hi')$$,
  'POST_AGE_NOT_ALLOWED', 'an under-13 cannot post');
SELECT t.as_user(t.id('locked'));
SELECT t.throws($$INSERT INTO public.posts (author_id, audience, body) VALUES (auth.uid(), 'family', 'hi')$$,
  'POST_LOCKED', 'an account waiting for a parent cannot post');

SELECT t.as_service(); SELECT pg_temp.approve_all(); SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-teen-team'))), 1, 'the team''s coach sees a teen''s team post');
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-teen-family'))), 0, 'but not their family post');
SELECT t.as_user(t.id('mom'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-teen-family'))), 1, 'a guardian sees their child''s family post');
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-teen-team'))), 0, 'a guardian outside the team does not see the team post');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE author_id IN (%L, %L)', t.id('teen15'), t.id('teen17'))), 0,
  'a stranger sees no minor''s posts');

-- ---------------------------------------------------------------- posting as a team or facility
SELECT t.as_user(t.id('coach'));
SELECT t.lives($$INSERT INTO public.posts (id, author_id, posted_as, team_id, audience, body) VALUES (t.id('p-as-team'), auth.uid(), 'team', 'pt-team', 'public', 'We are hiring a coach')$$,
  'a team''s manager posts for the team');
SELECT t.lives($$INSERT INTO public.posts (id, author_id, posted_as, team_id, audience, body) VALUES (t.id('p-team-followers'), auth.uid(), 'team', 'pt-team', 'followers', 'Practice moved to 6pm')$$,
  'a team post can target the team''s followers (entity follows)');
SELECT t.throws($$INSERT INTO public.posts (author_id, posted_as, team_id, audience, body) VALUES (auth.uid(), 'team', 'pt-team', 'family', 'x')$$,
  'POST_AUDIENCE_NOT_ALLOWED', 'but not family, a person''s audience');
SELECT t.as_user(t.id('poster'));
SELECT t.throws($$INSERT INTO public.posts (author_id, posted_as, team_id, audience, body) VALUES (auth.uid(), 'team', 'pt-team', 'public', 'x')$$,
  'POST_TARGET_INVALID', 'a member who is not a manager cannot post for the team');
SELECT t.throws($$INSERT INTO public.posts (author_id, posted_as, org_id, audience, body) VALUES (auth.uid(), 'org', t.id('gym'), 'public', 'x')$$,
  'POST_TARGET_INVALID', 'only the facility''s owner or admin posts for it');
SELECT t.as_user(t.id('gymowner'));
SELECT t.lives($$INSERT INTO public.posts (id, author_id, posted_as, org_id, audience, body) VALUES (t.id('p-as-gym'), auth.uid(), 'org', t.id('gym'), 'public', 'New courts open')$$,
  'a facility''s owner posts for it');
SELECT t.lives($$INSERT INTO public.posts (id, author_id, posted_as, org_id, audience, body) VALUES (t.id('p-gym-followers'), auth.uid(), 'org', t.id('gym'), 'followers', 'Members night Friday')$$,
  'a facility can post to its followers');
SELECT t.throws($$INSERT INTO public.posts (author_id, posted_as, org_id, audience, body) VALUES (auth.uid(), 'org', t.id('gym'), 'family', 'x')$$,
  'POST_AUDIENCE_NOT_ALLOWED', 'a facility posts publicly or to its followers only');
SELECT t.throws(format('UPDATE public.posts SET org_id = NULL, posted_as = ''person'' WHERE id = %L', t.id('p-as-gym')),
  'permission denied', 'a member cannot change who a post is from');
SELECT t.as_service();
SELECT t.throws(format('UPDATE public.posts SET author_id = %L WHERE id = %L', t.id('poster'), t.id('p-as-gym')),
  'POST_OWNER_FIXED', 'not even server code can change who a post is from');
SELECT t.reset();

-- Followers of a team or facility (entity follows, #317) read its followers posts; nobody else does.
SELECT t.as_service(); SELECT pg_temp.approve_all(); SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT public.follow_entity('team', 'pt-team');
SELECT public.follow_entity('org', t.id('gym')::text);
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id IN (%L, %L)', t.id('p-team-followers'), t.id('p-gym-followers'))), 2,
  'someone who follows the team and the facility reads their followers posts');
SELECT t.as_user(t.id('mom'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id IN (%L, %L)', t.id('p-team-followers'), t.id('p-gym-followers'))), 0,
  'someone who follows neither does not');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id IN (%L, %L)', t.id('p-team-followers'), t.id('p-gym-followers'))), 0,
  'nor does a signed-out visitor');
SELECT t.reset();

SELECT t.as_service(); SELECT pg_temp.approve_all(); UPDATE public.teams SET hidden_at = now() WHERE id = 'pt-team'; SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-as-team'))), 0, 'a hidden team''s posts are hidden');
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-as-gym'))), 1, 'a facility''s public post is public');

-- ---------------------------------------------------------------- deleting
SELECT t.as_user(t.id('poster'));
SELECT t.lives(format('UPDATE public.posts SET deleted_at = now() WHERE id = %L', t.id('p-public')), 'the author soft-deletes a post');
SELECT t.throws(format('UPDATE public.posts SET deleted_at = NULL WHERE id = %L', t.id('p-public')), 'POST_DELETED', 'a deleted post stays deleted');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.posts WHERE id = %L', t.id('p-public'))), 0, 'a deleted post is gone for others');
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.changed(format('DELETE FROM public.posts WHERE id = %L', t.id('p-teen-team'))), 1, 'a team manager can remove a post made to their team');
SELECT t.eq(t.changed(format('DELETE FROM public.posts WHERE id = %L', t.id('p-followers'))), 0, 'but not someone''s other posts');

-- ---------------------------------------------------------------- the flag
SELECT t.as_anon();
SELECT t.eq((SELECT value->>'enabled' FROM public.app_settings WHERE key = 'network_posts'), 'false', 'posts ship switched off');
SELECT t.reset();

ROLLBACK;
