-- ROLLBACK for supabase/migrations/20261104110000_game_age_and_minor_hosting.sql (PRIV-2B).
-- NOT a migration. It re-opens two protections, so it refuses to run without typed confirmations:
--   * the host-approval override of a game's age range comes back (an approved request could again put an
--     under-18 on an 18+ roster), and
--   * minor hosts are no longer required to hold a guardian/organization approval, and their public host
--     snapshot is no longer neutralised.
-- It also drops minor_hosting_approvals, which is the only record of who approved which minor's game.
--     PGOPTIONS="-c app.confirm_reopen_age_override=yes -c app.confirm_drop_hosting_approvals=yes" psql ... -f <this file>
-- Narrower reversals that re-open nothing: revert the application change only, or drop just
-- y_minor_hosting_rules_trg while keeping the age checks.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_age_override', true) IS DISTINCT FROM 'yes'
     OR current_setting('app.confirm_drop_hosting_approvals', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: set app.confirm_reopen_age_override=yes and app.confirm_drop_hosting_approvals=yes for the session.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS yy_neutral_host_snapshot_trg ON public.hosted_games;
DROP TRIGGER IF EXISTS y_bind_minor_hosting_approval_trg ON public.hosted_games;
DROP TRIGGER IF EXISTS y_minor_hosting_rules_trg ON public.hosted_games;
DROP TRIGGER IF EXISTS aa_enforce_join_request_age_trg ON public.join_requests;
DROP FUNCTION IF EXISTS public.neutralize_minor_host_snapshot();
DROP FUNCTION IF EXISTS public.bind_minor_hosting_approval();
DROP FUNCTION IF EXISTS public.enforce_minor_hosting_rules();
DROP FUNCTION IF EXISTS public.enforce_join_request_age();
DROP FUNCTION IF EXISTS public.grant_minor_hosting_approval(uuid, integer);
DROP FUNCTION IF EXISTS public.grant_org_minor_hosting_approval(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.revoke_minor_hosting_approval(uuid);
ALTER TABLE public.hosted_games DROP COLUMN IF EXISTS hosting_approval_id;
DROP TABLE IF EXISTS public.minor_hosting_approvals;

-- Previous age check (with the approved-request override), as in 20260902001922.
CREATE OR REPLACE FUNCTION public.enforce_game_age_requirement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  g record; bday date; player_age integer; approved boolean;
BEGIN
  SELECT min_age, max_age, host_id INTO g FROM public.hosted_games WHERE id = NEW.game_id;
  IF g IS NULL THEN RETURN NEW; END IF;
  IF (g.min_age IS NULL AND g.max_age IS NULL) OR g.host_id = NEW.user_id THEN RETURN NEW; END IF;
  SELECT birthday INTO bday FROM public.profile_birthdays WHERE user_id = NEW.user_id;
  IF bday IS NOT NULL THEN player_age := date_part('year', age(bday))::int; END IF;
  IF player_age IS NOT NULL
     AND (g.min_age IS NULL OR player_age >= g.min_age)
     AND (g.max_age IS NULL OR player_age <= g.max_age) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = NEW.game_id AND player_id = NEW.user_id AND status = 'approved') INTO approved;
  IF approved THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'This game has an age requirement — the host must approve your request to join.';
END;
$function$;
DROP FUNCTION IF EXISTS private_sec.player_meets_game_age(text, uuid);
COMMIT;
