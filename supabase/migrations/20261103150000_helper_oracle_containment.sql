-- SEC-2: helper functions must not be oracles about other people (containment; independent of the open privacy stack).
--
-- WHY (independent review, 2026-11-05). About thirty SECURITY DEFINER predicates are executable by every signed-in account and accept an
-- arbitrary user id: is_team_member, is_team_manager, team_role_of, is_game_participant, shares_team, is_guardian_of, is_org_member,
-- blocks_exist_between, is_minor, age_verified, platform_status, minor_messaging_block, can_notify and more. Called directly through the API
-- (/rpc/<name>, or a GraphQL query field) they answer questions about any person, so an unrelated account can learn which teams and games a
-- minor belongs to, who their guardian is, whether they are a minor, and so on. Row security cannot help: the same functions are what row
-- security calls.
--
-- WHAT THIS DOES, without changing a single function body or any row-security decision:
--   * Each function is MOVED (ALTER FUNCTION ... SET SCHEMA) to private_sec. Policies store function OIDs, so every existing policy keeps calling
--     the original, unchanged logic. private_sec is not exposed by the API.
--   * A thin public SECURITY INVOKER wrapper with the same name and signature takes its place for everything that calls it by name (other
--     functions, the app, the API). The wrapper passes its own current_user to private_sec.rpc_probe_denied. The check is STRUCTURAL: when the
--     wrapper runs as the API role itself (current_user = 'authenticated' or 'anon'), the call came straight from a client (PostgREST /rpc, a
--     GraphQL field, or SECURITY INVOKER code running for the client); when it runs inside a SECURITY DEFINER function, current_user is that
--     function's owner and the call is internal. A direct client call by someone who is not staff gets a fixed, safe answer (false / NULL /
--     'private' / a generic refusal) that reveals nothing, unless the helper only answers about the caller and the caller is that party.
--   * Two-party helpers whose answer reveals the OTHER party's private state (minor_messaging_block, minor_messaging_block_reason,
--     minor_messaging_allowed, blocks_exist_between, shares_team, can_notify) have no party exemption: every direct client call by a non-staff
--     account gets the fixed answer. The app calls them only from server code with the service role.
--   * The service role (no auth.uid()), staff and every SECURITY DEFINER caller are unaffected. The one SECURITY INVOKER function that named a
--     helper (guard_team_member_role_change, a trigger) is repointed at private_sec below, so its behaviour does not change.
--
-- LATER MIGRATIONS THAT REDEFINE ONE OF THESE HELPERS (SEC-1, PAY-1, R7, ...):
--   * Prefer CREATE OR REPLACE FUNCTION private_sec.<helper>(...) for a new body. It keeps the OID every policy points at, and the public wrapper
--     needs nothing.
--   * If a migration instead redefines public.<helper> (CREATE OR REPLACE, or DROP + CREATE), it must re-run SELECT private_sec.wrap_oracle_helpers().
--     That copies the new body into the EXISTING private_sec.<helper> with CREATE OR REPLACE (never DROP: about 160 policies depend on these
--     OIDs), with the new definition's owner and grants, rebuilds the public wrapper in place, and repoints any policy that was created against
--     the public name. A helper counts as wrapped only when public.<helper> is SECURITY INVOKER and calls private_sec.rpc_probe_denied; a
--     comment, which survives CREATE OR REPLACE, is not evidence.
--   * A redefinition that renames a parameter or changes the return type cannot replace the private copy in place; wrap_oracle_helpers() then
--     stops with an error rather than drop the copy the policies use. Do that change as CREATE OR REPLACE on private_sec, in two steps if needed.
--   * New SECURITY INVOKER functions, views or triggers must call private_sec.<helper>, not the public wrapper (480 checks this).
-- Production prerequisites: private_sec must not be an exposed API schema, and pg_graphql must be disabled or must not reflect public functions
-- (see docs/privacy/sec2-helper-oracle-containment.md). Rollback: forward-fix only. Not applied to production; needs separate approval.

-- An earlier draft of this file had a two-argument form; nothing depends on it.
DROP FUNCTION IF EXISTS private_sec.rpc_probe_denied(text, uuid[]);

