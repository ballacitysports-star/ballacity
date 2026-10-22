-- Who can watch a posted reel follows the account: public, followers, or private,
-- with age floors. reel_audience() says what a reel is; reel_visible_to() says
-- whether one person may watch it. The table's read policy, the feed readers and the
-- comment policies all call reel_visible_to(), so they are checked through it here.
--
--   18+       chooses public / followers / private (default public)
--   16-17     never public. Default private; may choose followers. An adult follower also
--             needs a shared team. Their verified guardian can always watch.
--   13-15     always private to followers; their own team/guardian rules are in
--             20_teen_team_sharing.test.sql
--   under 13  always private
BEGIN;

SELECT t.person('owner', 30), t.person('follower', 28), t.person('stranger', 29),
       t.person('pending', 27), t.person('guardian', 41), t.person('coach', 36),
       t.person('teenmate', 16), t.person('teenowner', 17), t.person('teenmid', 14),
       t.person('kidyoung', 10), t.person('kidfan', 11), t.person('lockedfan', 14),
       t.person('banned', 33);
SELECT t.guardian('guardian', 'teenowner'), t.guardian('guardian', 'teenmid'),
       t.guardian('guardian', 'kidyoung'), t.guardian('guardian', 'kidfan');
-- lockedfan is 14 with no guardian consent, so their features are locked (and they are not under 13).

SELECT t.team('squad', 'coach');
-- The coach owns the team, so is already a member.
SELECT t.member('squad', 'teenowner');

SELECT t.reel('owner', 'adult');
SELECT t.reel('teenowner', 'teen');
SELECT t.reel('teenmid', 'mid');
SELECT t.reel('kidyoung', 'kid');

-- Follows set up directly (the approval flow is tested in 110_follow_approval.test.sql).
INSERT INTO public.follows (follower_id, followee_id) VALUES
  (t.id('follower'), t.id('owner')), (t.id('kidfan'), t.id('owner')), (t.id('lockedfan'), t.id('owner')),
  (t.id('banned'), t.id('owner')),
  (t.id('follower'), t.id('teenowner')), (t.id('coach'), t.id('teenowner')), (t.id('stranger'), t.id('teenowner')),
  (t.id('teenmate'), t.id('teenowner')),
  (t.id('follower'), t.id('teenmid')), (t.id('follower'), t.id('kidyoung'));
INSERT INTO public.follow_requests (requester_id, target_id) VALUES (t.id('pending'), t.id('owner'));
UPDATE public.profiles SET suspended_at = now(), moderation_state = 'suspended' WHERE id = t.id('banned');

-- ---------------------------------------------------------------------------
-- Adults: the account's choice
-- ---------------------------------------------------------------------------
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'public', 'an adult is public by default');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), NULL), true, 'a signed-out visitor can watch a public reel');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('stranger')), true, 'a stranger can watch a public reel');

UPDATE public.privacy_preferences SET reel_audience = 'followers' WHERE user_id = t.id('owner');
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'followers', 'an adult can choose followers only');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), NULL), false, 'a signed-out visitor cannot watch a followers-only reel');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('stranger')), false, 'a stranger cannot');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('pending')), false, 'someone whose request is still waiting cannot');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('follower')), true, 'an approved follower can');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('owner')), true, 'the owner can');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('kidfan')), false, 'an under-13 follower cannot');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('lockedfan')), false, 'a follower with locked child features cannot');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('banned')), false, 'a suspended follower cannot');

UPDATE public.privacy_preferences SET reel_audience = 'private' WHERE user_id = t.id('owner');
SELECT t.eq(public.reel_audience(t.id('reel-adult')), 'private', 'an adult can choose private');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('follower')), false, 'a follower cannot watch a private reel');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('owner')), true, 'the owner still can');

