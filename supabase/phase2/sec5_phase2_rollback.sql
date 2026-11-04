-- SEC-5 PHASE 2 ROLLBACK — NOT A MIGRATION. NOT APPLIED. Undoes supabase/phase2/sec5_phase2_close_host_id_columns.sql only.
-- Re-grants SELECT on hosted_games.host_id / image / host_snapshot, join_requests.host_id and game_payment_settings.host_id to every API
-- role that can still read some column of that table (so exactly the roles phase 2 converted from a table-level grant), and drops the
-- restrictive game-cover storage policy. The table then answers select=*, host_id filters, RETURNING * and upserts as before phase 2;
-- the column-level grant form stays (equivalent for reads). It does NOT reopen what phase 1 (20261108110000) closed:
-- user_reports.reported_id and game_position_waitlist.reviewed_by stay closed, and the views, triggers and helpers stay.
-- Use it only if an old client population that cannot be retired breaks after phase 2; it reopens the direct read of a minor host's id.
-- To ship it, copy it into a new timestamped file in supabase/migrations (AGENTS.md). Tested by supabase/tests/511 (phase 2, then this,
-- then every probe must answer as in phase 1). No BEGIN/COMMIT here: the operator (or the test) owns the transaction.

DO $reopen$
DECLARE _t record; _role text;
BEGIN
  FOR _t IN SELECT * FROM (VALUES ('public.hosted_games'::regclass, ARRAY['host_id', 'image', 'host_snapshot']),
                                  ('public.join_requests'::regclass, ARRAY['host_id']),
                                  ('public.game_payment_settings'::regclass, ARRAY['host_id'])) v(rel, cols) LOOP
    FOREACH _role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_any_column_privilege(_role, _t.rel, 'SELECT') THEN
        EXECUTE format('GRANT SELECT (%s) ON %s TO %I', array_to_string(_t.cols, ', '), _t.rel, _role);
      END IF;
    END LOOP;
  END LOOP;
END
$reopen$;

DROP POLICY IF EXISTS "sec5 hidden organizer game covers" ON storage.objects;

DO $verify$
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.hosted_games', 'host_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.join_requests', 'host_id', 'SELECT')
     OR NOT has_column_privilege('authenticated', 'public.game_payment_settings', 'host_id', 'SELECT') THEN
    RAISE EXCEPTION 'SEC-5 phase 2 rollback: a column is still closed to authenticated';
  END IF;
END
$verify$;
