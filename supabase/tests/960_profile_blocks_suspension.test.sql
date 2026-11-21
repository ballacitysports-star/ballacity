-- Open item (20261125100000_profile_blocks_suspension): a block, in either direction, and a suspension hide a profile row. The
-- person always reads their own row, staff still see a suspended account, and public / members / private and the minors'
-- defaults are exactly what they were. The blocker keeps their block list with names (my_blocked_profiles). A host keeps the
-- names of the people in their live games through a block or a suspension (managed_profile_names), without the profile row,
-- only while the relationship lasts and only from rows the person wrote, which nobody can repoint and the host cannot reopen once
-- they have ended; a facility admin does not. profile_visibility_of, profile_ages and managed_profile_names do not tell a block
-- from a private profile.
-- Two game notifications say "request a spot".
BEGIN;
SELECT t.person('alice', 30), t.person('bob', 31), t.person('carol', 32), t.person('mem', 33), t.person('priv', 34),
       t.person('sus', 35), t.person('modone', 40), t.person('superone', 45), t.person('teen', 15), t.person('kid', 11);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('superone'), 'superadmin');
-- Sign-up seeds privacy_preferences as private before a birthday exists; model each person's choice.
INSERT INTO public.privacy_preferences (user_id, profile_visibility)
VALUES (t.id('alice'), 'public'), (t.id('bob'), 'public'), (t.id('carol'), 'public'), (t.id('mem'), 'members'),
       (t.id('priv'), 'private'), (t.id('sus'), 'public'), (t.id('modone'), 'public'), (t.id('superone'), 'public'),
       (t.id('teen'), 'public'), (t.id('kid'), 'members')
  ON CONFLICT (user_id) DO UPDATE SET profile_visibility = EXCLUDED.profile_visibility;
SELECT t.eq(public.profile_visibility_of(t.id('teen')), 'members', 'setup: a 15 year old asking for public stays members');
SELECT t.eq(public.profile_visibility_of(t.id('kid')), 'private', 'setup: a child stays private whatever is asked');

-- How many rows of `target`'s profile `viewer` reads through the API (NULL viewer = signed out).
CREATE FUNCTION pg_temp.sees(viewer text, target text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF viewer IS NULL THEN PERFORM t.as_anon(); ELSE PERFORM t.as_user(t.id(viewer)); END IF;
  n := t.count(format('SELECT 1 FROM public.profiles WHERE id = %L', t.id(target)));
  PERFORM t.reset();
  RETURN n;
END $$;

-- ---- shape --------------------------------------------------------------------------------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'SELECT'), 2,
  'profiles still has exactly two read rules');
SELECT t.ok((SELECT qual LIKE '%private_sec.profile_visibility_of(id) = ''public''%' AND qual LIKE '%suspended_at IS NULL%'
               FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Public profiles viewable by anon'),
  'the visitor rule keeps the visibility term and adds the suspension term');
SELECT t.ok((SELECT qual LIKE '%private_sec.profile_visibility_of(id)%' AND qual LIKE '%suspended_at IS NULL%'
                    AND qual LIKE '%SELECT private_sec.is_moderator(auth.uid())%' AND qual LIKE '%SELECT private_sec.viewer_block_peers()%'
               FROM pg_policies WHERE schemaname = 'public' AND tablename = 'profiles' AND policyname = 'Profiles viewable by members'),
  'the member rule keeps the visibility term and adds the suspension and block terms, each evaluated once per query');
SELECT t.ok((SELECT NOT p.prosecdef AND p.prosrc LIKE '%private_sec.rpc_probe_denied(''profile_visibility_of'', ARRAY[_user], current_user)%'
               FROM pg_proc p WHERE p.oid = 'public.profile_visibility_of(uuid)'::regprocedure),
  'public.profile_visibility_of is a contained SECURITY INVOKER wrapper, like the SEC-2 helpers');
SELECT t.eq(has_function_privilege('anon', 'public.profile_visibility_of(uuid)', 'EXECUTE'), false,
  'visitors cannot call public.profile_visibility_of, like the SEC-2 wrappers');
SELECT t.eq(has_function_privilege('authenticated', 'public.profile_visibility_of(uuid)', 'EXECUTE'), true, 'members can');
SELECT t.eq((SELECT string_agg(pg_get_triggerdef(oid), E'\n' ORDER BY tgname) FROM pg_trigger
              WHERE tgfoid = 'private_sec.lock_row_identity()'::regprocedure AND NOT tgisinternal),
  'CREATE TRIGGER a0_game_position_waitlist_identity_locked BEFORE UPDATE ON public.game_position_waitlist FOR EACH ROW EXECUTE FUNCTION private_sec.lock_row_identity(''user_id'', ''game_id'')' || E'\n' ||
  'CREATE TRIGGER a0_payment_submissions_identity_locked BEFORE UPDATE ON public.payment_submissions FOR EACH ROW EXECUTE FUNCTION private_sec.lock_row_identity(''player_id'', ''game_id'', ''host_id'', ''submitted_at'')',
  'waitlist entries and payment submissions keep who they are about, with exactly these columns');
SELECT t.eq((SELECT array_agg(tgrelid::regclass::text || ':' || tgname ORDER BY tgname)::text FROM pg_trigger
              WHERE tgfoid = 'private_sec.lock_closed_relationship()'::regprocedure AND NOT tgisinternal
                AND tgtype = 19),
  '{game_position_waitlist:a1_game_position_waitlist_closed_locked,hosted_games:a1_hosted_games_closed_locked,join_requests:a1_join_requests_closed_locked,payment_submissions:a1_payment_submissions_closed_locked}',
  'games, requests, waitlist entries and payments cannot be reopened by a client (BEFORE UPDATE FOR EACH ROW on all four)');
SELECT t.eq(has_column_privilege('authenticated', 'public.profiles', 'suspended_at', 'SELECT'), false,
  'members still cannot read suspended_at');
SELECT t.eq(has_column_privilege('anon', 'public.profiles', 'suspended_at', 'SELECT'), false, 'nor can visitors');
SELECT t.eq(has_function_privilege('anon', 'public.my_blocked_profiles()', 'EXECUTE'), false, 'visitors cannot call my_blocked_profiles');
SELECT t.eq(has_function_privilege('authenticated', 'public.my_blocked_profiles()', 'EXECUTE'), true, 'members can');
SELECT t.eq(has_function_privilege('anon', 'public.managed_profile_names(uuid[])', 'EXECUTE'), false,
  'visitors cannot call managed_profile_names');
SELECT t.eq(has_function_privilege('authenticated', 'public.managed_profile_names(uuid[])', 'EXECUTE'), true, 'members can');

-- ---- visibility is unchanged for everyone with no block and no suspension -----------------------------------------------------------
SELECT t.eq(pg_temp.sees(NULL, 'alice'), 1, 'a visitor reads a public profile');
SELECT t.eq(pg_temp.sees('carol', 'alice'), 1, 'a member reads a public profile');
SELECT t.eq(pg_temp.sees(NULL, 'mem'), 0, 'a visitor does not read a members-only profile');
SELECT t.eq(pg_temp.sees('carol', 'mem'), 1, 'a member reads a members-only profile');
SELECT t.eq(pg_temp.sees(NULL, 'priv'), 0, 'a visitor does not read a private profile');
SELECT t.eq(pg_temp.sees('carol', 'priv'), 0, 'nor does a member');
SELECT t.eq(pg_temp.sees('priv', 'priv'), 1, 'the private person reads their own profile');
SELECT t.eq(pg_temp.sees('modone', 'priv'), 0, 'staff do not read a private profile through this rule either');

-- ---- minors' defaults are unchanged -------------------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.sees(NULL, 'teen'), 0, 'a visitor does not read a teen''s profile');
SELECT t.eq(pg_temp.sees('carol', 'teen'), 1, 'a member reads a members-visible teen');
SELECT t.eq(pg_temp.sees(NULL, 'kid'), 0, 'a visitor does not read a child''s profile');
SELECT t.eq(pg_temp.sees('carol', 'kid'), 0, 'nor does a member');
SELECT t.eq(pg_temp.sees('kid', 'kid'), 1, 'the child reads their own profile');
SELECT t.eq(pg_temp.sees('teen', 'teen'), 1, 'the teen reads their own profile');

-- ---- a block hides both people from each other, and only from each other -----------------------------------------------------------
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format('INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), %L)', t.id('bob')), 'alice blocks bob');
SELECT t.reset();
SELECT t.eq(pg_temp.sees('alice', 'bob'), 0, 'the blocker no longer reads the blocked person''s profile');
SELECT t.eq(pg_temp.sees('bob', 'alice'), 0, 'the blocked person no longer reads the blocker''s profile');
SELECT t.eq(pg_temp.sees('alice', 'alice'), 1, 'the blocker still reads their own profile');
SELECT t.eq(pg_temp.sees('bob', 'bob'), 1, 'the blocked person still reads their own profile');
SELECT t.eq(pg_temp.sees('carol', 'alice'), 1, 'an unrelated member still reads the blocker');
SELECT t.eq(pg_temp.sees('carol', 'bob'), 1, 'and the blocked person');
SELECT t.eq(pg_temp.sees(NULL, 'bob'), 1, 'signed out, a public profile reads as before');
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.profiles WHERE id IN (%L, %L, %L)', t.id('alice'), t.id('bob'), t.id('carol'))), 2,
  'a list read drops only the blocked row');