-- A draft or a hold stays closed whatever the setting.
UPDATE public.privacy_preferences SET reel_audience = 'public' WHERE user_id = t.id('owner');
UPDATE public.highlight_reels SET is_draft = true WHERE id = t.id('reel-adult');
SELECT t.eq(public.reel_visible_to(t.id('reel-adult'), t.id('owner')), false, 'a draft is closed to everyone, the owner included, here');
UPDATE public.highlight_reels SET is_draft = false WHERE id = t.id('reel-adult');

-- ---------------------------------------------------------------------------
-- What the table, the feed and a person's list actually return
-- ---------------------------------------------------------------------------
UPDATE public.privacy_preferences SET reel_audience = 'followers' WHERE user_id = t.id('owner');

SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-adult'')'), 0, 'anonymous: the table hides a followers-only reel');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-adult'')'), 0, 'a stranger: the table hides it');
SELECT t.reset();
SELECT t.as_user(t.id('follower'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-adult'')'), 1, 'a follower: the table shows it');
SELECT t.reset();
SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-adult'')'), 1, 'the owner: the table shows it');
SELECT t.reset();

SELECT t.eq((SELECT count(*)::int FROM public.public_reel_feed_ids(NULL, NULL, 50, NULL) WHERE id = t.id('reel-adult')),
            0, 'the feed leaves it out for a signed-out visitor');
SELECT t.eq((SELECT count(*)::int FROM public.public_reel_feed_ids(NULL, NULL, 50, t.id('stranger')) WHERE id = t.id('reel-adult')),
            0, 'the feed leaves it out for a stranger');
SELECT t.eq((SELECT count(*)::int FROM public.public_reel_feed_ids(NULL, NULL, 50, t.id('follower')) WHERE id = t.id('reel-adult')),
            1, 'the feed includes it for a follower');
SELECT t.eq((SELECT count(*)::int FROM public.public_user_reel_ids(t.id('owner'), 12, t.id('stranger'))), 0, 'their reel list is empty for a stranger');
SELECT t.eq((SELECT count(*)::int FROM public.public_user_reel_ids(t.id('owner'), 12, t.id('follower'))), 1, 'their reel list shows a follower the reel');
SELECT t.eq((SELECT count(*)::int FROM public.public_user_reel_ids(t.id('owner'), 12, t.id('owner'))), 1, 'their reel list shows the owner their own reel');

-- ---------------------------------------------------------------------------
-- Comments follow the reel
-- ---------------------------------------------------------------------------
INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body, moderation_status)
VALUES (t.id('comment-adult'), 'highlight_reel', t.id('reel-adult')::text, t.id('follower'), 'Great shot', 'approved');

SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-adult'))), 0, 'anonymous: comments on a followers-only reel are hidden');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-adult'))), 0, 'a stranger cannot read its comments');
SELECT t.throws(format('INSERT INTO public.post_comments (subject_type, subject_id, author_id, body) VALUES (''highlight_reel'', %L, %L, ''hi'')',
                       t.id('reel-adult')::text, t.id('stranger')),
                'row-level security', 'a stranger cannot comment on it');
SELECT t.reset();
SELECT t.as_user(t.id('follower'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-adult'))), 1, 'a follower can read its comments');
SELECT t.lives(format('INSERT INTO public.post_comments (subject_type, subject_id, author_id, body) VALUES (''highlight_reel'', %L, %L, ''Nice'')',
                      t.id('reel-adult')::text, t.id('follower')), 'and can comment');
SELECT t.reset();
UPDATE public.privacy_preferences SET reel_audience = 'public' WHERE user_id = t.id('owner');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-adult'))), 1, 'a public reel''s comments are readable by anyone');
SELECT t.reset();

-- ---------------------------------------------------------------------------
-- 16-17: never public, followers only by choice, adults need a connection
-- ---------------------------------------------------------------------------
SELECT t.eq(public.reel_audience(t.id('reel-teen')), 'private', 'a 16-17 reel is private by default');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('follower')), false, 'a follower cannot watch a private 16-17 reel');

