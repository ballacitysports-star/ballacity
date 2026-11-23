-- ROLLBACK for supabase/migrations/20261129100000_notification_push_sent_at.sql (WP 5.4: invite pushes).
-- NOT a migration. It drops the function public.invite_pushes_allowed(uuid[]), the index public.notifications_invite_push_due_idx, the trigger notifications_push_sent_at_server_only on public.notifications, its function private_sec.guard_notification_push_sent_at(), and the column public.notifications.push_sent_at.
-- REVERT THE SWEEP CODE FIRST: pushInviteNotifications reads and writes public.notifications.push_sent_at and calls
-- public.invite_pushes_allowed on every 5-minute run of /api/public/reminders/run; with them gone that job fails until the
-- code no longer names them. Revert the app (the
-- WP 5.4 (pushInviteNotifications) part of src/lib/game-reminders.server.ts and its call in src/routes/api/public/reminders/run.ts), publish, then
-- run this.
-- What is lost: the stamps. An invite row taken by the sweep and one never taken look alike afterwards. Re-applying the migration later starts every row at NULL; the sweep then looks only at
-- the last hour's invite notifications, so nothing older is pushed again (only the last hour could be, and only once the sweep is back).
-- The stamps are rows of data this drops, so while any row has one it refuses unless they were exported first:
--     \copy (SELECT id, push_sent_at FROM public.notifications WHERE push_sent_at IS NOT NULL ORDER BY id) TO 'push_sent_at.csv' WITH CSV HEADER
--     SET app.push_sent_at_exported = 'yes';
-- It stops, changing nothing, unless both functions, the trigger and the index still have the definitions 20261129100000
-- gave them, no other trigger runs the function, the column is still a nullable timestamptz with no default and no column grant,
-- nothing but that trigger and that index depends on the column (an index, view, policy or constraint added later needs a
-- person to look first), and no function but the guard names the column.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_notification_push_sent_at_rollback = 'yes';
-- Locks: DROP INDEX, DROP TRIGGER and DROP COLUMN take ACCESS EXCLUSIVE on public.notifications, which every page that shows notifications reads and the database's own invite, join and payment functions write. They are the last changes before
-- COMMIT, so the lock is held for milliseconds, and its wait is limited to 200 ms so a busy moment fails cleanly (nothing
-- changes) instead of queueing requests behind it: run it again.
BEGIN;
DO $guard$
DECLARE
  _fn CONSTANT regprocedure := to_regprocedure('private_sec.guard_notification_push_sent_at()');
  _rel CONSTANT regclass := to_regclass('public.notifications');
  _att smallint;
  _trg oid;
  _idx CONSTANT regclass := to_regclass('public.notifications_invite_push_due_idx');
  _check CONSTANT regprocedure := to_regprocedure('public.invite_pushes_allowed(uuid[])');
  _got text;
  _rows bigint;
BEGIN
  IF current_setting('app.confirm_notification_push_sent_at_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: public.notifications.push_sent_at and its guard are dropped. Revert the sweep code first, then set app.confirm_notification_push_sent_at_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _fn IS NULL OR _got IS DISTINCT FROM 'a3611103f7951f39b35d0533781d90c2' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.guard_notification_push_sent_at() is not the definition 20261129100000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _check;
  IF _check IS NULL OR _got IS DISTINCT FROM 'fe47c01a7c8ef97f4104d996faf2eb38' THEN
    RAISE EXCEPTION 'Refusing to run: public.invite_pushes_allowed(uuid[]) is not the definition 20261129100000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid)), ',' ORDER BY t.tgname),
         min(t.oid::text)::oid
    INTO _got, _trg
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE t.tgfoid = _fn AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'public.notifications.notifications_push_sent_at_server_only=8fae5c8c1bc75a5cc04a662da5dba09d' THEN
    RAISE EXCEPTION 'Refusing to run: the trigger is not the one 20261129100000 created (%).', _got;
  END IF;
  IF _idx IS NULL OR md5(pg_get_indexdef(_idx)) IS DISTINCT FROM 'ff12119917b12f2615bc62abbba408a1' THEN
    RAISE EXCEPTION 'Refusing to run: public.notifications_invite_push_due_idx is not the index 20261129100000 created (%). A later change needs a person to look first.',
      CASE WHEN _idx IS NULL THEN 'missing' ELSE pg_get_indexdef(_idx) END;
  END IF;
  SELECT a.attnum,
         format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':' || a.atthasdef || ':' || (a.attacl IS NULL)
    INTO _att, _got
    FROM pg_attribute a
   WHERE a.attrelid = _rel AND a.attname = 'push_sent_at' AND NOT a.attisdropped;
  IF _got IS DISTINCT FROM 'timestamp with time zone:false:false:true' THEN
    RAISE EXCEPTION 'Refusing to run: public.notifications.push_sent_at is not the column 20261129100000 created (%). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(pg_describe_object(d.classid, d.objid, d.objsubid), ', ') INTO _got
    FROM pg_depend d
   WHERE d.refclassid = 'pg_class'::regclass AND d.refobjid = _rel AND d.refobjsubid = _att
     AND NOT (d.classid = 'pg_trigger'::regclass AND d.objid = _trg)
     AND NOT (d.classid = 'pg_class'::regclass AND d.objid = _idx);
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % depends on public.notifications.push_sent_at. A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _got
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND p.oid <> _fn
     AND p.prosrc ~ '\mpush_sent_at\M';
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % names public.notifications.push_sent_at. A later change needs a person to look first.', _got;
  END IF;
  SELECT count(*) INTO _rows FROM public.notifications WHERE push_sent_at IS NOT NULL;
  IF _rows > 0 AND current_setting('app.push_sent_at_exported', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: % rows of public.notifications have push_sent_at set and dropping the column deletes it. Export first (see the header), then set app.push_sent_at_exported=yes.', _rows;
  END IF;
END
$guard$;

-- Last, so the lock on public.notifications is held only until COMMIT.
SET LOCAL lock_timeout = '200ms';
DROP FUNCTION public.invite_pushes_allowed(uuid[]);
DROP INDEX public.notifications_invite_push_due_idx;
DROP TRIGGER notifications_push_sent_at_server_only ON public.notifications;
DROP FUNCTION private_sec.guard_notification_push_sent_at();
ALTER TABLE public.notifications DROP COLUMN push_sent_at;

COMMIT;
