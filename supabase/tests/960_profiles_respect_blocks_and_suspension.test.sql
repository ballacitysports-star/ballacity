-- Profile rows and blocks / suspension (20261126100000_profiles_respect_blocks_and_suspension,
-- docs/privacy/profile-blocks-and-suspension.md). A viewer blocked either way, and any non-staff viewer of a suspended
-- account, gets no row, the same answer as a private or missing account. The person themselves and staff keep the access
-- they had. Visibility settings and the minors' defaults decide exactly as before.
BEGIN;

SELECT t.person('alice', 30), t.person('bob', 31), t.person('carol', 29), t.person('pubpat', 33), t.person('privpam', 34),
       t.person('susan', 35), t.person('pubsue', 36), t.person('modmo', 40), t.person('supersam', 41), t.person('guardian', 42),
       t.person('teenyoung', 14), t.person('teenold', 17), t.person('kidpriv', 11), t.person('kidpub', 10),
       t.person('teenrowless', 15), t.person('kidrowless', 9);

-- Every account starts 'private' (handle_new_user stores it before a birthday exists), so the adults are given a setting.
UPDATE public.privacy_preferences SET profile_visibility = 'members'
 WHERE user_id IN (t.id('alice'), t.id('bob'), t.id('carol'), t.id('susan'), t.id('modmo'), t.id('supersam'));
UPDATE public.privacy_preferences SET profile_visibility = 'public' WHERE user_id IN (t.id('pubpat'), t.id('pubsue'));
UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id IN (t.id('teenyoung'), t.id('teenold'));
-- No settings row at all: the age default decides (teen 'members', under-13 'private').
DELETE FROM public.privacy_preferences WHERE user_id IN (t.id('teenrowless'), t.id('kidrowless'));
SELECT t.guardian('guardian', 'teenyoung');
SELECT t.guardian('guardian', 'kidpriv');
SELECT t.guardian('guardian', 'kidpub');
UPDATE public.child_controls SET public_profile = true, public_profile_authorized_by = t.id('guardian')
 WHERE child_user_id = t.id('kidpub');

UPDATE public.profiles SET suspended_at = now() WHERE id IN (t.id('susan'), t.id('pubsue'));
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modmo'), 'moderator'), (t.id('supersam'), 'superadmin');

-- alice blocked bob. pubpat (public) blocked carol. carol blocked teenold. alice blocked the moderator.
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES
  (t.id('alice'), t.id('bob')), (t.id('pubpat'), t.id('carol')), (t.id('carol'), t.id('teenold')),
  (t.id('alice'), t.id('modmo'));

-- The visibility each account chose (or its age default), unchanged by this migration.
SELECT t.eq((SELECT string_agg(private_sec.profile_visibility_of(t.id(h)), ',' ORDER BY o)
               FROM unnest(ARRAY['alice', 'bob', 'pubpat', 'privpam', 'susan', 'pubsue', 'teenyoung', 'teenold', 'kidpriv',
                                 'kidpub', 'teenrowless', 'kidrowless']) WITH ORDINALITY AS u(h, o)),
            'members,members,public,private,members,public,members,members,private,public,members,private',
            'setup: visibility as chosen; minors with no setting get their age default; a guardian-public child is public');