-- Choosing public is not possible: the floor turns it back into private.
SELECT t.as_user(t.id('teenowner'));
UPDATE public.privacy_preferences SET reel_audience = 'public' WHERE user_id = t.id('teenowner');
SELECT t.reset();
SELECT t.eq((SELECT reel_audience FROM public.privacy_preferences WHERE user_id = t.id('teenowner')), 'private', 'a 17-year-old cannot make their reels public');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), NULL), false, 'a signed-out visitor cannot watch a 16-17 reel');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('stranger')), false, 'a signed-in stranger cannot');

SELECT t.as_user(t.id('teenowner'));
UPDATE public.privacy_preferences SET reel_audience = 'followers' WHERE user_id = t.id('teenowner');
SELECT t.reset();
SELECT t.eq(public.reel_audience(t.id('reel-teen')), 'followers', 'a 17-year-old can choose followers');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('teenmate')), true, 'a teen follower can watch');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('coach')), true, 'an adult follower who shares a team can watch');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('follower')), false, 'an adult follower with no shared team cannot');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('stranger')), false, 'a follower who is an unconnected adult cannot');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('guardian')), true, 'their verified guardian can');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('teenowner')), true, 'they can');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), NULL), false, 'a signed-out visitor still cannot');

-- The guardian can watch even when the teen picks private.
UPDATE public.privacy_preferences SET reel_audience = 'private' WHERE user_id = t.id('teenowner');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('guardian')), true, 'a guardian can watch a private 16-17 reel');
SELECT t.eq(public.reel_visible_to(t.id('reel-teen'), t.id('teenmate')), false, 'a teen follower cannot watch it once it is private');

-- ---------------------------------------------------------------------------
-- 13-15 and under 13: locked, whatever the setting says
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('teenmid'));
UPDATE public.privacy_preferences SET reel_audience = 'followers' WHERE user_id = t.id('teenmid');
SELECT t.reset();
SELECT t.eq((SELECT reel_audience FROM public.privacy_preferences WHERE user_id = t.id('teenmid')), 'private', 'a 14-year-old cannot allow followers');
SELECT t.eq(public.reel_audience(t.id('reel-mid')), 'none', 'a 13-15 reel stays with the guardian and approved team');
SELECT t.eq(public.reel_visible_to(t.id('reel-mid'), t.id('follower')), false, 'a follower cannot watch a 13-15 reel');
SELECT t.eq(public.reel_visible_to(t.id('reel-mid'), t.id('guardian')), false, 'it is not served by this path; the teen-reel check handles the guardian');
SELECT t.eq(public.teen_reel_viewer_access(t.id('reel-mid'), t.id('guardian')), 'guardian', 'the guardian still watches through the teen-reel check');

SELECT t.eq(public.reel_audience(t.id('reel-kid')), 'none', 'an under-13 reel is never served');
SELECT t.eq(public.reel_visible_to(t.id('reel-kid'), t.id('follower')), false, 'a follower cannot watch an under-13 reel');
SELECT t.eq((SELECT reel_audience FROM public.privacy_preferences WHERE user_id = t.id('kidyoung')), 'private', 'an under-13 account is locked to private');

-- A missing reel is closed, not an error.
SELECT t.eq(public.reel_audience(gen_random_uuid()), 'none', 'a reel that does not exist has no audience');
SELECT t.eq(public.reel_visible_to(gen_random_uuid(), t.id('follower')), false, 'and nobody can watch it');

-- ---------------------------------------------------------------------------
-- Not callable from the API
-- ---------------------------------------------------------------------------
SELECT t.as_user(t.id('follower'));
SELECT t.throws(format('SELECT public.reel_visible_to(%L, %L)', t.id('reel-adult'), t.id('follower')), 'permission denied', 'reel_visible_to is not callable by a signed-in user');
SELECT t.throws('SELECT * FROM public.public_reel_feed_ids(NULL, NULL, 8, NULL)', 'permission denied', 'the feed reader is not callable by a signed-in user');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(format('SELECT public.reel_visible_to(%L, NULL)', t.id('reel-adult')), 'permission denied', 'nor by a signed-out visitor');
SELECT t.reset();

ROLLBACK;
