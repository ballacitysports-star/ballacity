-- Assertion and impersonation helpers for the SQL tests in supabase/tests.
-- Loaded once by scripts/db-test.mjs after the migrations have been replayed.
--
-- Each test file runs inside BEGIN ... ROLLBACK, so nothing a test creates
-- outlives it. Assertions report with RAISE NOTICE ("ok - ..." / "not ok - ...");
-- the runner reads those lines. An unexpected SQL error aborts the file.
--
-- Setup runs as the connecting superuser, where auth.uid() is NULL: the same
-- footing as the service role, so the guard triggers let setup writes through.
-- t.as_user() / t.as_anon() then drop to the API roles with RLS and the guard
-- triggers applying exactly as they do for a real request.

CREATE SCHEMA t;
GRANT USAGE ON SCHEMA t TO PUBLIC;

CREATE FUNCTION t.ok(cond boolean, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF cond IS TRUE THEN RAISE NOTICE 'ok - %', name; ELSE RAISE NOTICE 'not ok - %', name; END IF;
END $$;

CREATE FUNCTION t.eq(got anycompatible, want anycompatible, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF got IS NOT DISTINCT FROM want THEN RAISE NOTICE 'ok - %', name;
  ELSE RAISE NOTICE 'not ok - % (got %, wanted %)', name, got, want; END IF;
END $$;

-- The statement must raise an error whose message contains `pattern`
-- (case-insensitive). It runs in a savepoint, so a half-done change is undone.
CREATE FUNCTION t.throws(stmt text, pattern text, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ILIKE '%' || pattern || '%' THEN RAISE NOTICE 'ok - %', name;
    ELSE RAISE NOTICE 'not ok - % (raised "%", wanted "%")', name, replace(SQLERRM, E'\n', ' '), pattern; END IF;
    RETURN;
  END;
  RAISE NOTICE 'not ok - % (no error was raised)', name;
END $$;

-- The statement must complete without error. Also in a savepoint.
CREATE FUNCTION t.lives(stmt text, name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'not ok - % (raised "%")', name, replace(SQLERRM, E'\n', ' ');
    RETURN;
  END;
  RAISE NOTICE 'ok - %', name;
END $$;

-- How many rows `query` returns to the current role, so row level security
-- applies. A role with no privilege on the table at all sees nothing: 0.
CREATE FUNCTION t.count(query text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM (%s) q', query) INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END $$;

-- How many rows an INSERT/UPDATE/DELETE changed for the current role. Row level
-- security that hides a row from a statement shows up as 0 here, not an error.
CREATE FUNCTION t.changed(stmt text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  EXECUTE stmt;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END $$;

-- A stable id for a person, so a test can name them without keeping a variable.
CREATE FUNCTION t.id(handle text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT md5('t:' || handle)::uuid
$$;

-- Create a confirmed user of a given age through the same path real sign-up
-- takes (auth.users -> handle_new_user, then a birthday -> age cohort). Handles
-- must be letters only: the minor handle-safety trigger rejects digits.
CREATE FUNCTION t.person(handle text, age int DEFAULT 30) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE uid uuid := t.id(handle);
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (uid, handle || '@example.test', now(),
          jsonb_build_object('display_name', initcap(handle), 'account_type', 'player'));
  INSERT INTO public.profile_birthdays (user_id, birthday)
  VALUES (uid, (current_date - make_interval(years => age, months => 1))::date);
  RETURN uid;
END $$;

-- An active, verified guardian link, plus an approved parental consent when the
-- child's age needs one, so the child's features are not locked.
CREATE FUNCTION t.guardian(parent text, child text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (t.id(parent), t.id(child), 'parent', 'active', now());
  IF public.parental_consent_required(public.age_cohort_of(t.id(child))) THEN
    INSERT INTO public.parental_consents (child_user_id, parent_user_id, status, method, approved_at, requested_at)
    VALUES (t.id(child), t.id(parent), 'approved', 'email_confirmation', now(), now())
    ON CONFLICT (child_user_id) DO UPDATE SET status = 'approved', approved_at = now();
  END IF;
  INSERT INTO public.child_controls (child_user_id, updated_by)
  VALUES (t.id(child), t.id(parent))
  ON CONFLICT (child_user_id) DO NOTHING;
END $$;

-- A finished, posted reel owned by `owner`, with the media path the ownership
-- guard requires (the owner's own folder). Its id is t.id('reel-' || tag).
CREATE FUNCTION t.reel(p_owner text, p_tag text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid := t.id('reel-' || p_tag);
BEGIN
  INSERT INTO public.highlight_reels (id, user_id, video_path, status, is_draft)
  VALUES (rid, t.id(p_owner), t.id(p_owner)::text || '/' || p_tag || '.mp4', 'completed', false);
  RETURN rid;
END $$;

-- A team owned by `owner` (the owner becomes a member through the same trigger
-- a real team gets), and a member added with a role.
CREATE FUNCTION t.team(p_team text, p_owner text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.teams (id, owner_id, kind, name, handle)
  VALUES (p_team, t.id(p_owner), 'team', initcap(p_team), p_team);
END $$;

CREATE FUNCTION t.member(p_team text, p_handle text, p_role public.team_role DEFAULT 'player') RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.team_members (team_id, user_id, role)
  VALUES (p_team, t.id(p_handle), p_role)
  ON CONFLICT (team_id, user_id) DO UPDATE SET role = EXCLUDED.role;
END $$;

-- Switch the session to a signed-in user / an anonymous visitor / the service
-- role, as a PostgREST request would. t.reset() goes back to the superuser.
CREATE FUNCTION t.as_user(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  EXECUTE 'SET LOCAL ROLE authenticated';
END $$;

CREATE FUNCTION t.as_anon() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  EXECUTE 'SET LOCAL ROLE anon';
END $$;

CREATE FUNCTION t.as_service() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  EXECUTE 'SET LOCAL ROLE service_role';
END $$;

CREATE FUNCTION t.reset() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claim.role', '', true);
END $$;