CREATE FUNCTION pg_temp.sees(_viewer text, _owner text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF _viewer = 'anon' THEN PERFORM t.as_anon(); ELSE PERFORM t.as_user(t.id(_viewer)); END IF;
  n := t.count(format('SELECT 1 FROM public.profiles WHERE id = %L', t.id(_owner)));
  PERFORM t.reset();
  RETURN n = 1;
END $$;

-- ---------------------------------------------------------------------------
-- Blocked either way
-- ---------------------------------------------------------------------------
SELECT t.eq(pg_temp.sees('bob', 'alice'), false, 'the person blocked (bob) gets no row for the members-visible adult who blocked him');
SELECT t.eq(pg_temp.sees('alice', 'bob'), false, 'the person who blocked (alice) gets no row for the person she blocked');
SELECT t.eq(pg_temp.sees('carol', 'alice'), true, 'an unblocked member still sees the members-visible adult');
SELECT t.eq(pg_temp.sees('carol', 'bob'), true, 'an unblocked member still sees the blocked person');
SELECT t.eq(pg_temp.sees('carol', 'pubpat'), false, 'a public profile is hidden from the member it blocked');
SELECT t.eq(pg_temp.sees('pubpat', 'carol'), false, 'and the public profile''s owner no longer sees the member they blocked');
SELECT t.eq(pg_temp.sees('bob', 'pubpat'), true, 'that public profile stays visible to other members');
SELECT t.eq(pg_temp.sees('anon', 'pubpat'), true, 'and to anonymous visitors (a block needs a signed-in viewer)');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count('SELECT 1 FROM public.user_blocks'), 0,
  'setup: bob cannot read the block row alice holds, yet the rule above still hides her (both directions are checked)');
SELECT t.reset();

-- A list query (search, rosters, follows) drops exactly the blocked rows and nothing else.
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.profiles WHERE id = ANY (%L::uuid[])',
                           ARRAY[t.id('alice'), t.id('carol'), t.id('pubpat'), t.id('privpam'), t.id('teenyoung')])), 3,
            'a list read by bob: alice (blocked her side) and privpam (private) drop out; carol, pubpat and the teen stay');