-- _invoker is the wrapper's current_user (this function is SECURITY DEFINER, so it cannot read it itself). Passing a different value only changes
-- the answer the caller gets about themselves, so it needs no protection.
CREATE OR REPLACE FUNCTION private_sec.rpc_probe_denied(_fn text, _parties uuid[], _invoker name)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _invoker = 'anon' THEN RETURN true; END IF;                                  -- an anonymous client is never a party or staff
  IF _me IS NULL THEN RETURN false; END IF;                                       -- service role and internal maintenance
  IF _invoker IS DISTINCT FROM 'authenticated' THEN RETURN false; END IF;         -- inside a SECURITY DEFINER function (a policy, trigger, RPC)
  IF _me = ANY (_parties) THEN RETURN false; END IF;                              -- asking only about yourself
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _me AND role IN ('admin', 'moderator', 'superadmin')) THEN
    RETURN false;                                                                 -- staff
  END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION private_sec.rpc_probe_denied(text, uuid[], name) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.rpc_probe_denied(text, uuid[], name) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private_sec.wrap_oracle_helpers()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  -- "parties": arguments naming the people asked about. A caller who is one of them gets the true answer. An empty list means no party
  -- exemption, for helpers whose answer reveals the other person's private state (age cohort, guardian controls, blocks, teams, links).
  _spec jsonb := '[
    {"sig":"age_verified(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"ai_analysis_allowed(uuid)","parties":["_user"],"deny":"false"},
    {"sig":"blocks_exist_between(uuid,uuid)","parties":[],"deny":"false"},
    {"sig":"can_notify(uuid,uuid)","parties":[],"deny":"false"},
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
    {"sig":"minor_messaging_allowed(uuid,uuid)","parties":[],"deny":"false"},
    {"sig":"minor_messaging_block(uuid,uuid)","parties":[],"deny":"''not_permitted:other''"},
    {"sig":"minor_messaging_block_reason(uuid,uuid)","parties":[],"deny":"''not_permitted''"},
    {"sig":"platform_status(uuid)","parties":["_user"],"deny":"NULL"},
    {"sig":"shares_team(uuid,uuid)","parties":[],"deny":"false"},
    {"sig":"team_role_of(text,uuid)","parties":["_user"],"deny":"NULL"},
    {"sig":"trainer_profile_owned_by(text,uuid)","parties":["_user"],"deny":"false"}
  ]'::jsonb;
  _names_all text[];
  _s jsonb; _sig text; _name text; _pub oid; _priv oid; _owner name; _def text; _wrapped boolean; _moved boolean;
  _args text; _ret text; _argnames text[]; _call text; _parties text; _vol text;
  _roles text[] := ARRAY['anon', 'authenticated', 'service_role']; _r text; _n integer := 0;
  _pol record; _qual text; _check text; _nm text;