SELECT t.reset();

-- the other direction: bob blocking alice hides them the same way
SELECT t.as_user(t.id('alice'));
SELECT t.eq(t.changed(format('DELETE FROM public.user_blocks WHERE blocker_id = auth.uid() AND blocked_id = %L', t.id('bob'))), 1,
  'alice unblocks bob');
SELECT t.reset();
SELECT t.eq(pg_temp.sees('alice', 'bob'), 1, 'unblocking restores the blocker''s view');
SELECT t.eq(pg_temp.sees('bob', 'alice'), 1, 'and the other person''s');
SELECT t.as_user(t.id('bob'));
SELECT t.lives(format('INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), %L)', t.id('alice')), 'bob blocks alice');
SELECT t.reset();
SELECT t.eq(pg_temp.sees('alice', 'bob'), 0, 'blocked by bob, alice no longer reads bob');
SELECT t.eq(pg_temp.sees('bob', 'alice'), 0, 'and bob, the blocker, no longer reads alice');
SELECT t.as_user(t.id('bob'));
SELECT t.eq(t.changed(format('DELETE FROM public.user_blocks WHERE blocker_id = auth.uid() AND blocked_id = %L', t.id('alice'))), 1,
  'bob unblocks alice');
SELECT t.reset();
SELECT t.eq(pg_temp.sees('alice', 'bob'), 1, 'and both read each other again');

-- a block also hides a members-visible teen, and the teen's view of the other person
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format('INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), %L)', t.id('carol')), 'the teen blocks carol');
SELECT t.reset();
SELECT t.eq(pg_temp.sees('carol', 'teen'), 0, 'the blocked member no longer reads the teen');
SELECT t.eq(pg_temp.sees('teen', 'carol'), 0, 'nor the teen the blocked member');
SELECT t.eq(pg_temp.sees('mem', 'teen'), 1, 'another member still reads the teen');
-- staff are not exempt from their own blocks
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format('INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), %L)', t.id('mem')), 'a moderator blocks mem');
SELECT t.reset();
SELECT t.eq(pg_temp.sees('mem', 'modone'), 0, 'the person a moderator blocked does not read the moderator');
SELECT t.eq(pg_temp.sees('modone', 'mem'), 0, 'nor the moderator them');

-- ---- a suspension hides the profile from everyone but the person and staff ---------------------------------------------------------
UPDATE public.profiles SET suspended_at = now(), suspended_reason = 'test' WHERE id = t.id('sus');
SELECT t.eq(pg_temp.sees(NULL, 'sus'), 0, 'a visitor does not read a suspended profile');
SELECT t.eq(pg_temp.sees('carol', 'sus'), 0, 'nor does a member');
SELECT t.eq(pg_temp.sees('sus', 'sus'), 1, 'the suspended person still reads their own profile');
SELECT t.eq(pg_temp.sees('modone', 'sus'), 1, 'a moderator reads a suspended profile');
SELECT t.eq(pg_temp.sees('superone', 'sus'), 1, 'a superadmin reads a suspended profile');
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('mem');
SELECT t.eq(pg_temp.sees('superone', 'mem'), 1, 'staff read a suspended members-only profile');
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('mem');

-- ---- the blocker's own list keeps names ---------------------------------------------------------------------------------------------
UPDATE public.profiles SET avatar_url = 'https://example.test/bob.png', avatar_visibility = 'public', username = 'bob960'
 WHERE id = t.id('bob');
