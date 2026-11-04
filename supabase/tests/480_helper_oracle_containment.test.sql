-- SEC-2: helper functions answer direct API questions only about the caller (or for staff and the service role); every internal use is unchanged.
BEGIN;
SELECT t.person('teen', 16), t.person('kid', 11), t.person('guardian', 40), t.person('coach', 38), t.person('stranger', 33), t.person('modone', 39);
SELECT t.guardian('guardian', 'teen');
SELECT t.team('squad', 'coach');
SELECT t.member('squad', 'teen');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, max_players) VALUES ('g1', t.id('coach'), 'basketball', 'Run', now() + interval '2 days', 'Gym', 10);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g1', t.id('teen'));
SET LOCAL session_replication_role = origin;

-- every listed helper is wrapped, and the original logic lives on, unchanged, under private_sec
SELECT t.eq((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND obj_description(p.oid, 'pg_proc') = 'oracle-wrapper'), 29, 'all 29 helpers are wrapped');
SELECT t.ok((SELECT bool_and(to_regprocedure('private_sec.' || s) IS NOT NULL) FROM unnest(ARRAY['is_team_member(text,uuid)', 'is_guardian_of(uuid,uuid)', 'is_game_participant(text,uuid)', 'shares_team(uuid,uuid)', 'is_minor(uuid)']) s), 'and the originals moved to private_sec');
SELECT t.ok(EXISTS (SELECT 1 FROM pg_policy WHERE pg_get_expr(polqual, polrelid) LIKE '%private_sec.is_team_member(%'), 'existing policies now point at the original (by OID), not the wrapper');

-- ---- direct API probes by an unrelated account get the safe answer (simulating PostgREST: request.path = /rpc/<name>)
SELECT t.as_user(t.id('stranger'));
SELECT set_config('request.path', '/rpc/is_team_member', true);
SELECT t.eq((SELECT public.is_team_member('squad', t.id('teen'))), false, 'is_team_member: a stranger learns nothing about a minor''s team');
SELECT set_config('request.path', '/rpc/is_game_participant', true);
SELECT t.eq((SELECT public.is_game_participant('g1', t.id('teen'))), false, 'is_game_participant: nor their games');
SELECT set_config('request.path', '/rpc/is_guardian_of', true);
SELECT t.eq((SELECT public.is_guardian_of(t.id('guardian'), t.id('teen'))), false, 'is_guardian_of: nor who their guardian is');
SELECT set_config('request.path', '/rpc/shares_team', true);
SELECT t.eq((SELECT public.shares_team(t.id('coach'), t.id('teen'))), false, 'shares_team: nor who they share a team with');
SELECT set_config('request.path', '/rpc/team_role_of', true);
SELECT t.eq((SELECT public.team_role_of('squad', t.id('teen'))::text), NULL, 'team_role_of: no role');
SELECT set_config('request.path', '/rpc/is_minor', true);
SELECT t.eq((SELECT public.is_minor(t.id('teen'))), false, 'is_minor: no age signal');
SELECT set_config('request.path', '/rpc/minor_messaging_block', true);
SELECT t.eq((SELECT public.minor_messaging_block(t.id('guardian'), t.id('teen'))), 'not_permitted:other', 'minor_messaging_block: a fixed answer for a pair the caller is not in');
SELECT set_config('request.path', '/rpc/can_notify', true);
SELECT t.eq((SELECT public.can_notify(t.id('coach'), t.id('teen'))), false, 'can_notify: nothing about third parties');
SELECT set_config('request.path', '', true);
-- the statement-text check covers a direct call even without request.path
SELECT t.eq(public.is_team_member('squad', t.id('teen')), false, 'a direct call is recognized from the statement text too');

-- ---- asking about yourself still works through the API (how the app uses these)
SELECT t.as_user(t.id('teen'));
SELECT set_config('request.path', '/rpc/is_team_member', true);
SELECT t.eq((SELECT public.is_team_member('squad', t.id('teen'))), true, 'a person asking about themselves gets the true answer');
SELECT t.as_user(t.id('coach'));
SELECT set_config('request.path', '/rpc/is_team_manager', true);
SELECT t.eq((SELECT public.is_team_manager('squad', t.id('coach'))), true, 'a manager checking their own role');
SELECT t.as_user(t.id('guardian'));
SELECT set_config('request.path', '/rpc/is_guardian_of', true);
SELECT t.eq((SELECT public.is_guardian_of(t.id('guardian'), t.id('teen'))), true, 'a guardian checking their own link');
SELECT t.as_user(t.id('modone'));
SELECT set_config('request.path', '/rpc/is_team_member', true);
SELECT t.eq((SELECT public.is_team_member('squad', t.id('teen'))), true, 'staff get the true answer');
SELECT set_config('request.path', '', true);
SELECT t.reset();
SELECT t.eq(public.is_team_member('squad', t.id('teen')), true, 'the service role (no auth.uid()) gets the true answer');

-- ---- internal uses are unchanged: policies and functions that call the helpers still decide as before
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('teen');
SELECT t.as_user(t.id('coach'));
SELECT set_config('request.path', '/team_members', true);
SELECT t.ok(t.count(format('SELECT 1 FROM public.team_members WHERE user_id = %L', t.id('teen'))) = 1, 'a team manager still reads the minor''s roster row through row security');
SELECT set_config('request.path', '/rpc/create_direct_conversation', true);
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teen')), 'and a function that calls the helpers by name still works (the coach may message the teammate where the rules allow)');
SELECT set_config('request.path', '', true);
SELECT t.reset();
SELECT t.eq(has_function_privilege('anon', 'public.is_team_member(text,uuid)', 'EXECUTE'), false, 'anonymous still cannot call the helpers');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.wrap_oracle_helpers()', 'EXECUTE'), false, 'and nobody but the service role can re-run the wrapping');
SELECT t.eq(private_sec.wrap_oracle_helpers(), 0, 're-running the wrapping is a no-op');
ROLLBACK;
