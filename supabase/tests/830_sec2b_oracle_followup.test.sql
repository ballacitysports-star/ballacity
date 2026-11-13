-- Migration 20261113120000 (SEC-2b): create_direct_conversation, minor_messaging_block_me (and the send-time trigger), player_activity_stats,
-- request_follow and host_attendance_stats give a signed-in stranger the same answer whoever the other person is: an adult, a 13-15, an
-- under-13, a 16-17 with a guardian, or an id with no account. The people the answers are for (the person, their guardian, the host, the
-- service role) still get them. Run against the schema before the migration, 30 assertions here fail (the negative controls: every
-- messaging refusal text, the adult and host statistics, the follow probes, the blocked follow); the legitimate paths pass before and after.
BEGIN;
SELECT t.person('stranger', 33), t.person('adult', 30), t.person('teenmid', 14), t.person('kid', 11), t.person('teenold', 17),
       t.person('guardian', 42), t.person('nobodyadult', 31), t.person('sharedadult', 32), t.person('openadult', 34),
       t.person('openteen', 16), t.person('blocker', 35), t.person('kidlocked', 10), t.person('hostpriv', 36), t.person('hostpub', 37),
       t.person('hostteen', 17), t.person('player', 29),
       t.person('kidfree', 11), t.person('teenfree', 14);
SELECT t.guardian('guardian', 'teenmid'), t.guardian('guardian', 'kid'), t.guardian('guardian', 'teenold'), t.guardian('guardian', 'hostteen');
-- the guarded minors keep the default guardian control ('guardian_only'); kidfree and teenfree have no guardian, so the age rules decide;
-- the two adults restrict who may message them
UPDATE public.privacy_preferences SET allow_messages = 'nobody' WHERE user_id = t.id('nobodyadult');
UPDATE public.privacy_preferences SET allow_messages = 'shared' WHERE user_id = t.id('sharedadult');
-- every account above starts with a 'private' profile (the sign-up default before the age is known); these four are visible to members
UPDATE public.privacy_preferences SET profile_visibility = 'public' WHERE user_id IN (t.id('openadult'), t.id('blocker'), t.id('hostpub'));
UPDATE public.privacy_preferences SET profile_visibility = 'members' WHERE user_id = t.id('openteen');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('stranger'));
SELECT t.eq((SELECT string_agg(private_sec.profile_visibility_of(t.id(h)), ',') FROM unnest(ARRAY['adult', 'teenmid', 'kid', 'teenold']) h),
            'private,private,private,private', 'fixture: the probed accounts have private profiles');
SELECT t.eq(public.age_cohort_of(t.id('ghost')), 'unknown', 'fixture: ghost has no account');

-- Activity for the statistics: one public finished game everybody played in, plus a private and a hidden game per adult host.
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, max_players, status, completed_at, cancelled_at, is_private, hidden_at) VALUES
  ('s2b-pub',    t.id('hostpub'),  'basketball', 'Open run',   now() - interval '3 days', 'Gym', 20, 'completed', now() - interval '3 days', NULL, false, NULL),
  ('s2b-pubp',   t.id('hostpub'),  'basketball', 'Private',    now() - interval '4 days', 'Gym', 20, 'completed', now() - interval '4 days', NULL, true,  NULL),
  ('s2b-pubh',   t.id('hostpub'),  'basketball', 'Hidden',     now() - interval '5 days', 'Gym', 20, 'cancelled', NULL, now() - interval '5 days', false, now()),
  ('s2b-priv',   t.id('hostpriv'), 'basketball', 'Open run 2', now() - interval '3 days', 'Gym', 20, 'completed', now() - interval '3 days', NULL, false, NULL),
  ('s2b-privp',  t.id('hostpriv'), 'basketball', 'Private 2',  now() - interval '6 days', 'Gym', 20, 'cancelled', NULL, now() - interval '6 days', true,  NULL),
  ('s2b-teen',   t.id('hostteen'), 'basketball', 'Teen run',   now() - interval '3 days', 'Gym', 20, 'completed', now() - interval '3 days', NULL, false, NULL);
INSERT INTO public.game_participants (game_id, user_id, attended) VALUES
  ('s2b-pub', t.id('adult'), true), ('s2b-pub', t.id('teenmid'), true), ('s2b-pub', t.id('kid'), true), ('s2b-pub', t.id('teenold'), true),
  ('s2b-pubp', t.id('player'), false), ('s2b-priv', t.id('player'), true), ('s2b-privp', t.id('player'), true),
  ('s2b-teen', t.id('player'), true);