UPDATE public.profiles SET avatar_url = 'https://example.test/priv.png', avatar_visibility = 'public' WHERE id = t.id('priv');
SELECT t.as_user(t.id('alice'));
SELECT t.lives(format('INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), %L), (auth.uid(), %L), (auth.uid(), %L), (auth.uid(), %L)',
                      t.id('bob'), t.id('priv'), t.id('sus'), t.id('mem')),
  'alice blocks bob, a private account, a suspended one and a members-only one');
SELECT t.reset();
-- one block a day, oldest first: bob, priv, sus, mem
UPDATE public.user_blocks
   SET created_at = now() - CASE blocked_id WHEN t.id('bob') THEN interval '4 days' WHEN t.id('priv') THEN interval '3 days'
                                            WHEN t.id('sus') THEN interval '2 days' ELSE interval '1 day' END
 WHERE blocker_id = t.id('alice');
SELECT t.as_user(t.id('alice'));
SELECT t.eq((SELECT count(*)::int FROM public.my_blocked_profiles()), 4, 'my_blocked_profiles lists every block of the caller');
SELECT t.eq((SELECT array_agg(m.blocked_id ORDER BY m.n)
               FROM public.my_blocked_profiles() WITH ORDINALITY AS m(blocked_id, blocked_at, display_name, username, avatar_initials, avatar_url, n)),
            ARRAY[t.id('mem'), t.id('sus'), t.id('priv'), t.id('bob')],
  'newest block first, as the block list shows it');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE blocked_id = t.id('bob')), 'Bob',
  'the blocked public account keeps its name for the blocker');
SELECT t.eq((SELECT username || ' / ' || avatar_initials FROM public.my_blocked_profiles() WHERE blocked_id = t.id('bob')), 'bob960 / BO',
  'with its username and initials');
SELECT t.eq((SELECT avatar_url FROM public.my_blocked_profiles() WHERE blocked_id = t.id('bob')), 'https://example.test/bob.png',
  'and its avatar, which is public');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE blocked_id = t.id('mem')), 'Mem',
  'a blocked members-only account keeps its name too');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE blocked_id = t.id('priv')), NULL,
  'a private account''s name is not revealed through the list');
SELECT t.eq((SELECT avatar_url FROM public.my_blocked_profiles() WHERE blocked_id = t.id('priv')), NULL,
  'nor its avatar, even one whose own setting is public');
SELECT t.eq((SELECT display_name FROM public.my_blocked_profiles() WHERE blocked_id = t.id('sus')), NULL,
  'nor a suspended account''s');
SELECT t.eq(pg_temp.sees('alice', 'bob'), 0, 'while the profile row itself stays hidden from the blocker');
SELECT t.as_user(t.id('bob'));
SELECT t.eq((SELECT count(*)::int FROM public.my_blocked_profiles()), 0, 'the blocked person does not see who blocked them');
SELECT t.as_user(t.id('carol'));
SELECT t.eq((SELECT count(*)::int FROM public.my_blocked_profiles()), 0, 'nor does anyone else');
SELECT t.as_anon();
SELECT t.throws('SELECT * FROM public.my_blocked_profiles()', 'permission denied', 'visitors are refused');
SELECT t.reset();

-- ---- lifting the suspension restores the profile ------------------------------------------------------------------------------------
UPDATE public.profiles SET suspended_at = NULL, suspended_reason = NULL WHERE id = t.id('sus');
SELECT t.eq(pg_temp.sees(NULL, 'sus'), 1, 'restored, a visitor reads the public profile again');
SELECT t.eq(pg_temp.sees('carol', 'sus'), 1, 'and so does a member');

-- ---- "request a spot" in the two game notifications ---------------------------------------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM pg_proc
              WHERE oid IN ('public.guardian_approve_join_request(uuid,boolean)'::regprocedure, 'public.release_expired_payment_holds(text)'::regprocedure)
                AND prosrc ILIKE '%request to join%'), 0, 'neither function says "request to join" any more');

SELECT t.person('host', 36), t.person('guardian', 41), t.person('teenmid', 14), t.person('payer', 29);
SELECT t.guardian('guardian', 'teenmid');
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('g960', t.id('host'), 'basketball', 'Guardian says yes', now() + interval '2 days', 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g960', t.id('host'), 0, true);
SELECT t.as_user(t.id('teenmid'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
VALUES (t.id('req-g960'), 'g960', t.id('teenmid'), t.id('host'), 'k-g960');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-g960')), 'the guardian approves the pending request');
SELECT t.reset();
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('teenmid') AND type = 'join_request_guardian_approved'),
  'Your guardian approved your request for a spot in this game.', 'the child is told in "request a spot" wording');

SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('p960', t.id('host'), 'basketball', 'Paid run', now() + interval '2 days', 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_hold_minutes)
VALUES ('p960', t.id('host'), 10, true, 30);
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, reviewed_at)
VALUES ('p960', t.id('payer'), t.id('host'), 'k-p960', 'approved', now() - interval '2 hours');
INSERT INTO public.game_participants (game_id, user_id) VALUES ('p960', t.id('payer'));
SET LOCAL session_replication_role = origin;
SELECT t.eq(public.release_expired_payment_holds('p960'), 1, 'the unpaid hold is released');
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('payer') AND type = 'payment_hold_expired'),
  'Your payment window ran out, so your spot was released. You can request a spot again if any are open.',
  'the player is told in "request a spot" wording');


-- ---- a host keeps the names of the people in their live games ----------------------------------------------------------------------
SELECT t.person('mhost', 38), t.person('roster', 27), t.person('waiter', 26), t.person('asker', 25), t.person('payee2', 24),
       t.person('susplayer', 23), t.person('privplayer', 22), t.person('mate', 28), t.person('stranger', 39),
       t.person('orgadmin', 44), t.person('orgmate', 43), t.person('member1', 42), t.person('otheradmin', 46), t.person('outsider', 47),
       t.person('rejplayer', 21), t.person('declplayer', 20), t.person('cancplayer', 37), t.person('owedplayer', 36),
       t.person('pastplayer', 35), t.person('recentplayer', 34), t.person('doneplayer', 33),
       t.person('oldask', 32), t.person('apprask', 31), t.person('dispp', 30), t.person('latepay', 29), t.person('stalepay', 28),
       t.person('longplayer', 27), t.person('slowpay', 26),
       t.person('rejpay', 25), t.person('apprwait', 24), t.person('livepaid', 23), t.person('refdone', 22), t.person('refkept', 21),
       t.person('scanplayer', 20), t.person('scompplayer', 19), t.person('oldwait', 33), t.person('svcpay', 32),
       t.person('privonly', 31);
