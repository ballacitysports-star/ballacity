-- Migration 20261106170000: a block stops follow requests in both directions and clears pending ones; whoever can
-- answer a new request (the account, or a minor's guardian) is told about it once.
BEGIN;
SELECT t.person('alice', 30), t.person('bob', 31), t.person('carol', 32), t.person('dave', 33),
       t.person('teenmid', 14), t.person('teenold', 16), t.person('parent', 42), t.person('eve', 29);
SELECT t.guardian('parent', 'teenmid');
-- Adults who review their followers.
UPDATE public.privacy_preferences SET require_follow_approval = true
 WHERE user_id IN (t.id('alice'), t.id('carol'), t.id('dave'));

-- ============================================================ blocks
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('alice'), t.id('bob'));

SELECT t.as_user(t.id('bob'));
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('alice')),
  'FOLLOW_BLOCKED', 'someone who was blocked cannot ask to follow the person who blocked them');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('bob')), 0,
  'and no request was written');

SELECT t.as_user(t.id('alice'));
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('bob')),
  'FOLLOW_BLOCKED', 'nor can the person who blocked them, while the block stands');
SELECT t.reset();

-- An account that does not review followers: the direct follow is refused by the same check.
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('eve'), t.id('bob'));
SELECT t.as_user(t.id('bob'));
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('eve')),
  'FOLLOW_BLOCKED', 'a direct follow across a block is refused too');
SELECT t.reset();

-- A pending request disappears when either side blocks.
SELECT t.as_user(t.id('dave'));
SELECT t.eq(public.request_follow(t.id('carol')), 'requested', 'setup: dave asks to follow carol');
SELECT t.reset();
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('carol'), t.id('dave'));
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('dave') AND target_id = t.id('carol')), 0,
  'blocking clears the pending request');

-- ============================================================ notifications
SELECT t.as_user(t.id('bob'));
SELECT t.eq(public.request_follow(t.id('carol')), 'requested', 'bob asks to follow carol');
SELECT t.eq(public.request_follow(t.id('carol')), 'requested', 'and asks again');
SELECT t.reset();
-- (carol was also told about dave's earlier request, before the block cleared it; count bob's only)
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('carol') AND type = 'follow_request'
              AND title = 'Bob asked to follow you'), 1,
  'an adult who reviews followers is told once, however often the request is repeated');
SELECT t.eq((SELECT link FROM public.notifications WHERE user_id = t.id('carol') AND type = 'follow_request'
              AND title = 'Bob asked to follow you'), '/account/follow-requests',
  'and is sent to their follow requests');

SELECT t.as_user(t.id('eve'));
SELECT t.eq(public.request_follow(t.id('teenmid')), 'requested', 'an adult asks to follow a 14 year old');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('parent') AND type = 'follow_request'), 1,
  'under 16, the guardian who answers is told');
SELECT t.eq((SELECT link FROM public.notifications WHERE user_id = t.id('parent') AND type = 'follow_request'), '/parent',
  'and is sent to the Parent Center');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('teenmid') AND type = 'follow_request'), 0,
  'the 14 year old, who cannot answer it, is not');

SELECT t.as_user(t.id('eve'));
SELECT t.eq(public.request_follow(t.id('teenold')), 'requested', 'an adult asks to follow a 16 year old');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('teenold') AND type = 'follow_request'), 1,
  'a 16 year old, who answers their own requests, is told');

SELECT t.ok(NOT has_function_privilege('authenticated', 'public.notify_on_follow_request()', 'EXECUTE'),
  'the notification trigger function is not callable through the API');
ROLLBACK;
