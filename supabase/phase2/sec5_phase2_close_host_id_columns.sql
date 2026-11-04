-- SEC-5 PHASE 2 — NOT A MIGRATION. NOT APPLIED. Kept outside supabase/migrations so no replay, CLI or sync picks it up.
-- Closes the direct read of the organizer's account id: after it, anon and authenticated can no longer SELECT hosted_games.host_id,
-- hosted_games.image (a custom cover's path starts with the host's account id), hosted_games.host_snapshot (a game written before the
-- neutral-snapshot rule can still hold a minor's name and username), join_requests.host_id or game_payment_settings.host_id (for a free
-- game the settings holder is the host). Every other column stays readable, row security is unchanged, INSERT/UPDATE/DELETE grants are
-- unchanged, and policies keep using host_id (policies are not subject to column grants). Clients read these values through
-- public.hosted_games_public / public.join_requests_visible / public.game_payment_settings_visible (20261108110000), which mask them for
-- unrelated viewers when the host is not a confirmed adult. Realtime (walrus) drops columns the subscriber cannot SELECT, so payloads lose
-- them too. (user_reports.reported_id and game_position_waitlist.reviewed_by are closed by 20261108110000 itself; verified again below.)
-- Gate (docs/privacy/sec5-public-organizer-ref.md, "Compatibility plan"): 20261108110000 applied; the client build that reads the views has
-- been live for the adoption window (old cached bundles and Lovable previews still send select=* to hosted_games and would get a
-- permission error); owner approval; sandbox rehearsal first. To ship it, copy it into a new timestamped file in supabase/migrations
-- (AGENTS.md: every live change is a migration file). Tested by supabase/tests/510_public_organizer_ref.test.sql, which applies this file
-- inside a rolled-back transaction.
-- No BEGIN/COMMIT here: the operator (or the test) owns the transaction. Set a lock_timeout before running it.

DO $guard$
BEGIN
  IF to_regclass('public.hosted_games_public') IS NULL OR to_regclass('public.join_requests_visible') IS NULL
     OR to_regclass('public.game_payment_settings_visible') IS NULL
     OR to_regprocedure('private_sec.game_organizer_for_caller(text)') IS NULL
     OR to_regprocedure('private_sec.payment_settings_holder_for_caller(uuid)') IS NULL THEN
    RAISE EXCEPTION 'SEC-5 phase 2: the read views are missing; apply 20261108110000_public_organizer_ref first';
  END IF;
END
$guard$;

-- A table-level SELECT covers every column, so a column revoke alone does nothing: replace it with a grant on each column that stays open,
-- for each API role that has the table-level grant today. The column lists are read from the catalog, so a column added since this file
-- was written stays readable.
DO $close$
DECLARE _t record; _cols text; _role text;
BEGIN
  FOR _t IN SELECT * FROM (VALUES ('public.hosted_games'::regclass, ARRAY['host_id', 'image', 'host_snapshot']),
                                  ('public.join_requests'::regclass, ARRAY['host_id']),
                                  ('public.game_payment_settings'::regclass, ARRAY['host_id'])) v(rel, closed) LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO _cols
      FROM pg_attribute WHERE attrelid = _t.rel AND attnum > 0 AND NOT attisdropped AND attname <> ALL (_t.closed);
    FOREACH _role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(_role, _t.rel, 'SELECT') THEN
        EXECUTE format('REVOKE SELECT ON %s FROM %I', _t.rel, _role);
        EXECUTE format('GRANT SELECT (%s) ON %s TO %I', _cols, _t.rel, _role);
      END IF;
      IF EXISTS (SELECT 1 FROM unnest(_t.closed) c WHERE has_column_privilege(_role, _t.rel, c, 'SELECT')) THEN
        EXECUTE format('REVOKE SELECT (%s) ON %s FROM %I', array_to_string(_t.closed, ', '), _t.rel, _role);
      END IF;
    END LOOP;
  END LOOP;
END
$close$;

-- Fail the transaction if anything still grants a closed column (a stray column grant, or a grant to PUBLIC, would survive the revoke).
DO $verify$
DECLARE _bad text;
BEGIN
  SELECT string_agg(format('%s.%s to %s', v.rel, v.col, r.role), ', ') INTO _bad
    FROM (VALUES ('public.hosted_games', 'host_id'), ('public.hosted_games', 'image'), ('public.hosted_games', 'host_snapshot'),
                 ('public.join_requests', 'host_id'), ('public.game_payment_settings', 'host_id'),
                 ('public.user_reports', 'reported_id'), ('public.game_position_waitlist', 'reviewed_by')) v(rel, col)
   CROSS JOIN (VALUES ('anon'), ('authenticated')) r(role)
   WHERE has_column_privilege(r.role, v.rel, v.col, 'SELECT');
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'SEC-5 phase 2: a closed column is still readable by an API role: % (check column grants and PUBLIC)', _bad;
  END IF;
END
$verify$;

-- Storage: a game cover's folder is its uploader's account id, and the existing read policy lets any signed-in account read (sign, list) the
-- cover of any public game. For a host who is not a confirmed adult that listing is the account id again, so only the uploader and people
-- who may know a minor's name keep it (the same rule as the view). Other buckets are untouched.
DROP POLICY IF EXISTS "sec5 hidden organizer game covers" ON storage.objects;
CREATE POLICY "sec5 hidden organizer game covers" ON storage.objects AS RESTRICTIVE FOR SELECT TO authenticated
  USING (bucket_id <> 'game-covers' OR NOT private_sec.game_cover_hidden_for_caller(name));