-- Everyone named here but privplayer and privonly is public or members-only, so an empty answer can only come from the
-- relationship test.
INSERT INTO public.privacy_preferences (user_id, profile_visibility)
VALUES (t.id('roster'), 'public'), (t.id('waiter'), 'members'), (t.id('asker'), 'public'), (t.id('payee2'), 'public'),
       (t.id('susplayer'), 'public'), (t.id('privplayer'), 'private'), (t.id('member1'), 'members'), (t.id('mate'), 'public'),
       (t.id('stranger'), 'public'), (t.id('outsider'), 'public'), (t.id('orgmate'), 'public'),
       (t.id('rejplayer'), 'public'), (t.id('declplayer'), 'members'), (t.id('cancplayer'), 'public'), (t.id('owedplayer'), 'public'),
       (t.id('pastplayer'), 'public'), (t.id('recentplayer'), 'public'), (t.id('doneplayer'), 'public'),
       (t.id('oldask'), 'public'), (t.id('apprask'), 'members'), (t.id('dispp'), 'public'), (t.id('latepay'), 'public'),
       (t.id('stalepay'), 'public'), (t.id('longplayer'), 'public'), (t.id('slowpay'), 'public'),
       (t.id('rejpay'), 'public'), (t.id('apprwait'), 'public'), (t.id('livepaid'), 'public'), (t.id('refdone'), 'public'),
       (t.id('refkept'), 'public'), (t.id('scanplayer'), 'public'), (t.id('scompplayer'), 'public'), (t.id('oldwait'), 'public'),
       (t.id('svcpay'), 'public'), (t.id('privonly'), 'private')
  ON CONFLICT (user_id) DO UPDATE SET profile_visibility = EXCLUDED.profile_visibility;
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, cancelled_at, completed_at) VALUES
  ('m960', t.id('mhost'), 'basketball', 'Managed run', now() + interval '2 days', 10, NULL, NULL),
  ('recent960', t.id('mhost'), 'basketball', 'Three days ago', now() - interval '3 days', 10, NULL, NULL),
  ('old960', t.id('mhost'), 'basketball', 'Ten days ago', now() - interval '10 days', 10, NULL, NULL),
  ('done960', t.id('mhost'), 'basketball', 'Marked completed', now() - interval '1 day', 10, NULL, now()),
  ('off960', t.id('mhost'), 'basketball', 'Called off', now() + interval '1 day', 10, now(), NULL);
-- started 15 days ago with an end time a year away: the end time counts for at most 7 days past the start
INSERT INTO public.hosted_games (id, host_id, sport, title, date, ends_at, max_players) VALUES
  ('long960', t.id('mhost'), 'basketball', 'Endless', now() - interval '15 days', now() + interval '365 days', 10);
-- closed by their status only, as superadmin cancel_game leaves them (cancelled_at and completed_at stay NULL)
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, status) VALUES
  ('scan960', t.id('mhost'), 'basketball', 'Cancelled by status', now() + interval '2 days', 10, 'cancelled'),
  ('scomp960', t.id('mhost'), 'basketball', 'Completed by status', now() - interval '1 day', 10, 'completed');
INSERT INTO public.game_participants (game_id, user_id)
VALUES ('m960', t.id('roster')), ('m960', t.id('susplayer')), ('m960', t.id('privplayer')), ('m960', t.id('mate')),
       ('recent960', t.id('recentplayer')), ('old960', t.id('pastplayer')), ('done960', t.id('doneplayer')),
       ('long960', t.id('longplayer')), ('scan960', t.id('scanplayer')), ('scomp960', t.id('scompplayer')),
       ('m960', t.id('privonly'));
INSERT INTO public.game_position_waitlist (game_id, position, user_id, status)
VALUES ('m960', 'guard', t.id('waiter'), 'waiting'), ('m960', 'guard', t.id('declplayer'), 'declined'),
       ('m960', 'guard', t.id('apprwait'), 'approved'), ('old960', 'guard', t.id('oldwait'), 'waiting');
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status)
VALUES ('m960', t.id('asker'), t.id('mhost'), 'k-m960', 'pending'), ('m960', t.id('rejplayer'), t.id('mhost'), 'k-m960r', 'rejected'),
       ('old960', t.id('oldask'), t.id('mhost'), 'k-old960', 'approved'), ('m960', t.id('apprask'), t.id('mhost'), 'k-m960a', 'approved');
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status, refund_status) VALUES
  (t.id('payee2'), 'm960', t.id('mhost'), 'pending', NULL),
  (t.id('cancplayer'), 'm960', t.id('mhost'), 'cancelled', NULL),
  (t.id('owedplayer'), 'off960', t.id('mhost'), 'cancelled', 'owed'),
  (t.id('doneplayer'), 'done960', t.id('mhost'), 'verified', NULL),
  (t.id('dispp'), 'm960', t.id('mhost'), 'disputed', NULL),
  (t.id('rejpay'), 'm960', t.id('mhost'), 'rejected', NULL),
  (t.id('livepaid'), 'm960', t.id('mhost'), 'verified', NULL),
  (t.id('refdone'), 'off960', t.id('mhost'), 'cancelled', 'refunded'),
  (t.id('refkept'), 'off960', t.id('mhost'), 'cancelled', 'kept'),
  (t.id('svcpay'), 'old960', t.id('mhost'), 'cancelled', NULL);
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status, submitted_at) VALUES
  (t.id('latepay'), 'old960', t.id('mhost'), 'pending', now() - interval '10 days'),
  (t.id('stalepay'), 'old960', t.id('mhost'), 'pending', now() - interval '40 days'),
  (t.id('slowpay'), 'm960', t.id('mhost'), 'pending', now() - interval '40 days');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES
  (t.id('org960'), t.id('orgadmin'), 'Gym 960', 'gym960'), (t.id('org961'), t.id('otheradmin'), 'Gym 961', 'gym961');
