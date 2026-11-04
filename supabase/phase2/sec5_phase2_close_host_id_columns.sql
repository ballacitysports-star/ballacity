-- SEC-5 PHASE 2 — NOT A MIGRATION. NOT APPLIED. Kept outside supabase/migrations so no replay, CLI or sync picks it up.
-- Closes the direct read of the organizer's account id: after it, anon and authenticated can no longer SELECT hosted_games.host_id,
-- hosted_games.image (a custom cover's path starts with the host's account id) or join_requests.host_id. Every other column stays readable,
-- row security is unchanged, INSERT/UPDATE/DELETE grants are unchanged, and policies keep using host_id (policies are not subject to column
-- grants). Clients read these values through public.hosted_games_public / public.join_requests_visible (20261108110000), which mask them for
-- unrelated viewers of a game whose host is not a confirmed adult. Realtime (walrus) drops columns the subscriber cannot SELECT, so payloads
-- lose them too.
-- Gate (docs/privacy/sec5-public-organizer-ref.md, "Compatibility plan"): 20261108110000 applied; the client build that reads the views has
-- been live for the adoption window (old cached bundles and Lovable previews still send select=* to hosted_games and would get a
-- permission error); owner approval; sandbox rehearsal first. To ship it, copy it into a new timestamped file in supabase/migrations
-- (AGENTS.md: every live change is a migration file). Tested by supabase/tests/510_public_organizer_ref.test.sql, which applies this file
-- inside a rolled-back transaction.
-- No BEGIN/COMMIT here: the operator (or the test) owns the transaction. Set a lock_timeout before running it.

DO $guard$
BEGIN
  IF to_regclass('public.hosted_games_public') IS NULL OR to_regclass('public.join_requests_visible') IS NULL
     OR to_regprocedure('private_sec.game_organizer_for_caller(text)') IS NULL THEN
    RAISE EXCEPTION 'SEC-5 phase 2: the read views are missing; apply 20261108110000_public_organizer_ref first';
  END IF;
END
$guard$;

-- A table-level SELECT covers every column, so a column revoke alone does nothing: replace it with a grant on each column that stays open.
-- The column lists are read from the catalog, so a column added since this file was written stays readable.
DO $close$
DECLARE _cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO _cols
    FROM pg_attribute
   WHERE attrelid = 'public.hosted_games'::regclass AND attnum > 0 AND NOT attisdropped AND attname NOT IN ('host_id', 'image');
  EXECUTE 'REVOKE SELECT ON public.hosted_games FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.hosted_games TO anon, authenticated', _cols);

  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO _cols
    FROM pg_attribute
   WHERE attrelid = 'public.join_requests'::regclass AND attnum > 0 AND NOT attisdropped AND attname <> 'host_id';
  EXECUTE 'REVOKE SELECT ON public.join_requests FROM anon, authenticated';
  EXECUTE format('GRANT SELECT (%s) ON public.join_requests TO authenticated', _cols);
END
$close$;

-- Fail the transaction if anything still grants the closed columns (a stray column grant would survive the table-level revoke).
DO $verify$
BEGIN
  IF has_column_privilege('authenticated', 'public.hosted_games', 'host_id', 'SELECT')
     OR has_column_privilege('anon', 'public.hosted_games', 'host_id', 'SELECT')
     OR has_column_privilege('authenticated', 'public.hosted_games', 'image', 'SELECT')
     OR has_column_privilege('anon', 'public.hosted_games', 'image', 'SELECT')
     OR has_column_privilege('authenticated', 'public.join_requests', 'host_id', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-5 phase 2: a closed column is still readable by an API role (check column grants and PUBLIC)';
  END IF;
END
$verify$;

-- Storage: a game cover's folder is its uploader's account id, and the existing read policy lets any signed-in account read (sign, list) the
-- cover of any public game. For a host who is not a confirmed adult that listing is the account id again, so only the uploader and people
-- who may know a minor's name keep it (the same rule as the view). Other buckets are untouched.
DROP POLICY IF EXISTS "sec5 hidden organizer game covers" ON storage.objects;
CREATE POLICY "sec5 hidden organizer game covers" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'game-covers' OR NOT private_sec.game_cover_hidden_for_caller(name));
