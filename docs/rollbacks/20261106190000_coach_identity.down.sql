-- ROLLBACK for supabase/migrations/20261106190000_coach_identity.sql (P2-2, private coach identity).
-- NOT a migration (outside supabase/migrations). It removes every account_profiles row of kind 'coach',
-- the sync trigger and functions, and the server-managed policies, and restores the previous kind check.
-- Anyone acting as their coach identity is moved back to their player profile first. Team rosters and
-- roles are not touched. It refuses to run unless the session confirms that is intended:
--     PGOPTIONS="-c app.confirm_remove_coach_identity=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_remove_coach_identity', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this deletes every coach identity. Set app.confirm_remove_coach_identity=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS zz_team_members_sync_coach_profile ON public.team_members;
DROP FUNCTION IF EXISTS private_sec.team_members_sync_coach_profile();
DROP FUNCTION IF EXISTS private_sec.sync_coach_profile(uuid);

UPDATE public.profiles p
SET active_profile_id = (
  SELECT ap.id FROM public.account_profiles ap
  WHERE ap.user_id = p.id AND ap.kind = 'player'
  LIMIT 1
)
WHERE p.active_profile_id IN (SELECT id FROM public.account_profiles WHERE kind = 'coach');

DELETE FROM public.account_profiles WHERE kind = 'coach';

DROP POLICY IF EXISTS "coach profiles are server managed (insert)" ON public.account_profiles;
DROP POLICY IF EXISTS "coach profiles are server managed (update)" ON public.account_profiles;
DROP POLICY IF EXISTS "coach profiles are server managed (delete)" ON public.account_profiles;
DROP INDEX IF EXISTS public.account_profiles_coach_uniq;

ALTER TABLE public.account_profiles DROP CONSTRAINT IF EXISTS account_profiles_kind_check;
ALTER TABLE public.account_profiles ADD CONSTRAINT account_profiles_kind_check
  CHECK (kind IN ('player', 'team', 'trainer', 'gym', 'parent'));
COMMIT;