INSERT INTO public.org_members (org_id, user_id, role)
VALUES (t.id('org960'), t.id('member1'), 'member'), (t.id('org960'), t.id('orgmate'), 'member'), (t.id('org961'), t.id('outsider'), 'member');
SET LOCAL session_replication_role = origin;
-- every managed person blocks the one who manages them (the roster player also blocks a team-mate), except privonly, who is
-- only private; one is suspended
INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES (t.id('roster'), t.id('mhost')), (t.id('waiter'), t.id('mhost')), (t.id('asker'), t.id('mhost')),
       (t.id('payee2'), t.id('mhost')), (t.id('privplayer'), t.id('mhost')), (t.id('roster'), t.id('mate')),
       (t.id('member1'), t.id('orgadmin')), (t.id('member1'), t.id('orgmate')),
       (t.id('rejplayer'), t.id('mhost')), (t.id('declplayer'), t.id('mhost')), (t.id('cancplayer'), t.id('mhost')),
       (t.id('owedplayer'), t.id('mhost')), (t.id('pastplayer'), t.id('mhost')), (t.id('recentplayer'), t.id('mhost')),
       (t.id('doneplayer'), t.id('mhost')), (t.id('oldask'), t.id('mhost')), (t.id('apprask'), t.id('mhost')),
       (t.id('dispp'), t.id('mhost')), (t.id('latepay'), t.id('mhost')), (t.id('stalepay'), t.id('mhost')),
       (t.id('longplayer'), t.id('mhost')), (t.id('slowpay'), t.id('mhost')),
       (t.id('rejpay'), t.id('mhost')), (t.id('apprwait'), t.id('mhost')), (t.id('livepaid'), t.id('mhost')),
       (t.id('refdone'), t.id('mhost')), (t.id('refkept'), t.id('mhost')), (t.id('scanplayer'), t.id('mhost')),
       (t.id('scompplayer'), t.id('mhost')), (t.id('oldwait'), t.id('mhost')), (t.id('svcpay'), t.id('mhost'));
UPDATE public.profiles SET suspended_at = now(), suspended_reason = 'test' WHERE id = t.id('susplayer');
UPDATE public.profiles SET avatar_url = 'https://example.test/roster.png', avatar_visibility = 'public' WHERE id = t.id('roster');
-- avatars the raw column would show but the avatar rules do not: a suspended account's public one, and one kept for game
-- members from a waitlisted player who shares no game with the host
UPDATE public.profiles SET avatar_url = 'https://example.test/susplayer.png', avatar_visibility = 'public' WHERE id = t.id('susplayer');
UPDATE public.profiles SET avatar_url = 'https://example.test/waiter.png', avatar_visibility = 'game_members' WHERE id = t.id('waiter');
UPDATE public.profiles SET username = 'roster960' WHERE id = t.id('roster');

-- Names `viewer` gets from managed_profile_names for `targets`, sorted.
CREATE FUNCTION pg_temp.managed(viewer text, VARIADIC targets text[]) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM t.as_user(t.id(viewer));
  SELECT string_agg(coalesce(m.display_name, '?'), ',' ORDER BY m.display_name) INTO r
    FROM public.managed_profile_names((SELECT array_agg(t.id(x)) FROM unnest(targets) x)) m;
  PERFORM t.reset();
  RETURN coalesce(r, '');
END $$;

SELECT t.eq(pg_temp.sees('mhost', 'roster'), 0, 'setup: the roster player''s block hides their profile from the host');
SELECT t.eq(pg_temp.sees('mhost', 'susplayer'), 0, 'setup: so does the suspension');
SELECT t.eq(pg_temp.sees('mhost', 'stranger'), 1, 'setup: the stranger is public, so only the relationship test can leave them out');
SELECT t.eq(pg_temp.managed('mhost', 'roster'), 'Roster', 'the host keeps the name of a rostered player who blocked them');
SELECT t.eq(pg_temp.managed('mhost', 'waiter'), 'Waiter', 'and of a waitlisted player who blocked them');
SELECT t.eq(pg_temp.managed('mhost', 'asker'), 'Asker', 'and of a player whose pending request is addressed to them');
SELECT t.eq(pg_temp.managed('mhost', 'payee2'), 'Payee2', 'and of a player whose payment submission they must verify or refund');
SELECT t.eq(pg_temp.managed('mhost', 'susplayer'), 'Susplayer', 'and of a suspended player still on the roster');
SELECT t.eq(pg_temp.managed('mhost', 'roster', 'waiter', 'asker', 'payee2', 'susplayer'), 'Asker,Payee2,Roster,Susplayer,Waiter',
  'a list call names all of them');
SELECT t.as_user(t.id('mhost'));
SELECT t.eq((SELECT avatar_url FROM public.managed_profile_names(ARRAY[t.id('roster')])), 'https://example.test/roster.png',
  'with the avatar the avatar rules allow');
SELECT t.eq((SELECT avatar_url FROM public.managed_profile_names(ARRAY[t.id('susplayer')])), NULL,
  'and no avatar for a suspended account, though its own setting is public');
SELECT t.eq((SELECT display_name || ' / ' || coalesce(avatar_url, 'no avatar') FROM public.managed_profile_names(ARRAY[t.id('waiter')])),
  'Waiter / no avatar', 'nor one kept for game members, from a waitlisted player who shares no game with the host');
SELECT t.eq(pg_get_function_result('public.managed_profile_names(uuid[])'::regprocedure),
  'TABLE(id uuid, display_name text, avatar_initials text, avatar_url text)',
  'it returns the name, initials and avatar only: no username, which visible_avatars does not give out either');
