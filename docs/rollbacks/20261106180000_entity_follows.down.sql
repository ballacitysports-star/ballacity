-- ROLLBACK for supabase/migrations/20261106180000_entity_follows.sql (P1-1).
-- NOT a migration (outside supabase/migrations). It removes entity follows entirely: the table and every follow
-- in it are dropped, which cannot be undone. The app's Follow buttons on team, trainer and facility pages then
-- fail with an error until the app change is reverted too. It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_entity_follows=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_entity_follows', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this drops every team, trainer and facility follow. Set app.confirm_drop_entity_follows=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS trainer_orgs_cleanup_entity_follows ON public.trainer_orgs;
DROP TRIGGER IF EXISTS teams_cleanup_entity_follows ON public.teams;
DROP TRIGGER IF EXISTS user_blocks_cleanup_entity_follows ON public.user_blocks;
DROP FUNCTION IF EXISTS public.remove_entity_follows_on_delete();
DROP FUNCTION IF EXISTS public.remove_entity_follows_on_block();
DROP FUNCTION IF EXISTS public.entity_follow_state(text, text);
DROP FUNCTION IF EXISTS public.unfollow_entity(text, text);
DROP FUNCTION IF EXISTS public.follow_entity(text, text);
DROP FUNCTION IF EXISTS private_sec.entity_follow_target(text, text);
DROP TABLE IF EXISTS public.entity_follows;

COMMIT;
