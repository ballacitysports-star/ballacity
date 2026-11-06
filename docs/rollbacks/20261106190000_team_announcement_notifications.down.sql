-- ROLLBACK for supabase/migrations/20261106190000_team_announcement_notifications.sql (P1-6).
-- NOT a migration (outside supabase/migrations). It stops team announcements from notifying members.
-- Notifications already delivered stay in members' inboxes. It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_stop_announcement_notifications=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_stop_announcement_notifications', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: team members would stop hearing about announcements. Set app.confirm_stop_announcement_notifications=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS team_posts_notify_announcement ON public.team_posts;
DROP FUNCTION IF EXISTS public.notify_team_on_announcement();

COMMIT;