SELECT t.eq(t.count('SELECT 1 FROM public.profiles WHERE display_name ILIKE ''%a%'' AND id = ANY (ARRAY['''
                    || t.id('alice') || '''::uuid, ''' || t.id('carol') || '''::uuid])'), 1,
            'a name search by bob finds carol but not alice');
SELECT t.reset();

-- Unblocking gives the row back at once.
DELETE FROM public.user_blocks WHERE blocker_id = t.id('alice') AND blocked_id = t.id('bob');
SELECT t.eq(pg_temp.sees('bob', 'alice'), true, 'once alice unblocks bob he sees her profile again');
SELECT t.eq(pg_temp.sees('alice', 'bob'), true, 'and she sees his');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('alice'), t.id('bob'));

-- Minors: blocks apply to them in both directions too.
SELECT t.eq(pg_temp.sees('teenold', 'carol'), false, 'a teen blocked by an adult no longer sees that adult');
SELECT t.eq(pg_temp.sees('carol', 'teenold'), false, 'and the adult who blocked a members-visible teen no longer sees the teen');
SELECT t.eq(pg_temp.sees('bob', 'teenold'), true, 'other members still see the members-visible teen');

-- ---------------------------------------------------------------------------
-- Suspended
-- ---------------------------------------------------------------------------
SELECT t.eq(pg_temp.sees('carol', 'susan'), false, 'a member gets no row for a suspended members-visible account');
SELECT t.eq(pg_temp.sees('carol', 'pubsue'), false, 'a member gets no row for a suspended public account');
SELECT t.eq(pg_temp.sees('anon', 'pubsue'), false, 'an anonymous visitor gets no row for a suspended public account');
SELECT t.eq(pg_temp.sees('teenyoung', 'pubsue'), false, 'a minor gets no row for a suspended account either');
-- No difference between suspended and private for a non-staff viewer: both are "no row".
SELECT t.eq(pg_temp.sees('carol', 'susan'), pg_temp.sees('carol', 'privpam'),
  'to a non-staff viewer a suspended account looks exactly like a private one');
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('susan');
SELECT t.eq(pg_temp.sees('carol', 'susan'), true, 'lifting the suspension gives the row back');
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('susan');

-- ---------------------------------------------------------------------------
-- Self
-- ---------------------------------------------------------------------------
SELECT t.eq(pg_temp.sees('susan', 'susan'), true, 'a suspended person still reads their own profile');
SELECT t.eq(pg_temp.sees('alice', 'alice'), true, 'a person who blocked someone still reads their own profile');
SELECT t.eq(pg_temp.sees('bob', 'bob'), true, 'a person who was blocked still reads their own profile');
SELECT t.eq(pg_temp.sees('privpam', 'privpam'), true, 'a private person reads their own profile');
SELECT t.eq(pg_temp.sees('kidpriv', 'kidpriv'), true, 'a private under-13 reads their own profile');
SELECT t.as_user(t.id('susan'));
SELECT t.eq(t.changed(format('UPDATE public.profiles SET bio = %L WHERE id = %L', 'still me', t.id('susan'))), 1,
  'a suspended person can still update their own row (the update policy can see it)');
SELECT t.reset();

-- ---------------------------------------------------------------------------
-- Staff (private_sec.is_moderator: admin, moderator, superadmin)
-- ---------------------------------------------------------------------------
SELECT t.eq(pg_temp.sees('modmo', 'susan'), true, 'a moderator still reads a suspended members-visible account');
SELECT t.eq(pg_temp.sees('supersam', 'pubsue'), true, 'a superadmin still reads a suspended public account');
SELECT t.eq(pg_temp.sees('modmo', 'alice'), true, 'a moderator reads an account that blocked them');
SELECT t.eq(pg_temp.sees('supersam', 'bob'), true, 'a superadmin reads a blocked account');
-- Staff gain nothing else: the visibility setting still applies to them through this rule.
SELECT t.eq(pg_temp.sees('modmo', 'privpam'), false, 'a moderator still gets no row for a private adult (unchanged)');
SELECT t.eq(pg_temp.sees('supersam', 'kidpriv'), false, 'a superadmin still gets no row for a private under-13 (unchanged)');
UPDATE public.privacy_preferences SET profile_visibility = 'private' WHERE user_id = t.id('susan');
SELECT t.eq(pg_temp.sees('modmo', 'susan'), false, 'a suspended account that is also private stays hidden from staff, as before');
UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id = t.id('susan');
DELETE FROM public.user_roles WHERE user_id = t.id('modmo');
SELECT t.eq(pg_temp.sees('modmo', 'susan'), false, 'the staff exemption ends with the role');
SELECT t.eq(pg_temp.sees('modmo', 'alice'), false, 'and the block applies to the former moderator');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modmo'), 'moderator');

-- ---------------------------------------------------------------------------
-- Public, members-only and private (unblocked, not suspended): unchanged
-- ---------------------------------------------------------------------------
SELECT t.eq(pg_temp.sees('anon', 'pubpat'), true, 'anonymous: a public profile is visible');
SELECT t.eq(pg_temp.sees('anon', 'alice'), false, 'anonymous: a members-only profile is not');
SELECT t.eq(pg_temp.sees('anon', 'privpam'), false, 'anonymous: a private profile is not');
SELECT t.eq(pg_temp.sees('bob', 'pubpat'), true, 'member: a public profile is visible');
SELECT t.eq(pg_temp.sees('bob', 'carol'), true, 'member: a members-only profile is visible');
SELECT t.eq(pg_temp.sees('bob', 'privpam'), false, 'member: a private profile is not');

-- ---------------------------------------------------------------------------
-- Minors' defaults: unchanged
-- ---------------------------------------------------------------------------
SELECT t.eq((SELECT string_agg(private_sec.default_profile_visibility_for(t.id(h)), ',' ORDER BY o)
               FROM unnest(ARRAY['teenrowless', 'teenold', 'kidrowless']) WITH ORDINALITY AS u(h, o)),
            'members,members,private', 'the age defaults are unchanged: 13-17 members, under-13 private');
SELECT t.eq(pg_temp.sees('bob', 'teenrowless'), true, 'a 13-15 with no setting is visible to members (age default)');
SELECT t.eq(pg_temp.sees('anon', 'teenrowless'), false, 'but not to anonymous visitors');
SELECT t.eq(pg_temp.sees('bob', 'kidrowless'), false, 'an under-13 with no setting is private (age default)');
SELECT t.eq(pg_temp.sees('bob', 'kidpriv'), false, 'a guarded under-13 stays private to members');
SELECT t.eq(pg_temp.sees('guardian', 'kidpriv'), false, 'and to their guardian through this rule (unchanged; the guardian pages use their own reads)');
SELECT t.eq(pg_temp.sees('anon', 'kidpub'), true, 'an under-13 whose guardian made the profile public is visible to anyone');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('kidpub'), t.id('bob'));
SELECT t.eq(pg_temp.sees('bob', 'kidpub'), false, 'that public child is hidden from a member the child blocked');
SELECT t.eq(pg_temp.sees('carol', 'kidpub'), true, 'and still visible to other members');

-- ---------------------------------------------------------------------------
-- The blocker's own list: public.my_blocked_profiles()
-- ---------------------------------------------------------------------------
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('alice'), t.id('privpam')), (t.id('alice'), t.id('susan'));
SELECT t.as_user(t.id('alice'));
SELECT t.eq((SELECT count(*)::int FROM public.my_blocked_profiles()), 4, 'alice''s list has every account she blocked');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE id = t.id('bob')), 'Bob',
  'it names a members-visible account she blocked (the list worked this way before)');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE id = t.id('privpam')), NULL::text,
  'a private account she blocked has no name, as before');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE id = t.id('susan')), NULL::text,
  'a suspended account she blocked has no name, so it looks like a private one');
SELECT t.reset();
SELECT t.as_user(t.id('bob'));
SELECT t.eq((SELECT count(*)::int FROM public.my_blocked_profiles()), 0,
  'bob, who blocked nobody, gets an empty list (who blocked him is never shown)');
SELECT t.reset();
SELECT t.eq(has_function_privilege('anon', 'public.my_blocked_profiles()', 'EXECUTE'), false,
  'anonymous visitors cannot call my_blocked_profiles');

-- ---------------------------------------------------------------------------
-- The policy's block list says what blocks_exist_between says, for every pair
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.partners_of(_viewer uuid) RETURNS uuid[] LANGUAGE plpgsql AS $$
DECLARE r uuid[];
BEGIN PERFORM t.as_user(_viewer); r := private_sec.my_block_partners(); PERFORM t.reset(); RETURN r; END $$;
SELECT t.eq(
  (SELECT count(*)::int
     FROM unnest(ARRAY['alice', 'bob', 'carol', 'pubpat', 'privpam', 'susan', 'modmo', 'teenold', 'kidpub']) v(h)
     CROSS JOIN unnest(ARRAY['alice', 'bob', 'carol', 'pubpat', 'privpam', 'susan', 'modmo', 'teenold', 'kidpub']) o(h)
    WHERE v.h <> o.h
      AND (t.id(o.h) = ANY (pg_temp.partners_of(t.id(v.h)))) IS DISTINCT FROM private_sec.blocks_exist_between(t.id(v.h), t.id(o.h))),
  0, 'my_block_partners agrees with blocks_exist_between for every pair of fixture accounts, both directions');
SELECT t.eq(cardinality(pg_temp.partners_of(t.id('alice'))), 4, 'alice''s partners: the four accounts she blocked');
SELECT t.eq(cardinality(pg_temp.partners_of(t.id('privpam'))), 1, 'privpam''s partners: alice, who blocked her');
SELECT t.eq(cardinality(pg_temp.partners_of(t.id('susan'))), 1, 'a suspended account''s partners still count');
SELECT t.eq(private_sec.my_block_partners(), '{}'::uuid[], 'with no signed-in caller the list is empty');
SELECT t.eq(has_function_privilege('anon', 'private_sec.my_block_partners()', 'EXECUTE'), false,
  'anonymous visitors cannot call my_block_partners');

ROLLBACK;
