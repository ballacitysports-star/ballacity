-- ROLLBACK for supabase/migrations/20261108110000_network_posts.sql (P1-2, database layer).
-- NOT a migration (outside supabase/migrations). It drops the posts table and every post in it, which cannot be
-- undone, and removes the network_posts flag. Turn the flag off first so the app stops offering posts.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_network_posts=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_network_posts', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this deletes every network post. Set app.confirm_drop_network_posts=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TABLE IF EXISTS public.posts;
DROP FUNCTION IF EXISTS private_sec.can_view_post(uuid, text, text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.guard_post_write();
DROP FUNCTION IF EXISTS private_sec.post_audiences_allowed(uuid);
DELETE FROM public.app_settings WHERE key = 'network_posts';

COMMIT;
