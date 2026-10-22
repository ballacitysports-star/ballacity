-- Private accounts: following an account that needs approval waits for approval.
--
-- `follows` holds approved followers; `follow_requests` holds the waiting ones.
-- Nobody writes either table directly: request_follow, respond_follow_request,
-- remove_follower and cancel_follow_request decide, using who is calling.
--   * An adult chooses whether to approve followers; every minor always does.
--   * An account answers its own requests, except under 16, where only a verified
--     guardian can. A guardian can answer for any minor.
BEGIN;

SELECT t.person('openadult', 30), t.person('privateadult', 31), t.person('fan', 28),
       t.person('stranger', 29), t.person('guardian', 41), t.person('otherparent', 40),
       t.person('teenyoung', 14), t.person('teenold', 17), t.person('kidlocked', 11),
       t.person('kidok', 11), t.person('teenrowless', 15);
SELECT t.guardian('guardian', 'teenyoung');
SELECT t.guardian('guardian', 'teenold');
SELECT t.guardian('guardian', 'kidok');

-- An adult who turns approval on.
UPDATE public.privacy_preferences SET require_follow_approval = true WHERE user_id = t.id('privateadult');

-- ---------------------------------------------------------------------------
-- Who needs approval
-- ---------------------------------------------------------------------------
SELECT t.eq(public.follow_approval_required(t.id('openadult')), false, 'an adult is open by default');
SELECT t.eq(public.follow_approval_required(t.id('privateadult')), true, 'an adult who turns it on needs approval');
SELECT t.eq(public.follow_approval_required(t.id('teenold')), true, 'a 16-17 account always needs approval');
SELECT t.eq(public.follow_approval_required(t.id('teenyoung')), true, 'a 13-15 account always needs approval');
SELECT t.eq(public.follow_approval_required(t.id('kidok')), true, 'an under-13 account always needs approval');

-- The age alone is enough: a minor with no settings row at all still needs approval.
DELETE FROM public.privacy_preferences WHERE user_id = t.id('teenrowless');
SELECT t.eq(public.follow_approval_required(t.id('teenrowless')), true,
            'a minor with no privacy settings row still needs approval');

-- A minor cannot turn it off, and the setting cannot be lowered by a direct write.
SELECT t.as_user(t.id('teenyoung'));
UPDATE public.privacy_preferences SET require_follow_approval = false WHERE user_id = t.id('teenyoung');
SELECT t.reset();
SELECT t.eq((SELECT require_follow_approval FROM public.privacy_preferences WHERE user_id = t.id('teenyoung')),
            true, 'a 14-year-old cannot turn approval off');
SELECT t.as_user(t.id('teenold'));
UPDATE public.privacy_preferences SET require_follow_approval = false WHERE user_id = t.id('teenold');
SELECT t.reset();
SELECT t.eq((SELECT require_follow_approval FROM public.privacy_preferences WHERE user_id = t.id('teenold')),
            true, 'a 17-year-old cannot turn approval off');

-- ---------------------------------------------------------------------------
-- Following
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('fan'));
SELECT t.eq(public.request_follow(t.id('openadult')), 'following', 'an open adult account can be followed at once');
SELECT t.eq(public.request_follow(t.id('openadult')), 'following', 'following twice changes nothing');
SELECT t.eq(public.request_follow(t.id('privateadult')), 'requested', 'a private adult account gets a request, not a follow');
SELECT t.eq(public.request_follow(t.id('teenyoung')), 'requested', 'a 14-year-old gets a request, not a follow');
SELECT t.eq(public.request_follow(t.id('teenold')), 'requested', 'a 17-year-old gets a request, not a follow');
SELECT t.eq(public.request_follow(t.id('kidok')), 'requested', 'an under-13 account gets a request, not a follow');
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('fan')), 'INVALID_FOLLOW_TARGET', 'you cannot follow yourself');
SELECT t.throws('SELECT public.request_follow(gen_random_uuid())', 'INVALID_FOLLOW_TARGET', 'you cannot follow someone who does not exist');
SELECT t.reset();

SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('fan') AND followee_id = t.id('privateadult')),
            0, 'a request is not a follow');
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('fan') AND followee_id = t.id('teenyoung')),
            0, 'a request for a minor is not a follow');
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('fan')),
            4, 'the four requests are waiting');

