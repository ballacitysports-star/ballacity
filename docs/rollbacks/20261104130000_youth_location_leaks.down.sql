-- ROLLBACK for supabase/migrations/20261104130000, 20261104140000 and 20261104150000 (PRIV-2D). NOT a migration.
-- It re-opens two leaks, so it refuses to run without a typed confirmation:
--   * a host can again put an address, map link or the venue name into the public text of a game that includes children, and
--   * an invitation to such a game can again carry the exact venue to someone who is not on the roster.
-- Nothing is lost: no table or column was added, no data was changed, only triggers and functions are removed.
--     PGOPTIONS="-c app.confirm_reopen_location_text=yes" psql ... -f <this file>
-- Prefer fixing forward (adjust the detector in private_sec.text_discloses_location) to removing the guards.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_location_text', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: set app.confirm_reopen_location_text=yes for the session.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS a0_guard_game_invite_notification_trg ON public.notifications;
DROP TRIGGER IF EXISTS a0_guard_contact_request_location_trg ON public.availability_contact_requests;
DROP TRIGGER IF EXISTS a0_guard_youth_game_public_text_trg ON public.hosted_games;
DROP FUNCTION IF EXISTS public.guard_game_invite_notification();
DROP FUNCTION IF EXISTS public.guard_contact_request_location();
DROP FUNCTION IF EXISTS public.list_youth_games_with_location_text();
DROP FUNCTION IF EXISTS public.guard_youth_game_public_text();
DROP FUNCTION IF EXISTS private_sec.text_discloses_location(text, text);
DROP FUNCTION IF EXISTS private_sec.location_tokens(text);
COMMIT;
