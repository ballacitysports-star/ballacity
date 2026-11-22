-- ROLLBACK for supabase/migrations/20261127100000_superadmin_funnel.sql (WP 5.2: the pilot funnel).
-- NOT a migration. It drops public.superadmin_funnel, public.superadmin_set_funnel_minor_counts, the trigger
-- a0_app_settings_funnel_minor_counts_guard on public.app_settings and the private helpers (private_sec.funnel_report,
-- funnel_day_metrics, funnel_week_summary, funnel_mask, funnel_rate, funnel_frozen_before, funnel_pilot_start,
-- funnel_minor_counts_enabled, guard_funnel_minor_counts), and deletes the two settings rows the migration added
-- ('funnel_minor_counts' and 'funnel_pilot_start'). It prints both values first, so a pilot start date that was set can be put
-- back by hand; the admin audit log keeps every change of the under-18 switch. No other row changes: the funnel only read.
-- The app keeps working after it: the Funnel card shows "Not available yet" when superadmin_funnel is missing (PGRST202).
-- Roll back WP 5.3 (docs/rollbacks/20261127110000_funnel_daily_history.down.sql) first: its snapshot calls these helpers, so
-- this stops while private_sec.funnel_daily or private_sec.snapshot_funnel_daily exists.
-- It stops, changing nothing, unless every object it drops still has the definition 20261127100000 gave it (function bodies,
-- the trigger, the grants on the two public functions) and nothing else names a function it drops (a later change needs a
-- person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_superadmin_funnel_rollback = 'yes';
-- Locks: DROP TRIGGER takes ACCESS EXCLUSIVE on public.app_settings, which the app reads for its flags; the change takes
-- milliseconds, and the lock wait is limited to 2 s so a busy moment fails cleanly instead of queueing readers.
BEGIN;
DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.superadmin_funnel(date,date)',                                 '14cbfe207187251a8526c8134c8c29a0'],
    ['public.superadmin_set_funnel_minor_counts(boolean,text)',             'd4cb374352ffafb4372c196c50b2e77f'],
    ['private_sec.funnel_minor_counts_enabled()',                           '95a40e26a954e485d789f59831f9591b'],
    ['private_sec.funnel_pilot_start()',                                    '0d424aa4f623c8953429cf01c4d0de2e'],
    ['private_sec.guard_funnel_minor_counts()',                             'eb8ac73a5b67b6e85108e1665e282c18'],
    ['private_sec.funnel_frozen_before(timestamptz)',                       'df3ef2afea94823403edcf1203f57a16'],
    ['private_sec.funnel_day_metrics(date,date,timestamptz,boolean)',       '2cd113265d0951774a5f83f23975735c'],
    ['private_sec.funnel_mask(bigint)',                                     'aa5cf1a48cbd26b4c7c10c4719976410'],
    ['private_sec.funnel_rate(bigint,bigint)',                              'bdfbba8e0f4f6dc5f09e2f02a6a872b2'],
    ['private_sec.funnel_week_summary(jsonb)',                              '3c0b88fc9f89096174c3e3e58143fadb'],
    ['private_sec.funnel_report(date,date,timestamptz,boolean)',            '5adca7855112cfcb02df0d613e7ef4af']];
  _acls CONSTANT text[][] := ARRAY[
    ['public.superadmin_funnel(date,date)',                     'authenticated:EXECUTE,service_role:EXECUTE'],
    ['public.superadmin_set_funnel_minor_counts(boolean,text)', 'authenticated:EXECUTE,service_role:EXECUTE']];
  -- a SQL or plpgsql body names its callees only as text, which pg_depend does not record
  _callee_re CONSTANT text :=
    '\m(superadmin_funnel|superadmin_set_funnel_minor_counts|funnel_minor_counts_enabled|funnel_pilot_start|guard_funnel_minor_counts|funnel_frozen_before|funnel_day_metrics|funnel_mask|funnel_rate|funnel_week_summary|funnel_report)\M';
  _guarded oid[] := '{}';
  _got text;
  i int;
BEGIN
  IF current_setting('app.confirm_superadmin_funnel_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: superadmins lose the Funnel card. Set app.confirm_superadmin_funnel_rollback=yes for the session to proceed deliberately.';
  END IF;
  IF to_regclass('private_sec.funnel_daily') IS NOT NULL
     OR to_regprocedure('private_sec.snapshot_funnel_daily(timestamptz)') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: WP 5.3 (20261127110000) is still applied and its snapshot uses these functions. Roll it back first.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261127100000 created (md5 %). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    _guarded := _guarded || to_regprocedure(_want[i][1])::oid;
  END LOOP;
  FOR i IN 1 .. array_length(_acls, 1) LOOP
    SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
                      ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
      INTO _got
      FROM pg_proc p
     CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      LEFT JOIN pg_roles r ON r.oid = a.grantee
     WHERE p.oid = to_regprocedure(_acls[i][1])
       AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'));
    IF _got IS DISTINCT FROM _acls[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: the grants on % are not the ones 20261127100000 left (%). A later change needs a person to look first.', _acls[i][1], _got;
    END IF;
  END LOOP;
  SELECT string_agg(t.tgname || '=' || md5(pg_get_triggerdef(t.oid)), ',' ORDER BY t.tgname) INTO _got
    FROM pg_trigger t
   WHERE t.tgfoid = 'private_sec.guard_funnel_minor_counts()'::regprocedure AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'a0_app_settings_funnel_minor_counts_guard=bfe7ff70007c3d74ec96b37c2091c505' THEN
    RAISE EXCEPTION 'Refusing to run: the guard trigger is not the one 20261127100000 created (%).', _got;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> ALL (_guarded)
     AND p.prosrc ~ _callee_re;
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names a function this rollback drops. A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

DO $note$
DECLARE r record;
BEGIN
  FOR r IN SELECT key, value FROM public.app_settings WHERE key IN ('funnel_minor_counts', 'funnel_pilot_start') ORDER BY key LOOP
    RAISE NOTICE 'deleting app_settings % = %', r.key, r.value;
  END LOOP;
END
$note$;

SET LOCAL lock_timeout = '2s';
DROP TRIGGER a0_app_settings_funnel_minor_counts_guard ON public.app_settings;
DROP FUNCTION public.superadmin_funnel(date, date);
DROP FUNCTION public.superadmin_set_funnel_minor_counts(boolean, text);
DROP FUNCTION private_sec.funnel_report(date, date, timestamptz, boolean);
DROP FUNCTION private_sec.funnel_week_summary(jsonb);
DROP FUNCTION private_sec.funnel_rate(bigint, bigint);
DROP FUNCTION private_sec.funnel_mask(bigint);
DROP FUNCTION private_sec.funnel_day_metrics(date, date, timestamptz, boolean);
DROP FUNCTION private_sec.funnel_frozen_before(timestamptz);
DROP FUNCTION private_sec.guard_funnel_minor_counts();
DROP FUNCTION private_sec.funnel_pilot_start();
DROP FUNCTION private_sec.funnel_minor_counts_enabled();
DELETE FROM public.app_settings WHERE key IN ('funnel_minor_counts', 'funnel_pilot_start');

COMMIT;