-- A child whose features are locked (no guardian consent) cannot follow anyone.
SELECT t.as_user(t.id('kidlocked'));
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('openadult')), 'FOLLOW_LOCKED',
                'a child without guardian consent cannot follow');
SELECT t.reset();

-- ---------------------------------------------------------------------------
-- Nobody writes the tables directly, and anonymous visitors cannot follow
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('INSERT INTO public.follows (follower_id, followee_id) VALUES (%L, %L)', t.id('stranger'), t.id('privateadult')),
                'permission denied', 'a direct insert into follows is refused');
SELECT t.throws(format('INSERT INTO public.follow_requests (requester_id, target_id) VALUES (%L, %L)', t.id('stranger'), t.id('openadult')),
                'permission denied', 'a direct insert into follow_requests is refused');
SELECT t.throws(format('UPDATE public.follow_requests SET created_at = now() WHERE target_id = %L', t.id('privateadult')),
                'permission denied', 'a direct update of follow_requests is refused');
SELECT t.throws(format('DELETE FROM public.follow_requests WHERE target_id = %L', t.id('privateadult')),
                'permission denied', 'a direct delete from follow_requests is refused');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('openadult')), 'permission denied', 'a signed-out visitor cannot follow');
SELECT t.reset();

-- ---------------------------------------------------------------------------
-- Who sees a request
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('fan'));
SELECT t.eq(t.count('SELECT 1 FROM public.follow_requests'), 4, 'the requester sees their own requests');
SELECT t.reset();
SELECT t.as_user(t.id('privateadult'));
SELECT t.eq(t.count('SELECT 1 FROM public.follow_requests'), 1, 'an account sees the requests made of it');
SELECT t.reset();
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count('SELECT 1 FROM public.follow_requests'), 3, 'a guardian sees the requests made of their children (14, 17, under-13)');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.follow_requests'), 0, 'a stranger sees no requests');
SELECT t.reset();
SELECT t.as_user(t.id('otherparent'));
SELECT t.eq(t.count('SELECT 1 FROM public.follow_requests'), 0, 'a guardian of someone else sees none of these');
SELECT t.reset();

-- ---------------------------------------------------------------------------
-- Answering a request
-- ---------------------------------------------------------------------------
-- Not the account, not their guardian: refused.
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.respond_follow_request(%L, %L, true)', t.id('fan'), t.id('privateadult')),
                'FOLLOW_NOT_ALLOWED', 'a stranger cannot approve a request for someone else');
SELECT t.reset();
SELECT t.as_user(t.id('fan'));
SELECT t.throws(format('SELECT public.respond_follow_request(%L, %L, true)', t.id('fan'), t.id('privateadult')),
                'FOLLOW_NOT_ALLOWED', 'you cannot approve your own request');
SELECT t.reset();
SELECT t.as_user(t.id('otherparent'));
SELECT t.throws(format('SELECT public.respond_follow_request(%L, %L, true)', t.id('fan'), t.id('teenyoung')),
                'FOLLOW_NOT_ALLOWED', 'another family''s guardian cannot approve for this child');
SELECT t.reset();

-- A 14-year-old, and an under-13, cannot answer their own requests. Only a guardian can.
SELECT t.as_user(t.id('teenyoung'));
SELECT t.throws(format('SELECT public.respond_follow_request(%L, %L, true)', t.id('fan'), t.id('teenyoung')),
                'FOLLOW_NOT_ALLOWED', 'a 14-year-old cannot approve their own follower');
SELECT t.reset();
SELECT t.as_user(t.id('kidok'));
SELECT t.throws(format('SELECT public.respond_follow_request(%L, %L, true)', t.id('fan'), t.id('kidok')),
                'FOLLOW_NOT_ALLOWED', 'an under-13 cannot approve their own follower');
SELECT t.reset();

-- The account itself can (an adult), and a 16-17 can too.
SELECT t.as_user(t.id('privateadult'));
SELECT t.eq(public.respond_follow_request(t.id('fan'), t.id('privateadult'), true), 'approved', 'an adult approves a request');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('fan') AND followee_id = t.id('privateadult')),
            1, 'an approved request becomes a follow');
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('fan') AND target_id = t.id('privateadult')),
            0, 'and stops waiting');

