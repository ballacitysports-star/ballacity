-- Following: posts from people, teams and facilities you follow (or teams you belong to), and team news, as the
-- posts and team_posts rules allow.
BEGIN;

SELECT t.person('reader', 30), t.person('followed', 31), t.person('other', 32),
       t.person('teenfollowed', 17), t.person('mom', 44), t.person('blockedfollowed', 33);
SELECT t.guardian('mom', 'teenfollowed');

SELECT t.as_service();
INSERT INTO public.follows (follower_id, followee_id) VALUES
  (t.id('reader'), t.id('followed')),
  (t.id('reader'), t.id('teenfollowed')),
  (t.id('reader'), t.id('blockedfollowed'));
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blockedfollowed'), t.id('reader'));
INSERT INTO public.posts (id, author_id, audience, body, moderation_status, created_at) VALUES
  (t.id('f-public'),   t.id('followed'), 'public',    'Public from followed',    'approved', now() - interval '3 hours'),
  (t.id('f-fol'),      t.id('followed'), 'followers', 'Followers from followed', 'approved', now() - interval '2 hours'),
  (t.id('f-family'),   t.id('followed'), 'family',    'Family from followed',    'approved', now() - interval '1 hour'),
  (t.id('f-pending'),  t.id('followed'), 'public',    'Pending from followed',   'pending',  now()),
  (t.id('o-public'),   t.id('other'),    'public',    'Public from someone else','approved', now()),
  (t.id('t-fol'),      t.id('teenfollowed'), 'followers', 'Teen to followers',   'approved', now() - interval '30 minutes'),
  (t.id('b-public'),   t.id('blockedfollowed'), 'public', 'Across a block',      'approved', now());
SELECT t.reset();

SELECT t.as_user(t.id('reader'));
SELECT t.eq((SELECT string_agg(body, ' | ' ORDER BY created_at DESC) FROM public.following_feed()),
  'Teen to followers | Followers from followed | Public from followed',
  'only approved posts from followed accounts that the reader may see, newest first');
SELECT t.eq((SELECT count(*)::int FROM public.following_feed(now() - interval '90 minutes')), 2, 'paging by time returns older posts');
SELECT t.eq((SELECT count(*)::int FROM public.following_feed(NULL, 1)), 1, 'the page size is honoured');

SELECT t.as_user(t.id('other'));
SELECT t.eq((SELECT count(*)::int FROM public.following_feed()), 0, 'someone who follows nobody gets an empty feed');

SELECT t.as_anon();
SELECT t.throws($$SELECT * FROM public.following_feed()$$, 'permission denied', 'a signed-out visitor cannot call it');
SELECT t.reset();


-- ---- teams and facilities you follow or belong to (F2) -----------------------------------------
SELECT t.person('coach', 40), t.person('gymowner', 45), t.person('member', 25);
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('ff-team', t.id('coach'), 'team', 'FF Team', 'ff-team', ARRAY['adult']),
       ('ff-other', t.id('coach'), 'team', 'Other Team', 'ff-other', ARRAY['adult']);
SELECT t.member('ff-team', 'member', 'player');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('ff-gym'), t.id('gymowner'), 'FF Gym', 'ff-gym');
SELECT t.as_service();
INSERT INTO public.posts (id, author_id, posted_as, team_id, org_id, audience, body, moderation_status, created_at) VALUES
  (t.id('tp-public'), t.id('coach'), 'team', 'ff-team', NULL, 'public', 'Team public post', 'approved', now() - interval '10 minutes'),
  (t.id('tp-team'),   t.id('coach'), 'team', 'ff-team', NULL, 'team', 'Team members only', 'approved', now() - interval '9 minutes'),
  (t.id('op-public'), t.id('coach'), 'team', 'ff-other', NULL, 'public', 'Other team post', 'approved', now() - interval '8 minutes'),
  (t.id('gp-fol'),    t.id('gymowner'), 'org', NULL, t.id('ff-gym'), 'followers', 'Gym followers post', 'approved', now() - interval '7 minutes');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status, created_at) VALUES
  (t.id('n-ann'),  'ff-team',  t.id('coach'), 'announcement', 'Season opener', 'See you Saturday', 'approved', now() - interval '6 minutes'),
  (t.id('n-rec'),  'ff-team',  t.id('coach'), 'recap', 'Won 3-1', 'Great game', 'approved', now() - interval '5 minutes'),
  (t.id('n-pend'), 'ff-team',  t.id('coach'), 'announcement', 'Pending news', 'not yet', 'pending', now() - interval '4 minutes'),
  (t.id('n-try'),  'ff-team',  t.id('coach'), 'tryout', 'A tryout', 'not news', 'approved', now() - interval '3 minutes'),
  (t.id('n-other'),'ff-other', t.id('coach'), 'announcement', 'Other team news', 'x', 'approved', now() - interval '2 minutes');
SELECT t.reset();

SELECT t.as_user(t.id('other'));
SELECT public.follow_entity('team', 'ff-team');
SELECT public.follow_entity('org', t.id('ff-gym')::text);
SELECT t.eq((SELECT string_agg(body, ' | ' ORDER BY created_at DESC) FROM public.following_feed() WHERE posted_as <> 'person'),
  'Gym followers post | Team public post',
  'a follower gets the followed team''s public post and the followed facility''s followers post, not members-only or other teams''');
SELECT t.eq((SELECT string_agg(title, ' | ' ORDER BY created_at DESC) FROM public.following_team_news()),
  'Won 3-1 | Season opener', 'team news: approved announcements and recaps of followed teams only (no pending, no tryouts, no other teams)');

SELECT t.as_user(t.id('member'));
SELECT t.eq((SELECT string_agg(body, ' | ' ORDER BY created_at DESC) FROM public.following_feed() WHERE posted_as = 'team'),
  'Team members only | Team public post', 'a member gets their team''s posts, including members-only, without following it');
SELECT t.eq((SELECT count(*)::int FROM public.following_team_news()), 2, 'and their team''s news');

SELECT t.as_user(t.id('reader'));
SELECT t.eq((SELECT count(*)::int FROM public.following_team_news()), 0, 'someone who neither follows nor belongs gets no team news');
SELECT t.as_anon();
SELECT t.throws($$SELECT * FROM public.following_team_news()$$, 'permission denied', 'a signed-out visitor cannot call it');
SELECT t.reset();

ROLLBACK;