SELECT t.reset();
-- the answer does not depend on visibility, so it cannot tell "blocked me" from "private" (the bit profile_visibility_of and
-- profile_ages hide): a private player is named like one who blocked the host
SELECT t.eq(pg_temp.managed('mhost', 'privplayer'), 'Privplayer', 'a private player in the host''s game is named too');
SELECT t.eq(pg_temp.managed('mhost', 'privonly'), 'Privonly', 'whether or not they blocked the host');
CREATE FUNCTION pg_temp.host_view(viewer text, target text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  PERFORM t.as_user(t.id(viewer));
  SELECT format('row %s, name %s, avatar entry %s, my block %s, visibility %s, age %s',
                (SELECT count(*) FROM public.profiles WHERE id = t.id(target)),
                (SELECT count(*) FROM public.managed_profile_names(ARRAY[t.id(target)])),
                (SELECT count(*) FROM public.visible_avatars(ARRAY[t.id(target)])),
                (SELECT count(*) FROM public.user_blocks WHERE blocker_id = auth.uid() AND blocked_id = t.id(target)),
                public.profile_visibility_of(t.id(target)),
                (SELECT count(*) FROM public.profile_ages(ARRAY[t.id(target)])))
    INTO r;
  PERFORM t.reset();
  RETURN r;
END $$;
SELECT t.eq(pg_temp.host_view('mhost', 'roster'), pg_temp.host_view('mhost', 'privonly'),
  'the host sees a public player who blocked them exactly as a private player who did not');
SELECT t.eq(pg_temp.host_view('mhost', 'privonly'), 'row 0, name 1, avatar entry 1, my block 0, visibility private, age 0',
  'no row, a name, an avatar entry, no block of theirs, ''private'' and no age, for both');
SELECT t.eq(pg_temp.managed('mhost', 'stranger'), '', 'the host gets no name for a public account outside their games');
SELECT t.eq(pg_temp.managed('mhost', 'mhost'), '', 'nor their own id');
SELECT t.eq(pg_temp.sees('mhost', 'roster'), 0, 'the profile row itself stays hidden from the host');
SELECT t.eq(pg_temp.managed('mate', 'roster'), '', 'a team-mate the roster player blocked gets no name: only the host does');
SELECT t.eq(pg_temp.managed('stranger', 'roster', 'susplayer', 'member1'), '', 'a stranger gets nothing');
SELECT t.eq(pg_temp.managed('roster', 'mhost'), '', 'the player gets no name back for the host they blocked');

-- only while the relationship lasts
SELECT t.eq(pg_temp.managed('mhost', 'rejplayer'), '', 'a rejected request keeps no name');
SELECT t.eq(pg_temp.managed('mhost', 'declplayer'), '', 'nor a declined waitlist entry');
SELECT t.eq(pg_temp.managed('mhost', 'cancplayer'), '', 'nor a cancelled payment with nothing owed');
SELECT t.eq(pg_temp.managed('mhost', 'owedplayer'), 'Owedplayer', 'a refund still owed keeps the name, even for a called-off game');
SELECT t.eq(pg_temp.managed('mhost', 'doneplayer'), '', 'a completed game''s roster and verified payment keep no name');
SELECT t.eq(pg_temp.managed('mhost', 'recentplayer'), 'Recentplayer', 'a game that started three days ago is still on');
SELECT t.eq(pg_temp.managed('mhost', 'pastplayer'), '', 'one that started ten days ago is over, completed or not');
SELECT t.eq(pg_temp.managed('mhost', 'longplayer'), '', 'even with an end time a year away');
SELECT t.eq(pg_temp.managed('mhost', 'oldask'), '', 'an approved request for a game that is over keeps no name');
SELECT t.eq(pg_temp.managed('mhost', 'apprask'), 'Apprask', 'an approved request for a live game keeps the name, roster or not');
SELECT t.eq(pg_temp.managed('mhost', 'dispp'), 'Dispp', 'and so does a disputed payment');
SELECT t.eq(pg_temp.managed('mhost', 'latepay'), 'Latepay', 'a payment still to verify keeps the name for 30 days after it was sent');
SELECT t.eq(pg_temp.managed('mhost', 'stalepay'), '', 'but not longer, once the game is over');
SELECT t.eq(pg_temp.managed('mhost', 'slowpay'), 'Slowpay', 'while the game is on, however long ago it was sent');
SELECT t.eq(pg_temp.managed('mhost', 'livepaid'), 'Livepaid', 'a verified payment for a live game keeps the name, roster or not');
SELECT t.eq(pg_temp.managed('mhost', 'refdone'), '', 'a refund already sent keeps no name');
SELECT t.eq(pg_temp.managed('mhost', 'refkept'), '', 'nor one settled as kept');
SELECT t.eq(pg_temp.managed('mhost', 'rejpay'), '', 'nor a declined payment');
SELECT t.eq(pg_temp.managed('mhost', 'apprwait'), '', 'nor an approved waitlist entry');
SELECT t.eq(pg_temp.managed('mhost', 'oldwait'), '', 'a waitlist entry still waiting on a game that is over keeps no name');
SELECT t.eq(pg_temp.managed('mhost', 'scanplayer'), '', 'nor the roster of a game cancelled only by its status');
SELECT t.eq(pg_temp.managed('mhost', 'scompplayer'), '', 'nor of one completed only by its status');

-- the host cannot bring an ended relationship back
SELECT t.as_user(t.id('mhost'));
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''pending'' WHERE player_id = %L', t.id('cancplayer')),
  'DECISION_FINAL', 'the host cannot reopen a cancelled payment');
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''disputed'' WHERE player_id = %L', t.id('cancplayer')),
  'DECISION_FINAL', 'nor dispute it');
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''verified'' WHERE player_id = %L', t.id('cancplayer')),
  'DECISION_FINAL', 'nor verify it');
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''pending'' WHERE player_id = %L', t.id('doneplayer')),
  'DECISION_FINAL', 'nor reopen a verified one once its game is over');
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''verified'' WHERE player_id = %L', t.id('rejpay')),
  'DECISION_FINAL', 'nor verify a payment they declined, even for a live game');
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''pending'' WHERE player_id = %L', t.id('rejpay')),
  'DECISION_FINAL', 'nor put it back to pending');
SELECT t.throws(format('UPDATE public.payment_submissions SET status = ''disputed'' WHERE player_id = %L', t.id('rejpay')),
  'DECISION_FINAL', 'nor dispute it');
SELECT t.throws(format('UPDATE public.join_requests SET status = ''approved'' WHERE player_id = %L', t.id('rejplayer')),
  'DECISION_FINAL', 'nor approve a request they declined');
SELECT t.throws(format('UPDATE public.join_requests SET status = ''pending'' WHERE player_id = %L', t.id('rejplayer')),
  'DECISION_FINAL', 'nor put it back to pending');
SELECT t.throws(format('UPDATE public.game_position_waitlist SET status = ''waiting'' WHERE user_id = %L', t.id('declplayer')),
  'DECISION_FINAL', 'nor put a declined waitlist entry back to waiting');
SELECT t.throws(format('UPDATE public.game_position_waitlist SET status = ''waiting'' WHERE user_id = %L', t.id('apprwait')),
  'DECISION_FINAL', 'nor an approved one');
SELECT t.throws('UPDATE public.hosted_games SET completed_at = NULL, status = NULL WHERE id = ''done960''',
  'GAME_CLOSED', 'nor reopen a completed game');