SET LOCAL session_replication_role = origin;
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;

-- ============================================================================================================================ messaging
SELECT t.as_user(t.id('stranger'));
-- the same answer for every person who may not be messaged, whatever the reason; the minor rules and the adults' own settings are not told apart
SELECT t.eq(public.minor_messaging_block_me(t.id('teenmid')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> 13-15: the neutral code');
SELECT t.eq(public.minor_messaging_block_me(t.id('kid')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> under-13: the same code');
SELECT t.eq(public.minor_messaging_block_me(t.id('teenold')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> guarded 16-17: the same code');
SELECT t.eq(public.minor_messaging_block_me(t.id('kidfree')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> under-13 without a guardian (age rule): the same code');
SELECT t.eq(public.minor_messaging_block_me(t.id('teenfree')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> 13-15 without a guardian (age rule): the same code');
SELECT t.eq(public.minor_messaging_block_me(t.id('nobodyadult')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> adult who accepts nobody: the same code');
SELECT t.eq(public.minor_messaging_block_me(t.id('sharedadult')), 'recipient_restricted:other', 'minor_messaging_block_me, stranger -> adult who accepts shared only: the same code');
SELECT t.eq(public.minor_messaging_block_me(t.id('adult')), NULL, 'minor_messaging_block_me, stranger -> adult: nothing refuses');
SELECT t.eq(public.minor_messaging_block_me(t.id('ghost')), NULL, 'minor_messaging_block_me, stranger -> no account: the same as an adult');
-- create_direct_conversation raises one identical text for all five refusals
DO $$
DECLARE _h text; _seen text[] := '{}'; _msg text;
BEGIN
  FOREACH _h IN ARRAY ARRAY['teenmid', 'kid', 'teenold', 'kidfree', 'teenfree', 'nobodyadult', 'sharedadult'] LOOP
    BEGIN
      PERFORM public.create_direct_conversation(t.id(_h));
      _msg := 'no error';
    EXCEPTION WHEN OTHERS THEN
      _msg := SQLSTATE || ' ' || SQLERRM;
    END;
    PERFORM t.eq(_msg, 'P0001 MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'create_direct_conversation, stranger -> ' || _h || ': the neutral refusal');
    _seen := array_append(_seen, _msg);
  END LOOP;
  PERFORM t.eq((SELECT count(DISTINCT s)::int FROM unnest(_seen) s), 1, 'create_direct_conversation: one text for all seven refusals');
END $$;
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('adult')), 'create_direct_conversation, stranger -> adult: still opens');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.conversation_participants cp WHERE cp.user_id IN (t.id('teenmid'), t.id('kid'), t.id('teenold'), t.id('kidfree'), t.id('teenfree'), t.id('nobodyadult'), t.id('sharedadult'))),
            0, 'no refused probe opened a conversation');

-- the send-time trigger: a refusal about the recipient is the neutral code; one about the sender keeps its own reason
INSERT INTO public.conversations (id, created_by) VALUES ('5b5b5b5b-0000-0000-0000-000000000001', t.id('stranger'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('5b5b5b5b-0000-0000-0000-000000000001', t.id('stranger')), ('5b5b5b5b-0000-0000-0000-000000000001', t.id('teenold'));
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ('5b5b5b5b-0000-0000-0000-000000000001', t.id('stranger'), 'hi')$q$,
                'MINOR_MESSAGING_BLOCKED:recipient_restricted:other', 'send-time trigger, stranger -> guarded 16-17: the neutral code');
SELECT t.as_user(t.id('teenold'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES ('5b5b5b5b-0000-0000-0000-000000000001', t.id('teenold'), 'hi')$q$,
                'MINOR_MESSAGING_BLOCKED:guardian_only:self', 'send-time trigger, the 16-17 sender: their own reason is kept');
-- the caller's own restrictions still name the rule
SELECT t.eq(public.minor_messaging_block_me(t.id('stranger')), 'guardian_only:self', 'minor_messaging_block_me: a guarded 16-17 still learns their own control');
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('adult')), 'MINOR_MESSAGING_BLOCKED:guardian_only:self',
                'create_direct_conversation: and so does the RPC');
SELECT t.as_user(t.id('kidfree'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('adult')), 'MINOR_MESSAGING_BLOCKED:child_needs_guardian:self',
                'an under-13 messaging an adult stranger still gets their own reason');
SELECT t.as_user(t.id('teenfree'));
SELECT t.eq(public.minor_messaging_block_me(t.id('adult')), 'teen_needs_shared_game:self', 'and a 13-15 theirs');
-- legitimate callers still get through
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(public.minor_messaging_block_me(t.id('kid')), NULL, 'a guardian may message their under-13');
SELECT t.eq(public.minor_messaging_block_me(t.id('teenmid')), NULL, 'and their 13-15');
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teenold')), 'and opens a conversation with their 16-17 (guardian-only control)');
SELECT t.reset();
-- an existing conversation is reopened whatever the other person's allow_messages says (unchanged)
INSERT INTO public.conversations (id, created_by) VALUES ('5b5b5b5b-0000-0000-0000-000000000002', t.id('stranger'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('5b5b5b5b-0000-0000-0000-000000000002', t.id('stranger')), ('5b5b5b5b-0000-0000-0000-000000000002', t.id('nobodyadult'));
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.create_direct_conversation(t.id('nobodyadult')), '5b5b5b5b-0000-0000-0000-000000000002'::uuid,
            'an existing conversation with an adult who accepts nobody new is still reopened');
SELECT t.eq(public.minor_messaging_block_me(t.id('nobodyadult')), NULL, 'and minor_messaging_block_me agrees with the RPC');
SELECT t.reset();
-- the shared check is internal
SELECT t.eq((SELECT has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
             FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.direct_message_refusal(uuid,uuid)')), false,
            'private_sec.direct_message_refusal exists and is not callable by signed-in accounts or anonymous visitors');
-- the rules behind the neutral code are unchanged (service role)
SELECT t.eq(public.minor_messaging_block(t.id('stranger'), t.id('kidfree')), 'child_needs_guardian:other', 'internal: the under-13 rule still applies');
SELECT t.eq(public.minor_messaging_block(t.id('stranger'), t.id('teenfree')), 'teen_needs_shared_game:other', 'internal: the 13-15 rule still applies');
SELECT t.eq(public.minor_messaging_block(t.id('stranger'), t.id('teenold')), 'guardian_only:other', 'internal: the guardian control still applies');

-- ============================================================================================================================ player_activity_stats
SELECT t.as_user(t.id('stranger'));
DO $$
DECLARE _h text; _row text;
BEGIN
  FOREACH _h IN ARRAY ARRAY['adult', 'teenmid', 'kid', 'teenold', 'hostpub', 'ghost'] LOOP
    SELECT s::text INTO _row FROM public.player_activity_stats(t.id(_h)) s;
    PERFORM t.eq(_row, '(0,0,0,0,0,0,0,0,0,0,0,)', 'player_activity_stats, stranger -> ' || _h || ': the same zero row');
  END LOOP;
END $$;
SELECT t.as_user(t.id('adult'));
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('adult'))), 1, 'player_activity_stats: an adult still sees their own');
SELECT t.as_user(t.id('hostpub'));
SELECT t.eq((SELECT hosted_total FROM public.player_activity_stats(t.id('hostpub'))), 3, 'a host sees every game they hosted, private and hidden included');
SELECT t.as_user(t.id('teenmid'));
SELECT t.eq((SELECT games_attended FROM public.player_activity_stats(t.id('teenmid'))), 1, 'a 13-15 sees their own attendance');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq((SELECT games_attended FROM public.player_activity_stats(t.id('kid'))), 1, 'a verified guardian sees their under-13''s attendance');
SELECT t.eq((SELECT games_attended FROM public.player_activity_stats(t.id('teenold'))), 1, 'and their 16-17''s');
SELECT t.as_user(t.id('teenold'));
SELECT t.eq((SELECT games_attended FROM public.player_activity_stats(t.id('teenmid'))), 0, 'another minor learns nothing');
SELECT t.as_service();
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('adult'))), 1, 'the service role still gets the numbers');
SELECT t.reset();

-- ============================================================================================================================ request_follow
SELECT t.as_user(t.id('stranger'));
DO $$
DECLARE _h text; _msg text;
BEGIN
  FOREACH _h IN ARRAY ARRAY['adult', 'teenmid', 'kid', 'teenold', 'ghost', 'blocker'] LOOP
    BEGIN
      _msg := 'returned ' || public.request_follow(t.id(_h));
    EXCEPTION WHEN OTHERS THEN
      _msg := SQLSTATE || ' ' || SQLERRM;
    END;
    PERFORM t.eq(_msg, 'P0001 INVALID_FOLLOW_TARGET', 'request_follow, stranger -> ' || _h || ': the one neutral error');
  END LOOP;
END $$;
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.follows WHERE follower_id = t.id('stranger')) + (SELECT count(*)::int FROM public.follow_requests WHERE requester_id = t.id('stranger')),
            0, 'request_follow: no refused probe wrote a follow or a request');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type LIKE '%follow%' AND user_id IN (t.id('adult'), t.id('teenmid'), t.id('kid'), t.id('teenold'), t.id('guardian'), t.id('blocker'))),
            0, 'and nobody was notified');
-- the person who blocked gets the same error the other way (the stranger's profile is made visible, so only the block refuses)
UPDATE public.privacy_preferences SET profile_visibility = 'public' WHERE user_id = t.id('stranger');
SELECT t.as_user(t.id('blocker'));
SELECT t.throws(format('SELECT public.request_follow(%L)', t.id('stranger')), 'INVALID_FOLLOW_TARGET', 'request_follow: the blocker following the person they blocked gets the same error');
SELECT t.reset();
-- visible accounts behave as before
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.request_follow(t.id('openadult')), 'following', 'request_follow: a visible adult is followed at once');
SELECT t.eq(public.request_follow(t.id('openteen')), 'requested', 'a visible 16-17 gets a request');
SELECT t.reset();
-- the caller's own lock comes first, whatever the target
SELECT t.as_user(t.id('kidlocked'));
SELECT t.throws('SELECT public.request_follow(gen_random_uuid())', 'FOLLOW_LOCKED', 'request_follow: a locked child is told about their own lock first');
SELECT t.reset();
-- a guardian can still follow their own child, whose profile is private
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(public.request_follow(t.id('kid')), 'requested', 'request_follow: a guardian asks to follow their own under-13');
SELECT t.reset();
-- an existing request survives the account going private
INSERT INTO public.follow_requests (requester_id, target_id) VALUES (t.id('player'), t.id('teenold'));
SELECT t.as_user(t.id('player'));
SELECT t.eq(public.request_follow(t.id('teenold')), 'requested', 'request_follow: asking again about a request already waiting still answers requested');
SELECT t.reset();

-- ============================================================================================================================ host_attendance_stats
SELECT t.as_user(t.id('stranger'));
DO $$
DECLARE _h text; _row text;
BEGIN
  FOREACH _h IN ARRAY ARRAY['hostpriv', 'hostteen', 'adult', 'teenmid', 'kid', 'teenold', 'ghost'] LOOP
    SELECT s::text INTO _row FROM public.host_attendance_stats(t.id(_h)) s;
    PERFORM t.eq(_row, '(0,0,0,0)', 'host_attendance_stats, stranger -> ' || _h || ': zeros');
  END LOOP;
END $$;
SELECT t.eq((SELECT s::text FROM public.host_attendance_stats(t.id('hostpub')) s), '(4,4,0,1)',
            'host_attendance_stats, stranger -> a public adult host: only the public, unhidden game counts');
SELECT t.as_user(t.id('hostpub'));
SELECT t.eq((SELECT s::text FROM public.host_attendance_stats(t.id('hostpub')) s), '(5,4,1,2)', 'the host still sees every game');
SELECT t.as_user(t.id('hostpriv'));
SELECT t.eq((SELECT s::text FROM public.host_attendance_stats(t.id('hostpriv')) s), '(2,2,1,1)', 'a host with a private profile sees their own');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq((SELECT s::text FROM public.host_attendance_stats(t.id('hostteen')) s), '(1,1,0,1)', 'a 16-17 host''s guardian sees theirs');
SELECT t.as_service();
SELECT t.eq((SELECT s::text FROM public.host_attendance_stats(t.id('hostpriv')) s), '(2,2,1,1)', 'the service role sees everything');
SELECT t.reset();
SELECT t.eq(has_function_privilege('anon', 'public.host_attendance_stats(uuid)', 'EXECUTE'), false, 'anonymous visitors still cannot call it');

ROLLBACK;
