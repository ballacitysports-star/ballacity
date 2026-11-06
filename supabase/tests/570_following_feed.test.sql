-- The Following feed: posts from people you follow, as the posts table's rules allow.
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

ROLLBACK;