SELECT t.throws('UPDATE public.hosted_games SET cancelled_at = NULL WHERE id = ''off960''', 'GAME_CLOSED', 'nor a called-off one');
SELECT t.throws('UPDATE public.hosted_games SET status = NULL WHERE id = ''scan960''', 'GAME_CLOSED',
  'nor one cancelled only by its status');
SELECT t.throws('UPDATE public.hosted_games SET status = NULL WHERE id = ''scomp960''', 'GAME_CLOSED',
  'nor one completed only by its status');
SELECT t.throws('UPDATE public.hosted_games SET date = now() + interval ''1 day'' WHERE id = ''old960''',
  'GAME_CLOSED', 'nor move a finished game''s date forward');
SELECT t.throws('UPDATE public.hosted_games SET ends_at = now() + interval ''1 day'' WHERE id = ''old960''',
  'GAME_CLOSED', 'nor its end time');
SELECT t.throws(format('UPDATE public.payment_submissions SET submitted_at = now() WHERE player_id = %L', t.id('stalepay')),
  'ROW_IDENTITY_FIXED', 'nor restart a payment''s 30 days');
SELECT t.eq(t.changed('UPDATE public.hosted_games SET title = ''Ten days ago, renamed'' WHERE id = ''old960'''), 1,
  'the host still edits a finished game');
SELECT t.eq(t.changed('UPDATE public.hosted_games SET date = date - interval ''1 day'' WHERE id = ''recent960'''), 1,
  'and still reschedules one that is on');
SELECT t.eq(t.changed(format('UPDATE public.payment_submissions SET status = ''disputed'' WHERE player_id = %L', t.id('latepay'))), 1,
  'and still disputes a payment that is pending');
-- the roster row's "Mark unpaid": a verified payment back to pending while its game is on
SELECT t.eq(t.changed(format('UPDATE public.payment_submissions SET status = ''pending'', reviewed_at = NULL WHERE player_id = %L AND game_id = ''m960''',
                             t.id('livepaid'))), 1,
  'the host can still mark a verified payment unpaid while its game is on');
SELECT t.eq(t.changed(format('UPDATE public.payment_submissions SET status = ''verified'' WHERE player_id = %L AND game_id = ''m960''',
                             t.id('livepaid'))), 1,
  'and verify it again');
SELECT t.reset();
SELECT t.eq(pg_temp.managed('mhost', 'cancplayer', 'rejplayer', 'declplayer', 'doneplayer', 'pastplayer', 'stalepay', 'oldask',
                            'rejpay', 'apprwait', 'scanplayer', 'scompplayer'), '',
  'so none of those names comes back');
-- the player, and the server, still can
SELECT t.as_user(t.id('rejplayer'));
SELECT t.eq(t.changed('UPDATE public.join_requests SET status = ''pending'' WHERE player_id = auth.uid() AND game_id = ''m960'''), 1,
  'the player can still ask again after a decline');
SELECT t.reset();
SELECT t.eq(pg_temp.managed('mhost', 'rejplayer'), 'Rejplayer', 'which names them to the host again, by their own choice');
SELECT t.as_user(t.id('rejpay'));
SELECT t.eq(t.changed('UPDATE public.payment_submissions SET status = ''disputed'', dispute_reason = ''I did pay'' WHERE player_id = auth.uid() AND game_id = ''m960'''), 1,
  'the player can still dispute a payment the host declined');
SELECT t.reset();
SELECT t.eq(pg_temp.managed('mhost', 'rejpay'), 'Rejpay', 'which names them to the host again, by their own choice');
SELECT t.as_service();
SELECT t.eq(t.changed(format('UPDATE public.game_position_waitlist SET status = ''waiting'' WHERE user_id = %L', t.id('declplayer'))), 1,
  'the service role is not held to the lock');
SELECT t.eq(t.changed('UPDATE public.hosted_games SET completed_at = NULL, status = NULL WHERE id = ''done960'''), 1,
  'on games either');
SELECT t.eq(t.changed(format('UPDATE public.payment_submissions SET status = ''pending'' WHERE player_id = %L', t.id('svcpay'))), 1,
  'nor on payments');
SELECT t.eq(t.changed(format('UPDATE public.payment_submissions SET game_id = ''recent960'' WHERE player_id = %L', t.id('svcpay'))), 1,
  'and can still move a payment to another game');
SELECT t.reset();

-- a facility admin is not covered: a membership can be made without the person's consent
SELECT t.eq(pg_temp.sees('orgadmin', 'outsider'), 1, 'setup: the other facility''s member is public');
SELECT t.eq(pg_temp.managed('orgadmin', 'member1'), '', 'a facility admin gets no name for a member who blocked them');
SELECT t.eq(pg_temp.managed('orgadmin', 'outsider'), '', 'nor for a public member of another facility');
SELECT t.eq(pg_temp.managed('mhost', 'outsider'), '', 'nor does a host');
SELECT t.eq(pg_temp.managed('orgmate', 'member1'), '', 'a fellow member the member blocked gets no name');
SELECT t.eq(pg_temp.sees('orgmate', 'member1'), 0, 'nor the profile row');

-- the relationship cannot be manufactured: a self-made facility, a self-waitlist repointed, a payment repointed
SELECT t.person('atk', 31), t.person('vic', 32), t.person('susv', 33), t.person('puppet', 34);
INSERT INTO public.privacy_preferences (user_id, profile_visibility)
VALUES (t.id('atk'), 'public'), (t.id('vic'), 'members'), (t.id('susv'), 'public'), (t.id('puppet'), 'public')
  ON CONFLICT (user_id) DO UPDATE SET profile_visibility = EXCLUDED.profile_visibility;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('vic'), t.id('atk'));
UPDATE public.profiles SET suspended_at = now(), suspended_reason = 'test' WHERE id = t.id('susv');
SELECT t.as_user(t.id('atk'));
SELECT t.lives(format('INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (%L, auth.uid(), ''Atk gym'', ''atkgym960'')',
                      t.id('atkorg')), 'anyone can create a facility');
SELECT t.lives(format('INSERT INTO public.org_members (org_id, user_id, role) VALUES (%L, %L, ''member''), (%L, %L, ''member'')',
                      t.id('atkorg'), t.id('vic'), t.id('atkorg'), t.id('susv')),
  'and add any adult to it, including one who blocked them and a suspended one');
