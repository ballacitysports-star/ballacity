-- ROLLBACK for supabase/migrations/20261127110000_funnel_daily_history.sql (WP 5.3: the funnel's history).
-- NOT a migration. It unschedules 'snapshot-funnel-daily' (where pg_cron has it), drops private_sec.snapshot_funnel_daily,
-- private_sec.schedule_funnel_snapshot, the table private_sec.funnel_daily and its check function
-- private_sec.funnel_metrics_are_counts, and the trigger funnel_forget_lowered_adult_trg on public.profiles with its function
-- private_sec.funnel_forget_lowered_adult. superadmin_funnel (WP 5.2) keeps working: without the table it computes every week
-- live, so weeks whose posts, invites or roster rows were deleted since show the lower live numbers again.
-- The stored daily totals cannot be rebuilt once dropped (the rows they were counted from may be gone), so the table always
-- has rows after the migration (it takes its first snapshot at once) and this refuses to drop them until they are exported.
-- Export first, then set the flag:
--     \copy (SELECT day, metrics, computed_at FROM private_sec.funnel_daily ORDER BY day) TO 'funnel_daily.csv' WITH CSV HEADER
--     SET app.funnel_daily_exported = 'yes';
-- It stops, changing nothing, unless the functions and the trigger still have the definitions 20261127110000 gave them, no
-- other trigger runs the trigger function, and the table is still
-- the one it created: the same three columns (types, NOT NULL, defaults), constraints and index, row security on, and no
-- policy, trigger, rule or privilege for anyone but its owner (a later change, such as an added column the export above would
-- not copy, or a grant or policy someone relied on, needs a person to look first), and nothing else names a function it drops.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_funnel_daily_history_rollback = 'yes';
-- Locks: DROP TRIGGER takes ACCESS EXCLUSIVE on public.profiles, which nearly every request reads. It is the last change before
-- COMMIT, so the lock is held for milliseconds, and its wait is limited to 200 ms so a busy moment fails cleanly (nothing
-- changes) instead of queueing readers behind it: run it again. Nothing else here locks an app table.
BEGIN;
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['private_sec.snapshot_funnel_daily(timestamptz)', 'd95005dc0b5d0e77ade6c72cbbaa1db4'],
    ['private_sec.schedule_funnel_snapshot()',         '2d5dcb6428abd5e8afcefc7ae199d577'],
    ['private_sec.funnel_metrics_are_counts(jsonb)',   'aa7d2bf080ad0e70dcc236a625202285'],
    ['private_sec.funnel_forget_lowered_adult()',      '121e9a543e18354fc0e2cbdfd2c4d293']];
  _callee_re CONSTANT text :=
    '\m(snapshot_funnel_daily|schedule_funnel_snapshot|funnel_metrics_are_counts|funnel_forget_lowered_adult)\M';
  _guarded oid[] := '{}';
  _rel oid := to_regclass('private_sec.funnel_daily');
  _got text;
  _rows bigint;
  i int;
BEGIN
  IF current_setting('app.confirm_funnel_daily_history_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: the funnel''s history stops being kept and its stored totals are deleted. Set app.confirm_funnel_daily_history_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261127110000 created (md5 %). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    _guarded := _guarded || to_regprocedure(_want[i][1])::oid;
  END LOOP;
  SELECT string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid)), ',' ORDER BY t.tgname)
    INTO _got
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE t.tgfoid = 'private_sec.funnel_forget_lowered_adult()'::regprocedure AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'public.profiles.funnel_forget_lowered_adult_trg=3483ed04dd43af0bab8886cac3377e7a' THEN
    RAISE EXCEPTION 'Refusing to run: the profiles trigger is not the one 20261127110000 created (%).', _got;
  END IF;
  SELECT concat_ws(' | ',
           (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':'
                              || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
              FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
             WHERE a.attrelid = _rel AND a.attnum > 0 AND NOT a.attisdropped),
           (SELECT string_agg(c.conname || '=' || md5(pg_get_constraintdef(c.oid)), ',' ORDER BY c.conname)
              FROM pg_constraint c WHERE c.conrelid = _rel),
           (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_get_indexdef(i.indexrelid))
              FROM pg_index i WHERE i.indrelid = _rel),
           (SELECT 'rls=' || c.relrowsecurity || ',force=' || c.relforcerowsecurity FROM pg_class c WHERE c.oid = _rel),
           (SELECT 'policies=' || count(*) FROM pg_policy p WHERE p.polrelid = _rel),
           (SELECT 'triggers=' || count(*) FROM pg_trigger t WHERE t.tgrelid = _rel AND NOT t.tgisinternal),
           (SELECT 'rules=' || count(*) FROM pg_rewrite r WHERE r.ev_class = _rel),
           (SELECT 'grants=' || count(*) FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x
             WHERE c.oid = _rel AND x.grantee <> c.relowner),
           (SELECT 'column_grants=' || count(*) FROM pg_attribute a WHERE a.attrelid = _rel AND a.attacl IS NOT NULL))
    INTO _got;
  IF _rel IS NULL OR _got IS DISTINCT FROM
     'day:date:true:,metrics:jsonb:true:,computed_at:timestamp with time zone:true:now()'
     || ' | funnel_daily_counts_only=c2cce0e00c4734d660cc1b78ac344f43,funnel_daily_pkey=92fa4f38985e91948bddd58d6898a743'
     || ' | CREATE UNIQUE INDEX funnel_daily_pkey ON private_sec.funnel_daily USING btree (day)'
     || ' | rls=true,force=false | policies=0 | triggers=0 | rules=0 | grants=0 | column_grants=0' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.funnel_daily is not the table 20261127110000 created (%). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'cron')
     AND p.oid <> ALL (_guarded)
     AND p.prosrc ~ _callee_re;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names a function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
  SELECT count(*) INTO _rows FROM private_sec.funnel_daily;
  IF _rows > 0 AND current_setting('app.funnel_daily_exported', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.funnel_daily holds % days of totals that cannot be rebuilt. Export them first (see the header), then set app.funnel_daily_exported=yes.', _rows;
  END IF;
END
$guard$;

DO $cron$
DECLARE
  _scheduled boolean := false;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-funnel-daily')$q$ INTO _scheduled;
  END IF;
  IF _scheduled THEN
    EXECUTE $q$SELECT cron.unschedule('snapshot-funnel-daily')$q$;
  END IF;
END
$cron$;

DROP FUNCTION private_sec.schedule_funnel_snapshot();
DROP FUNCTION private_sec.snapshot_funnel_daily(timestamptz);
DROP TABLE private_sec.funnel_daily;
DROP FUNCTION private_sec.funnel_metrics_are_counts(jsonb);
-- Last, so the lock on public.profiles is held only until COMMIT.
SET LOCAL lock_timeout = '200ms';
DROP TRIGGER funnel_forget_lowered_adult_trg ON public.profiles;
DROP FUNCTION private_sec.funnel_forget_lowered_adult();

COMMIT;
