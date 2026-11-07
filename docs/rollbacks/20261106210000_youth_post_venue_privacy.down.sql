-- ROLLBACK for supabase/migrations/20261106210000_youth_post_venue_privacy.sql (D0).
-- NOT a migration (outside supabase/migrations). It makes the exact venue (location, address,
-- place id, coordinates) of every team post, youth teams included, readable by anyone again,
-- signed-out visitors included. It refuses to run unless the session confirms that is intended:
--     PGOPTIONS="-c app.confirm_public_youth_venues=yes" psql ... -f <this file>
-- Deploy the app version that reads venues through team_post_venues first or together; the
-- older app reads the columns directly and works again once this has run.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_public_youth_venues', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this makes youth teams'' event addresses and coordinates public again. Set app.confirm_public_youth_venues=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;
GRANT SELECT ON public.team_posts TO anon, authenticated;
DROP FUNCTION IF EXISTS public.team_post_venues(uuid[]);
DROP FUNCTION IF EXISTS private_sec.post_venue(uuid);
DROP FUNCTION IF EXISTS private_sec.can_see_post_venue(uuid);
DROP FUNCTION IF EXISTS private_sec.team_is_youth(text);
COMMIT;
