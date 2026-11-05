-- SEC-2: helper functions answer direct API questions only about the caller (or for staff and the service role); every internal use is unchanged.
BEGIN;
SELECT t.person('teen', 16), t.person('kid', 11), t.person('guardian', 40), t.person('coach', 38), t.person('stranger', 33), t.person('modone', 39);
SELECT t.person('other', 30), t.person('newbie', 31);
SELECT t.guardian('guardian', 'teen');
SELECT t.team('squad', 'coach');
-- the teen joined through an invitation their guardian approved (R7: a direct roster add is not a messaging context)
INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role, status, responded_at, guardian_approved_at, guardian_approved_by)
VALUES ('squad', t.id('teen'), t.id('coach'), 'player', 'accepted', now(), now(), t.id('guardian'));
SELECT t.member('squad', 'teen');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, max_players) VALUES ('g1', t.id('coach'), 'basketball', 'Run', now() + interval '2 days', 'Gym', 10);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g1', t.id('teen'));
SET LOCAL session_replication_role = origin;
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('teen');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('teen'), t.id('stranger'));

-- every listed helper is wrapped, and the original logic lives on, unchanged, under private_sec
SELECT t.eq((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND obj_description(p.oid, 'pg_proc') = 'oracle-wrapper'), 29, 'all 29 helpers are wrapped');
SELECT t.eq((SELECT count(*)::int FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND NOT p.prosecdef AND p.prosrc LIKE '%private_sec.rpc_probe_denied%'), 29, 'and all 29 public wrappers are SECURITY INVOKER bodies that call the probe check');
SELECT t.ok((SELECT bool_and(to_regprocedure('private_sec.' || s) IS NOT NULL) FROM unnest(ARRAY['is_team_member(text,uuid)', 'is_guardian_of(uuid,uuid)', 'is_game_participant(text,uuid)', 'shares_team(uuid,uuid)', 'is_minor(uuid)']) s), 'and the originals moved to private_sec');
SELECT t.ok(EXISTS (SELECT 1 FROM pg_policy WHERE pg_get_expr(polqual, polrelid) LIKE '%private_sec.is_team_member(%'), 'existing policies now point at the original (by OID), not the wrapper');
SELECT t.eq((SELECT count(*)::int FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
             WHERE d.classid = 'pg_policy'::regclass AND p.pronamespace = 'public'::regnamespace AND obj_description(p.oid, 'pg_proc') = 'oracle-wrapper'), 0,
            'no policy calls a public wrapper (it would run as the client and get the fixed answer)');