SELECT t.lives('INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
                VALUES (''atk960'', auth.uid(), ''basketball'', ''Atk run'', now() + interval ''2 days'', 10)', 'anyone can host a game');
SELECT t.lives('INSERT INTO public.game_position_waitlist (game_id, position, user_id) VALUES (''atk960'', ''guard'', auth.uid())',
  'and waitlist themselves on it');
SELECT t.throws(format('UPDATE public.game_position_waitlist SET user_id = %L WHERE game_id = ''atk960''', t.id('vic')),
  'ROW_IDENTITY_FIXED', 'but the host cannot point the waitlist entry at someone else');
SELECT t.throws('UPDATE public.game_position_waitlist SET game_id = ''m960'' WHERE game_id = ''atk960''',
  'ROW_IDENTITY_FIXED', 'nor move it to another game');
SELECT t.eq(t.changed('UPDATE public.game_position_waitlist SET status = ''approved'', reviewed_at = now() WHERE game_id = ''atk960'''), 1,
  'the host still reviews the entry');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (t.id('puppet'), 'atk960', t.id('atk'), 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('atk'));
SELECT t.throws(format('UPDATE public.payment_submissions SET player_id = %L WHERE game_id = ''atk960''', t.id('vic')),
  'ROW_IDENTITY_FIXED', 'the host cannot point a payment submission at someone else');
SELECT t.throws('UPDATE public.payment_submissions SET game_id = ''m960'' WHERE game_id = ''atk960''',
  'ROW_IDENTITY_FIXED', 'nor move it to another game');
SELECT t.eq(t.changed('UPDATE public.payment_submissions SET reviewer_notes = ''seen'' WHERE game_id = ''atk960'''), 1,
  'the host still reviews the submission');
SELECT t.reset();
SELECT t.eq(pg_temp.managed('atk', 'vic', 'susv'), '', 'so none of it names the person who blocked them or the suspended account');
SELECT t.eq(pg_temp.managed('atk', 'puppet'), 'Puppet', 'while the person who really sent the payment is named');
SELECT t.as_user(t.id('puppet'));
SELECT t.throws(format('UPDATE public.payment_submissions SET host_id = %L WHERE game_id = ''atk960''', t.id('mhost')),
  'ROW_IDENTITY_FIXED', 'the player cannot point their pending payment at another host');
SELECT t.as_service();
SELECT t.eq(t.changed('UPDATE public.game_position_waitlist SET game_id = ''m960'' WHERE game_id = ''atk960'''), 1,
  'the service role can still move a waitlist entry');
SELECT t.reset();
SELECT t.eq(t.changed('UPDATE public.game_position_waitlist SET game_id = ''atk960'' WHERE game_id = ''m960'' AND user_id = t.id(''atk'')'), 1,
  'and so can the table owner');
-- only the caller's own games: nobody else gets the waitlist, request or payment names
SELECT t.eq(pg_temp.managed('stranger', 'waiter', 'asker', 'apprask', 'payee2', 'owedplayer', 'dispp', 'latepay'), '',
  'a member with no games gets no waitlist, request or payment names');
SELECT t.eq(pg_temp.managed('atk', 'waiter', 'asker', 'apprask', 'payee2', 'owedplayer', 'dispp', 'latepay'), '',
  'nor does another host');

-- limits
SELECT t.as_user(t.id('mhost'));
SELECT t.eq((SELECT count(*)::int FROM public.managed_profile_names(NULL)), 0, 'no ids, no rows');
SELECT t.eq((SELECT count(*)::int FROM public.managed_profile_names(
               (SELECT array_agg(gen_random_uuid()) FROM generate_series(1, 499)) || t.id('roster'))), 1, 'exactly 500 ids are answered');
SELECT t.eq((SELECT count(*)::int FROM public.managed_profile_names(
               (SELECT array_agg(t.id('roster')) FROM generate_series(1, 501)))), 0, 'more than 500 ids, no rows');
SELECT t.as_anon();
SELECT t.throws(format('SELECT * FROM public.managed_profile_names(ARRAY[%L]::uuid[])', t.id('roster')), 'permission denied',
  'visitors are refused');
SELECT t.reset();
-- the relationship ends with the row: off the roster, no name
DELETE FROM public.game_participants WHERE game_id = 'm960' AND user_id = t.id('roster');
SELECT t.eq(pg_temp.managed('mhost', 'roster'), '', 'once the player leaves the game the host no longer gets their name');

-- ---- the API does not tell a block from a private profile ---------------------------------------------------------------------------
SELECT t.person('blkm', 30), t.person('privx', 31), t.person('probe', 32);
INSERT INTO public.privacy_preferences (user_id, profile_visibility)
VALUES (t.id('blkm'), 'members'), (t.id('privx'), 'private'), (t.id('probe'), 'public')
  ON CONFLICT (user_id) DO UPDATE SET profile_visibility = EXCLUDED.profile_visibility;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blkm'), t.id('probe'));
SELECT t.eq(public.profile_visibility_of(t.id('blkm')), 'members', 'setup: the server reads the real visibility');
SELECT t.as_user(t.id('carol'));
SELECT t.eq(public.profile_visibility_of(t.id('blkm')), 'private', 'a client asking about someone else gets ''private''');
SELECT t.eq(public.profile_visibility_of(t.id('carol')), 'public', 'but the truth about themselves');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('blkm')])), 1, 'an unrelated member reads a members adult''s age');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(public.profile_visibility_of(t.id('blkm')), 'members', 'staff get the truth');
SELECT t.as_anon();
SELECT t.throws(format('SELECT public.profile_visibility_of(%L)', t.id('blkm')), 'permission denied for function profile_visibility_of',
  'a visitor is refused outright, not with an error from inside the check');
SELECT t.as_user(t.id('probe'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.profiles WHERE id IN (%L, %L)', t.id('blkm'), t.id('privx'))), 0,
  'the blocked person reads neither the blocker nor the private profile');
SELECT t.eq(public.profile_visibility_of(t.id('blkm')) || '/' || public.profile_visibility_of(t.id('privx')), 'private/private',
  'the visibility answer is the same for both');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('blkm'), t.id('privx')])), 0,
  'and so is the age answer: none for either');
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('probe')])), 1, 'the person still reads their own age');
SELECT t.as_user(t.id('carol'));
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('susv')])), 0, 'a suspended account''s age is not returned');
SELECT t.as_user(t.id('susv'));
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('susv')])), 1, 'except to the suspended person');
SELECT t.as_user(t.id('modone'));
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('susv')])), 1, 'and to staff');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.profile_ages(ARRAY[t.id('blkm'), t.id('susv')])), 2, 'the server still reads both ages');

ROLLBACK;
