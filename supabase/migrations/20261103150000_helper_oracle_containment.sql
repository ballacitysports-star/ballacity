-- SEC-2: helper functions must not be oracles about other people (containment; independent of the open privacy stack).
--
-- WHY (independent review, 2026-11-05). About thirty SECURITY DEFINER predicates are executable by every signed-in account and accept an
-- arbitrary user id: is_team_member, is_team_manager, team_role_of, is_game_participant, shares_team, is_guardian_of, is_org_member,
-- blocks_exist_between, is_minor, age_verified, platform_status, minor_messaging_block, can_notify and more. Called directly through the API
-- (/rpc/<name>) they answer questions about any person, so an unrelated account can learn which teams and games a minor belongs to, who their
-- guardian is, whether they are a minor, and so on. Row security cannot help: the same functions are what row security calls.
--
-- WHAT THIS DOES, without changing a single function body or any row-security decision:
--   * Each function is MOVED (ALTER FUNCTION ... SET SCHEMA) to private_sec. Policies store function OIDs, so every existing policy keeps calling
--     the original, unchanged logic. private_sec is not exposed by the API.
--   * A thin public wrapper with the same name and signature takes its place for everything that calls it by name (other functions, the app, the
--     API). The wrapper answers normally, except when the call IS a direct API call of that function (the request path is /rpc/<name>, or the
--     statement text calls it), by a signed-in caller who is not one of the people asked about and is not staff. Then it returns a fixed, safe
--     answer (false / NULL / 'private' / a generic refusal) that reveals nothing.
--   * The service role (no auth.uid()) and internal callers are unaffected, so server code and every SECURITY DEFINER dependency keep working.
--   * private_sec.wrap_oracle_helpers() is idempotent and is re-run by later release migrations that redefine one of these functions by name
--     (R7 redefines minor_messaging_block and can_notify; SEC-1 re-runs it).
-- Verify in the sandbox that the API sets request.path (PostgREST does); the statement-text check covers it if not.
-- Rollback: forward-fix only. Not applied to production; needs separate approval.

CREATE OR REPLACE FUNCTION private_sec.rpc_probe_denied(_fn text, _parties uuid[])
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RETURN false; END IF;                       -- service role and internal maintenance
  IF _me = ANY (_parties) THEN RETURN false; END IF;              -- asking about yourself
  IF NOT (COALESCE(current_setting('request.path', true), '') = '/rpc/' || _fn
          OR current_query() ~* ('(^|[^a-z0-9_])' || _fn || '"?\s*\(')) THEN
    RETURN false;                                                 -- an internal call (a policy, a trigger, another function)
  END IF;
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _me AND role IN ('admin', 'moderator', 'superadmin')) THEN
    RETURN false;                                                 -- staff
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.rpc_probe_denied(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.rpc_probe_denied(text, uuid[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private_sec.wrap_oracle_helpers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _spec jsonb := '[
    {"sig":"age_verified(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"ai_analysis_allowed(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"blocks_exist_between(uuid,uuid)","parties":["_a","_b"],"deny":"false"},
    {"sig":"can_notify(uuid,uuid)","parties":["_caller","_target"],"deny":"false"},
    {"sig":"child_game_participation_allowed(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"default_profile_visibility_for(uuid)","parties":["_user"],"deny":"''private''"},
    {"sig":"game_payments_allowed(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"has_entitlement(uuid,text,text)","parties":["_user_id"],"deny":"false"},
    {"sig":"has_role(uuid,public.app_role)","parties":["_user_id"],"deny":"false"},
    {"sig":"is_conversation_participant(uuid,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_game_participant(text,uuid)","parties":["_user_id"],"deny":"false"},
    {"sig":"is_guardian_of(uuid,uuid)","parties":["_parent","_child"],"deny":"false"},
    {"sig":"is_gym_admin_text(text,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_managed_account(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_minor(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_moderator(uuid)","parties":["_user_id"],"deny":"false"},
    {"sig":"is_org_member(uuid,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_superadmin(uuid)","parties":["_user_id"],"deny":"false"},
    {"sig":"is_team_manager(text,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_team_member(text,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_trainer_org_admin(uuid,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"is_trainer_org_member(uuid,uuid)","parties":["_user"],"deny":"false"},
    {"sig":"minor_messaging_allowed(uuid,uuid)","parties":["_a","_b"],"deny":"false"},
    {"sig":"minor_messaging_block(uuid,uuid)","parties":["_a","_b"],"deny":"''not_permitted:other''"},
    {"sig":"minor_messaging_block_reason(uuid,uuid)","parties":["_a","_b"],"deny":"''not_permitted''"},
    {"sig":"platform_status(uuid)","parties":["_user"],"deny":"NULL"},
    {"sig":"shares_team(uuid,uuid)","parties":["_a","_b"],"deny":"false"},
    {"sig":"team_role_of(text,uuid)","parties":["_user"],"deny":"NULL"},
    {"sig":"trainer_profile_owned_by(text,uuid)","parties":["_user"],"deny":"false"}
  ]'::jsonb;
  _s jsonb; _sig text; _name text; _oid oid; _priv oid; _args text; _ret text; _names text[]; _call text; _parties text; _vol text;
  _roles text[] := ARRAY['anon', 'authenticated', 'service_role']; _r text; _n integer := 0;
BEGIN
  FOR _s IN SELECT * FROM jsonb_array_elements(_spec) LOOP
    _sig := _s ->> 'sig';
    _name := split_part(_sig, '(', 1);
    -- privileges of the original, read before it moves

    _oid := to_regprocedure('public.' || _sig);
    IF _oid IS NULL THEN CONTINUE; END IF;                                  -- not present in this database
    IF obj_description(_oid, 'pg_proc') = 'oracle-wrapper' THEN CONTINUE; END IF;   -- already wrapped
    _priv := to_regprocedure('private_sec.' || _sig);
    IF _priv IS NOT NULL THEN
      EXECUTE format('DROP FUNCTION private_sec.%s', _sig);                 -- an older moved copy; fails loudly if anything still depends on it
    END IF;
    _args := pg_get_function_arguments(_oid);
    _ret := pg_get_function_result(_oid);
    SELECT p.proargnames, CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END
      INTO _names, _vol FROM pg_proc p WHERE p.oid = _oid;
    EXECUTE format('ALTER FUNCTION public.%s SET SCHEMA private_sec', _sig);
    SELECT string_agg(format('%I', n), ', ') INTO _call FROM unnest(_names) n;
    SELECT string_agg(format('%I', p), ', ') INTO _parties FROM jsonb_array_elements_text(_s -> 'parties') p;
    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path TO '''' AS $w$ '
      || 'SELECT CASE WHEN private_sec.rpc_probe_denied(%L, ARRAY[%s]::uuid[]) THEN (%s)::%s ELSE private_sec.%I(%s) END $w$',
      _name, _args, _ret, _vol, _name, _parties, _s ->> 'deny', _ret, _name, _call);
    EXECUTE format('COMMENT ON FUNCTION public.%s IS %L', _sig, 'oracle-wrapper');
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', _sig);
    FOREACH _r IN ARRAY _roles LOOP
      IF has_function_privilege(_r, to_regprocedure('private_sec.' || _sig), 'EXECUTE') THEN
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO %I', _sig, _r);
      END IF;
    END LOOP;
    _n := _n + 1;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION private_sec.wrap_oracle_helpers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.wrap_oracle_helpers() TO service_role;

SELECT private_sec.wrap_oracle_helpers();