-- no SECURITY INVOKER function (other than the wrappers) calls a wrapped helper by its public name: it would run as the client
SELECT t.eq((SELECT string_agg(p.oid::regprocedure::text, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE NOT p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema', 't') AND p.prolang <> 13
               AND obj_description(p.oid, 'pg_proc') IS DISTINCT FROM 'oracle-wrapper'
               AND p.prosrc ~ ('(^|[^a-z0-9_.])(public\.)?(' || (SELECT string_agg(p2.proname, '|') FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND obj_description(p2.oid, 'pg_proc') = 'oracle-wrapper') || ')\s*\(')),
            NULL, 'no SECURITY INVOKER function calls a wrapped helper by its public name');
SELECT t.eq((SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')
               AND pg_get_viewdef(c.oid) ~ ('(^|[^a-z0-9_.])(public\.)?(' || (SELECT string_agg(p2.proname, '|') FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND obj_description(p2.oid, 'pg_proc') = 'oracle-wrapper') || ')\s*\(')), 0,
            'no view calls a wrapped helper by its public name');

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
-- the check is structural (the client role is the caller), so neither request.path nor the statement text is needed
SELECT t.eq(public.is_team_member('squad', t.id('teen')), false, 'a direct call is recognized without request.path');

-- ---- F4: a GraphQL-style call is denied too. pg_graphql runs `graphql.resolve(...)` at /rpc/graphql, so neither the path nor the statement
-- text names the helper; here the helper is reached through dynamic SQL whose top-level text never contains `<name>(`.
SELECT set_config('request.path', '/rpc/graphql', true);
DO $$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT public.%I(%L)::text', 'is_' || 'minor', t.id('teen')) INTO r;
  PERFORM t.eq(r, 'false', 'graphql-style dynamic call of is_minor as a stranger gets the fixed answer');
  EXECUTE format('SELECT public.%I(%L, %L)::text', 'is_' || 'guardian_of', t.id('guardian'), t.id('teen')) INTO r;
  PERFORM t.eq(r, 'false', 'graphql-style dynamic call of is_guardian_of as a stranger gets the fixed answer');
END $$;

-- every one of the 29 helpers gives a stranger its fixed answer, called the way GraphQL would (dynamic SQL, path /rpc/graphql, no `<name>(` in the statement)
DO $$
DECLARE
  _cases text[][] := ARRAY[
    ['age_verified',                     format('public.%I(%L)', 'age_verified', t.id('teen')),                                   'false'],
    ['ai_analysis_allowed',              format('public.%I(%L)', 'ai_analysis_allowed', t.id('teen')),                            'false'],
    ['blocks_exist_between',             format('public.%I(%L, %L)', 'blocks_exist_between', t.id('teen'), t.id('guardian')),     'false'],
    ['can_notify',                       format('public.%I(%L, %L)', 'can_notify', t.id('coach'), t.id('teen')),                  'false'],
    ['child_game_participation_allowed', format('public.%I(%L)', 'child_game_participation_allowed', t.id('teen')),               'false'],
    ['default_profile_visibility_for',   format('public.%I(%L)', 'default_profile_visibility_for', t.id('coach')),                'private'],
    ['game_payments_allowed',            format('public.%I(%L)', 'game_payments_allowed', t.id('coach')),                         'false'],
    ['has_entitlement',                  format('public.%I(%L, %L, %L)', 'has_entitlement', t.id('teen'), 'pro', 'sandbox'),      'false'],
    ['has_role',                         format('public.%I(%L, %L)', 'has_role', t.id('modone'), 'moderator'),                    'false'],
    ['is_conversation_participant',      format('public.%I(%L, %L)', 'is_conversation_participant', t.id('guardian'), t.id('teen')), 'false'],
    ['is_game_participant',              format('public.%I(%L, %L)', 'is_game_participant', 'g1', t.id('teen')),                  'false'],
    ['is_guardian_of',                   format('public.%I(%L, %L)', 'is_guardian_of', t.id('guardian'), t.id('teen')),           'false'],
    ['is_gym_admin_text',                format('public.%I(%L, %L)', 'is_gym_admin_text', 'squad', t.id('teen')),                 'false'],
    ['is_managed_account',               format('public.%I(%L)', 'is_managed_account', t.id('kid')),                              'false'],
    ['is_minor',                         format('public.%I(%L)', 'is_minor', t.id('teen')),                                       'false'],
    ['is_moderator',                     format('public.%I(%L)', 'is_moderator', t.id('modone')),                                 'false'],
    ['is_org_member',                    format('public.%I(%L, %L)', 'is_org_member', t.id('guardian'), t.id('teen')),            'false'],
    ['is_superadmin',                    format('public.%I(%L)', 'is_superadmin', t.id('modone')),                                'false'],
    ['is_team_manager',                  format('public.%I(%L, %L)', 'is_team_manager', 'squad', t.id('coach')),                  'false'],
    ['is_team_member',                   format('public.%I(%L, %L)', 'is_team_member', 'squad', t.id('teen')),                    'false'],
    ['is_trainer_org_admin',             format('public.%I(%L, %L)', 'is_trainer_org_admin', t.id('guardian'), t.id('teen')),     'false'],
    ['is_trainer_org_member',            format('public.%I(%L, %L)', 'is_trainer_org_member', t.id('guardian'), t.id('teen')),    'false'],
    ['minor_messaging_allowed',          format('public.%I(%L, %L)', 'minor_messaging_allowed', t.id('guardian'), t.id('teen')),  'false'],
    ['minor_messaging_block',            format('public.%I(%L, %L)', 'minor_messaging_block', t.id('coach'), t.id('kid')),        'not_permitted:other'],
    ['minor_messaging_block_reason',     format('public.%I(%L, %L)', 'minor_messaging_block_reason', t.id('coach'), t.id('teen')), 'not_permitted'],
    ['platform_status',                  format('public.%I(%L)', 'platform_status', t.id('teen')),                                NULL],
    ['shares_team',                      format('public.%I(%L, %L)', 'shares_team', t.id('coach'), t.id('teen')),                 'false'],
    ['team_role_of',                     format('public.%I(%L, %L)', 'team_role_of', 'squad', t.id('coach')),                     NULL],
    ['trainer_profile_owned_by',         format('public.%I(%L, %L)', 'trainer_profile_owned_by', 'x', t.id('teen')),              'false']];
  _i int; r text;
BEGIN
  FOR _i IN 1 .. array_length(_cases, 1) LOOP
    EXECUTE 'SELECT (' || _cases[_i][2] || ')::text' INTO r;
    PERFORM t.eq(r, _cases[_i][3], 'stranger, graphql-style: ' || _cases[_i][1] || ' gives the fixed answer');
  END LOOP;
END $$;
SELECT set_config('request.path', '', true);

-- ---- F3: two-party helpers that reveal the OTHER person's state are denied even when the caller names themselves as one party
SELECT set_config('request.path', '/rpc/minor_messaging_block', true);
SELECT t.eq((SELECT public.minor_messaging_block(t.id('stranger'), t.id('teen'))), 'not_permitted:other', 'minor_messaging_block(me, minor): no age cohort or guardian control leaks to a party');
SELECT set_config('request.path', '/rpc/minor_messaging_block_reason', true);
SELECT t.eq((SELECT public.minor_messaging_block_reason(t.id('stranger'), t.id('teen'))), 'not_permitted', 'minor_messaging_block_reason(me, minor): the coarse reason only');
SELECT set_config('request.path', '/rpc/blocks_exist_between', true);
SELECT t.eq((SELECT public.blocks_exist_between(t.id('stranger'), t.id('teen'))), false, 'blocks_exist_between(me, X): a party does not learn that X blocked them');
SELECT t.as_user(t.id('guardian'));
SELECT set_config('request.path', '/rpc/minor_messaging_allowed', true);
SELECT t.eq((SELECT public.minor_messaging_allowed(t.id('guardian'), t.id('teen'))), false, 'minor_messaging_allowed(me, X): fixed answer, even for the guardian');
SELECT t.as_user(t.id('coach'));
SELECT set_config('request.path', '/rpc/shares_team', true);
SELECT t.eq((SELECT public.shares_team(t.id('coach'), t.id('teen'))), false, 'shares_team(me, X): a party does not learn that a hidden minor is on their team');
SELECT set_config('request.path', '/rpc/can_notify', true);
SELECT t.eq((SELECT public.can_notify(t.id('coach'), t.id('teen'))), false, 'can_notify(me, X): fixed answer through the API (the app asks with the service role)');
SELECT set_config('request.path', '', true);
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.blocks_exist_between(t.id('teen'), t.id('stranger')), false, 'and the blocker gets the fixed answer too (no party exemption at all)');
-- staff and the service role still get the true answers for those
SELECT t.as_user(t.id('modone'));
SELECT t.eq(public.shares_team(t.id('coach'), t.id('teen')), true, 'staff: shares_team is true');
SELECT t.eq(public.minor_messaging_block_reason(t.id('stranger'), t.id('teen')), 'teammates_only', 'staff: the real block reason');
SELECT t.reset();
SELECT t.eq(public.blocks_exist_between(t.id('stranger'), t.id('teen')), true, 'service role: blocks_exist_between is true');
SELECT t.eq(public.can_notify(t.id('coach'), t.id('teen')), true, 'service role: can_notify is true for host and participant');
SELECT t.eq(public.minor_messaging_allowed(t.id('guardian'), t.id('teen')), true, 'service role: a guardian may message their child');

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
SELECT t.as_user(t.id('coach'));
SELECT set_config('request.path', '/team_members', true);
SELECT t.ok(t.count(format('SELECT 1 FROM public.team_members WHERE user_id = %L', t.id('teen'))) = 1, 'a team manager still reads the minor''s roster row through row security');
SELECT set_config('request.path', '/rpc/create_direct_conversation', true);
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('teen')), 'and a function that calls the helpers by name still works (the coach may message the teammate where the rules allow)');
SELECT set_config('request.path', '/team_members', true);
SELECT t.eq(t.changed(format('UPDATE public.team_members SET role = %L WHERE team_id = %L AND user_id = %L', 'captain', 'squad', t.id('teen'))), 1,
            'the role-change trigger (repointed at private_sec.team_role_of) still lets the owner change a role');