SELECT t.as_user(t.id('teenold'));
SELECT t.eq(public.respond_follow_request(t.id('fan'), t.id('teenold'), false), 'declined', 'a 17-year-old can decline a request');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('fan') AND followee_id = t.id('teenold')),
            0, 'a declined request does not become a follow');
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('fan') AND target_id = t.id('teenold')),
            0, 'and stops waiting');
SELECT t.as_user(t.id('teenold'));
SELECT t.throws(format('SELECT public.respond_follow_request(%L, %L, true)', t.id('fan'), t.id('teenold')),
                'NO_SUCH_FOLLOW_REQUEST', 'answering a request that is no longer there is refused');
SELECT t.reset();

-- A guardian answers for a 14-year-old and for an under-13, and it is logged.
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(public.respond_follow_request(t.id('fan'), t.id('teenyoung'), true), 'approved', 'a guardian approves for a 14-year-old');
SELECT t.eq(public.respond_follow_request(t.id('fan'), t.id('kidok'), false), 'declined', 'a guardian declines for an under-13');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('fan') AND followee_id = t.id('teenyoung')),
            1, 'the guardian-approved follow exists');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log
             WHERE actor_user_id = t.id('guardian') AND child_user_id = t.id('teenyoung') AND action = 'follow_request.approved'),
            1, 'a guardian''s approval is written to the family audit log');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log
             WHERE actor_user_id = t.id('guardian') AND child_user_id = t.id('kidok') AND action = 'follow_request.declined'),
            1, 'a guardian''s decline is written to the family audit log');

-- ---------------------------------------------------------------------------
-- Removing a follower
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.remove_follower(%L, %L)', t.id('privateadult'), t.id('fan')),
                'FOLLOW_NOT_ALLOWED', 'a stranger cannot remove someone''s follower');
SELECT t.reset();
SELECT t.as_user(t.id('teenyoung'));
SELECT t.throws(format('SELECT public.remove_follower(%L, %L)', t.id('teenyoung'), t.id('fan')),
                'FOLLOW_NOT_ALLOWED', 'a 14-year-old cannot remove their own follower either');
SELECT t.reset();
SELECT t.as_user(t.id('privateadult'));
SELECT t.eq(public.remove_follower(t.id('privateadult'), t.id('fan')), true, 'an adult removes a follower');
SELECT t.eq(public.remove_follower(t.id('privateadult'), t.id('fan')), false, 'removing someone who is not a follower does nothing');
SELECT t.reset();
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(public.remove_follower(t.id('teenyoung'), t.id('fan')), true, 'a guardian removes their child''s follower');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE followee_id IN (t.id('privateadult'), t.id('teenyoung'))),
            0, 'both followers are gone');

-- ---------------------------------------------------------------------------
-- Withdrawing a request
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('fan'));
SELECT t.eq(public.request_follow(t.id('privateadult')), 'requested', 'ask again');
SELECT t.eq(public.cancel_follow_request(t.id('privateadult')), true, 'withdraw it');
SELECT t.eq(public.cancel_follow_request(t.id('privateadult')), false, 'withdrawing nothing does nothing');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.request_follow(t.id('privateadult')), 'requested', 'a stranger asks');
SELECT t.reset();
SELECT t.as_user(t.id('fan'));
SELECT t.eq(public.cancel_follow_request(t.id('privateadult')), false, 'you cannot withdraw someone else''s request');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('stranger')),
            1, 'the stranger''s request is still waiting');

-- ---------------------------------------------------------------------------
-- An adult who turns approval off lets the waiting requests in
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('privateadult'));
UPDATE public.privacy_preferences SET require_follow_approval = false WHERE user_id = t.id('privateadult');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('stranger') AND followee_id = t.id('privateadult')),
            1, 'turning approval off accepts the people who were waiting');
SELECT t.eq((SELECT count(*)::int FROM public.follow_requests WHERE target_id = t.id('privateadult')),
            0, 'and nobody is left waiting');
SELECT t.as_user(t.id('fan'));
SELECT t.eq(public.request_follow(t.id('privateadult')), 'following', 'the account is open to new followers again');
SELECT t.reset();

ROLLBACK;
