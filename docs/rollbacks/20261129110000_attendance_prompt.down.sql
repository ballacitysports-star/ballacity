-- ROLLBACK for supabase/migrations/20261129110000_attendance_prompt.sql (WP 5.6: the host's attendance prompt).
-- NOT a migration. It drops the function public.send_attendance_prompt(text, text, text, text), the trigger hosted_games_attendance_prompted_at_server_only on public.hosted_games, its function private_sec.guard_hosted_game_attendance_prompted_at(), and the column public.hosted_games.attendance_prompted_at.
-- REVERT THE SWEEP CODE FIRST: promptHostsForAttendance reads public.hosted_games.attendance_prompted_at and calls
-- public.send_attendance_prompt (which writes it) on every 5-minute run of /api/public/reminders/run; with them gone that job
-- fails until the code no longer names them. Revert the app (the
-- WP 5.6 (promptHostsForAttendance) part of src/lib/game-reminders.server.ts and its call in src/routes/api/public/reminders/run.ts), publish, then
-- run this.
-- What is lost: the stamps. Which games were already prompted is forgotten (the prompts themselves stay in notifications, type 'game_attendance_prompt'). Re-applying the migration later starts every row at NULL; the sweep then looks only at
-- games whose prompt fell due in the last 24 hours, so nothing older is prompted again, and a game prompted in that day can be prompted a second time once the sweep is back.
-- The stamps are rows of data this drops, so while any row has one it refuses unless they were exported first:
--     \copy (SELECT id, attendance_prompted_at FROM public.hosted_games WHERE attendance_prompted_at IS NOT NULL ORDER BY id) TO 'attendance_prompted_at.csv' WITH CSV HEADER
--     SET app.attendance_prompted_at_exported = 'yes';
-- It stops, changing nothing, unless both functions and the trigger still have the definitions 20261129110000 gave them, no
-- other trigger runs the guard, the column is still a nullable timestamptz with no default and no column grant, nothing but
-- that trigger depends on the column (an index, view, policy or constraint added later needs a person to look first), and
-- no function but the guard and public.send_attendance_prompt names the column.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_attendance_prompt_rollback = 'yes';
-- Locks: DROP TRIGGER and DROP COLUMN take ACCESS EXCLUSIVE on public.hosted_games, which nearly every page reads. They are the last changes before
-- COMMIT, so the lock is held for milliseconds, and its wait is limited to 200 ms so a busy moment fails cleanly (nothing
-- changes) instead of queueing requests behind it: run it again.
BEGIN;
DO $guard$
DECLARE
  _fn CONSTANT regprocedure := to_regprocedure('private_sec.guard_hosted_game_attendance_prompted_at()');
  _rel CONSTANT regclass := to_regclass('public.hosted_games');
  _att smallint;
  _trg oid;
  _send CONSTANT regprocedure := to_regprocedure('public.send_attendance_prompt(text,text,text,text)');
  _got text;
  _rows bigint;
BEGIN
  IF current_setting('app.confirm_attendance_prompt_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: public.hosted_games.attendance_prompted_at and its guard are dropped. Revert the sweep code first, then set app.confirm_attendance_prompt_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _fn IS NULL OR _got IS DISTINCT FROM '96814adbe91af0cf32035bf311f1a91b' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.guard_hosted_game_attendance_prompted_at() is not the definition 20261129110000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _send;
  IF _send IS NULL OR _got IS DISTINCT FROM '89536da9738c1992ce072d90a32ac33c' THEN
    RAISE EXCEPTION 'Refusing to run: public.send_attendance_prompt(text, text, text, text) is not the definition 20261129110000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid)), ',' ORDER BY t.tgname),
         min(t.oid::text)::oid
    INTO _got, _trg
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE t.tgfoid = _fn AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'public.hosted_games.hosted_games_attendance_prompted_at_server_only=94ec188cecb508315bc885a2c99bf796' THEN
    RAISE EXCEPTION 'Refusing to run: the trigger is not the one 20261129110000 created (%).', _got;
  END IF;
  SELECT a.attnum,
         format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || a.atthasdef || ':' || (a.attacl IS NULL)
    INTO _att, _got
    FROM pg_attribute a
   WHERE a.attrelid = _rel AND a.attname = 'attendance_prompted_at' AND NOT a.attisdropped;
  IF _got IS DISTINCT FROM 'timestamp with time zone:false:false:true' THEN
    RAISE EXCEPTION 'Refusing to run: public.hosted_games.attendance_prompted_at is not the column 20261129110000 created (%). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO _got
    FROM pg_depend d
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = _rel AND d.refobjsubid = _att
     AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid = _trg);
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % depends on public.hosted_games.attendance_prompted_at. A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> _fn
     AND p.oid <> _send
     AND p.prosrc ~ '\mattendance_prompted_at\M';
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names public.hosted_games.attendance_prompted_at. A later change needs a person to look first.', _got;
  END IF;
  SELECT count(*) INTO _rows FROM public.hosted_games WHERE attendance_prompted_at IS NOT NULL;
  IF _rows > 0 AND current_setting('app.attendance_prompted_at_exported', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: % rows of public.hosted_games have attendance_prompted_at set and dropping the column deletes it. Export first (see the header), then set app.attendance_prompted_at_exported=yes.', _rows;
  END IF;
END
$guard$;

-- Last, so the lock on public.hosted_games is held only until COMMIT.
SET LOCAL lock_timeout = '200ms';
DROP FUNCTION public.send_attendance_prompt(text, text, text, text);
DROP TRIGGER hosted_games_attendance_prompted_at_server_only ON public.hosted_games;
DROP FUNCTION private_sec.guard_hosted_game_attendance_prompted_at();
ALTER TABLE public.hosted_games DROP COLUMN attendance_prompted_at;

COMMIT;