SELECT set_config('request.path', '', true);
SELECT t.reset();
SELECT t.member('squad', 'other', 'player');
SELECT t.as_user(t.id('other'));
SELECT t.throws(format('UPDATE public.team_members SET role = %L WHERE team_id = %L AND user_id = %L', 'manager', 'squad', t.id('other')), 'NOT_TEAM_MANAGER',
                'and still stops a player promoting themselves');
SELECT t.reset();
SELECT t.eq(has_function_privilege('anon', 'public.is_team_member(text,uuid)', 'EXECUTE'), false, 'anonymous still cannot call the helpers');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.wrap_oracle_helpers()', 'EXECUTE'), false, 'and nobody but the service role can re-run the wrapping');
SELECT t.eq(private_sec.wrap_oracle_helpers(), 0, 're-running the wrapping is a no-op');

-- ---- F1: a later migration redefines public.<helper> with a SECURITY DEFINER body (as SEC-1 / PAY-1 do); re-running the wrap contains it again
SELECT p.oid AS priv_oid FROM pg_proc p WHERE p.oid = 'private_sec.can_notify(uuid,uuid)'::regprocedure \gset cn_
SELECT p.oid AS priv_oid FROM pg_proc p WHERE p.oid = 'private_sec.is_minor(uuid)'::regprocedure \gset im_
CREATE OR REPLACE FUNCTION public.can_notify(_caller uuid, _target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT _caller IS NOT NULL AND _target IS NOT NULL AND _target <> _caller $$;
CREATE OR REPLACE FUNCTION public.is_minor(_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT true $$;
SELECT t.eq(obj_description('public.can_notify(uuid,uuid)'::regprocedure, 'pg_proc'), 'oracle-wrapper', 'the old comment survives CREATE OR REPLACE (so it cannot be the wrapped test)');
SELECT t.eq(private_sec.wrap_oracle_helpers(), 2, 're-running the wrapping picks up both redefined helpers');
SELECT t.eq((SELECT NOT prosecdef AND prosrc LIKE '%private_sec.rpc_probe_denied%' FROM pg_proc WHERE oid = 'public.can_notify(uuid,uuid)'::regprocedure), true, 'public.can_notify is a wrapper again');
SELECT t.eq('private_sec.can_notify(uuid,uuid)'::regprocedure::oid, :'cn_priv_oid'::oid, 'the private copy kept its OID (replaced in place, not dropped)');
SELECT t.eq('private_sec.is_minor(uuid)'::regprocedure::oid, :'im_priv_oid'::oid, 'is_minor''s private copy kept its OID too');
SELECT t.eq((SELECT prosecdef AND proconfig = ARRAY['search_path=public'] AND pg_get_userbyid(proowner) = current_user FROM pg_proc WHERE oid = 'private_sec.can_notify(uuid,uuid)'::regprocedure), true,
            'and carries the new definition''s SECURITY DEFINER, search_path and owner');
SELECT t.eq(has_function_privilege('authenticated', 'public.can_notify(uuid,uuid)', 'EXECUTE') AND NOT has_function_privilege('anon', 'public.can_notify(uuid,uuid)', 'EXECUTE'), true,
            'grants follow the new definition (signed-in yes, anonymous no)');
SELECT t.as_user(t.id('stranger'));
SELECT set_config('request.path', '/rpc/can_notify', true);
SELECT t.eq((SELECT public.can_notify(t.id('stranger'), t.id('teen'))), false, 'a probe of the redefined can_notify is denied again');
SELECT set_config('request.path', '/rpc/is_minor', true);
SELECT t.eq((SELECT public.is_minor(t.id('coach'))), false, 'a probe of the redefined is_minor is denied again');
SELECT set_config('request.path', '', true);
SELECT t.reset();
CREATE FUNCTION public.t_definer_notify_probe(_a uuid, _b uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT public.can_notify(_a, _b) $$;
GRANT EXECUTE ON FUNCTION public.t_definer_notify_probe(uuid, uuid) TO authenticated;
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.t_definer_notify_probe(t.id('stranger'), t.id('teen')), true, 'a SECURITY DEFINER caller sees the NEW can_notify logic');
-- the team_members_manager_write policy calls is_minor by OID: with the new body (everyone is a minor) the manager may no longer add an adult
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.changed(format('INSERT INTO public.team_members (team_id, user_id, role) VALUES (%L, %L, %L)', 'squad', t.id('newbie'), 'player')), 0,
            'a policy sees the NEW is_minor logic (the private OID now runs the redefined body)');
SELECT t.reset();

-- ---- F2: a later migration drops and recreates a helper that ~160 policies depend on; re-running the wrap must not drop the private copy
SELECT p.oid AS priv_oid FROM pg_proc p WHERE p.oid = 'private_sec.is_team_member(text,uuid)'::regprocedure \gset tm_
DROP FUNCTION public.is_team_member(text, uuid);
CREATE FUNCTION public.is_team_member(_team text, _user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM public.team_members WHERE team_id = _team AND user_id = _user)
$$;
GRANT EXECUTE ON FUNCTION public.is_team_member(text, uuid) TO authenticated, service_role;
SELECT t.lives('SELECT private_sec.wrap_oracle_helpers()', 're-wrapping after a drop and recreate of a policy-dependent helper succeeds');
SELECT t.eq('private_sec.is_team_member(text,uuid)'::regprocedure::oid, :'tm_priv_oid'::oid, 'and the private copy the policies use keeps its OID');
SELECT t.eq((SELECT NOT prosecdef AND prosrc LIKE '%private_sec.rpc_probe_denied%' FROM pg_proc WHERE oid = 'public.is_team_member(text,uuid)'::regprocedure), true, 'public.is_team_member is a wrapper again');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(public.is_team_member('squad', t.id('teen')), false, 'a stranger''s probe is denied again');
SELECT t.as_user(t.id('coach'));
SELECT t.ok(t.count(format('SELECT 1 FROM public.team_members WHERE user_id = %L', t.id('teen'))) = 1, 'and the roster policies still work');
SELECT t.reset();

-- ---- a policy created later against a public helper name is repointed at the private copy
CREATE TABLE public.t_sec2_probe (id int PRIMARY KEY, owner_id uuid);
ALTER TABLE public.t_sec2_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY t_sec2_probe_read ON public.t_sec2_probe FOR SELECT TO authenticated USING (public.shares_team(auth.uid(), owner_id));
GRANT SELECT ON public.t_sec2_probe TO authenticated;
INSERT INTO public.t_sec2_probe VALUES (1, t.id('teen'));
SELECT private_sec.wrap_oracle_helpers();
SELECT t.ok((SELECT pg_get_expr(polqual, polrelid) LIKE '%private_sec.shares_team(%' FROM pg_policy WHERE polname = 't_sec2_probe_read'), 'a later policy naming public.shares_team is repointed at private_sec');
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count('SELECT 1 FROM public.t_sec2_probe'), 1, 'and it still decides with the true answer');
SELECT t.reset();
ROLLBACK;