BEGIN
  SELECT array_agg(split_part(e ->> 'sig', '(', 1)) INTO _names_all FROM jsonb_array_elements(_spec) e;

  FOR _s IN SELECT * FROM jsonb_array_elements(_spec) LOOP
    _sig := _s ->> 'sig';
    _name := split_part(_sig, '(', 1);
    _pub := to_regprocedure('public.' || _sig);
    _priv := to_regprocedure('private_sec.' || _sig);
    IF _pub IS NULL THEN CONTINUE; END IF;                     -- not present in this database (or deliberately removed from public)

    SELECT NOT p.prosecdef AND p.prosrc LIKE '%private_sec.rpc_probe_denied%' INTO _wrapped FROM pg_proc p WHERE p.oid = _pub;
    _moved := false;

    IF NOT _wrapped THEN
      -- public.<sig> holds a real body: the original on first run, or a later migration's redefinition.
      IF _priv IS NULL THEN
        EXECUTE format('ALTER FUNCTION public.%s SET SCHEMA private_sec', _sig);          -- keeps the OID the policies point at
      ELSE
        -- Never drop the private copy (policies depend on its OID). Replace its body in place with the new definition, then make it match the
        -- new definition's owner and grants.
        _def := pg_get_functiondef(_pub);
        IF _def !~ ('^CREATE OR REPLACE FUNCTION public\.' || _name || '\(') THEN
          RAISE EXCEPTION 'wrap_oracle_helpers: unexpected definition header for public.%', _sig;
        END IF;
        _def := regexp_replace(_def, '^CREATE OR REPLACE FUNCTION public\.', 'CREATE OR REPLACE FUNCTION private_sec.');
        BEGIN
          EXECUTE _def;
        EXCEPTION WHEN OTHERS THEN
          RAISE EXCEPTION 'wrap_oracle_helpers: cannot move the new body of public.% into private_sec in place: %', _sig, SQLERRM
            USING HINT = 'Redefine it as CREATE OR REPLACE FUNCTION private_sec.' || _sig || ' instead; the private copy is never dropped.';
        END;
        SELECT pg_get_userbyid(p.proowner) INTO _owner FROM pg_proc p WHERE p.oid = _pub;
        EXECUTE format('ALTER FUNCTION private_sec.%s OWNER TO %I', _sig, _owner);
        EXECUTE format('REVOKE ALL ON FUNCTION private_sec.%s FROM PUBLIC, anon, authenticated, service_role', _sig);
        FOREACH _r IN ARRAY _roles LOOP
          IF has_function_privilege(_r, _pub, 'EXECUTE') THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION private_sec.%s TO %I', _sig, _r);
          END IF;
        END LOOP;
      END IF;
      _moved := true;
      _n := _n + 1;
    END IF;

    -- (Re)build the public wrapper from the private copy. CREATE OR REPLACE keeps the public OID when one is left, so nothing that points at it
    -- breaks; CREATE is used after the first-run move.
    _priv := to_regprocedure('private_sec.' || _sig);
    IF _priv IS NULL THEN
      RAISE EXCEPTION 'wrap_oracle_helpers: public.% is a wrapper but private_sec.% is missing', _sig, _sig;
    END IF;
    _args := pg_get_function_arguments(_priv);
    _ret := pg_get_function_result(_priv);
    SELECT p.proargnames, CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END
      INTO _argnames, _vol FROM pg_proc p WHERE p.oid = _priv;
    SELECT string_agg(format('%I', n), ', ') INTO _call FROM unnest(_argnames) n;
    SELECT string_agg(format('%I', p), ', ') INTO _parties FROM jsonb_array_elements_text(_s -> 'parties') p;
    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE sql %s SECURITY INVOKER SET search_path TO '''' AS $w$ '
      || 'SELECT CASE WHEN private_sec.rpc_probe_denied(%L, ARRAY[%s]::uuid[], current_user) THEN (%s)::%s ELSE private_sec.%I(%s) END $w$',
      _name, _args, _ret, _vol, _name, COALESCE(_parties, ''), _s ->> 'deny', _ret, _name, _call);
    EXECUTE format('COMMENT ON FUNCTION public.%s IS %L', _sig, 'oracle-wrapper');
    IF _moved THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated, service_role', _sig);
      FOREACH _r IN ARRAY _roles LOOP
        IF has_function_privilege(_r, _priv, 'EXECUTE') THEN
          EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO %I', _sig, _r);
        END IF;
      END LOOP;
    END IF;

    -- A policy created against the public name (by a later migration) would run the wrapper as the API role and get the fixed answer.
    -- Repoint it at the private copy, as every older policy already is.
    _pub := to_regprocedure('public.' || _sig);
    FOR _pol IN
      SELECT DISTINCT pol.oid, pol.polname, pol.polrelid, pol.polqual, pol.polwithcheck
      FROM pg_depend d JOIN pg_policy pol ON pol.oid = d.objid
      WHERE d.classid = 'pg_policy'::regclass AND d.refclassid = 'pg_proc'::regclass AND d.refobjid = _pub
    LOOP
      _qual := pg_get_expr(_pol.polqual, _pol.polrelid);
      _check := pg_get_expr(_pol.polwithcheck, _pol.polrelid);
      FOREACH _nm IN ARRAY _names_all LOOP
        _qual := regexp_replace(_qual, '(^|[^a-z0-9_."])public\.(' || _nm || ')\(', '\1private_sec.\2(', 'g');
        _check := regexp_replace(_check, '(^|[^a-z0-9_."])public\.(' || _nm || ')\(', '\1private_sec.\2(', 'g');
      END LOOP;
      IF _qual IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON %s USING (%s)', _pol.polname, _pol.polrelid::regclass, _qual);
      END IF;
      IF _check IS NOT NULL THEN
        EXECUTE format('ALTER POLICY %I ON %s WITH CHECK (%s)', _pol.polname, _pol.polrelid::regclass, _check);
      END IF;
    END LOOP;
  END LOOP;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION private_sec.wrap_oracle_helpers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.wrap_oracle_helpers() TO service_role;

SELECT private_sec.wrap_oracle_helpers();

-- The one SECURITY INVOKER function that called a wrapped helper by name (a trigger on team_members, running as the client). It asks about the
-- caller only, so the wrapper would answer it truly, but internal code calls the private copy directly so its behaviour never depends on the
-- wrapper. Body otherwise unchanged.
CREATE OR REPLACE FUNCTION public.guard_team_member_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid();
BEGIN
  IF NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;

  -- `transfer_team_ownership` opens this for the length of its own transaction.
  IF coalesce(current_setting('app.team_transfer', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF NEW.role = 'owner' OR OLD.role = 'owner' THEN
    RAISE EXCEPTION 'OWNER_ROLE_FIXED';
  END IF;

  -- coalesce to '' first: a non-member yields NULL, and `NULL NOT IN (...)` is
  -- NULL, which plpgsql treats as false — the check would pass silently.
  IF coalesce(private_sec.team_role_of(NEW.team_id, _me)::text, '') NOT IN ('owner','manager') THEN
    RAISE EXCEPTION 'NOT_TEAM_MANAGER';
  END IF;

  RETURN NEW;
END $function$;
