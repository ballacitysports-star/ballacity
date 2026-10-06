-- Facility events: only a facility's owner/admins may attach a game to it.
--
-- `hosted_games.org_id` drives the "Upcoming events & runs" section on a
-- facility page. The existing INSERT/UPDATE policies only require
-- `host_id = auth.uid()`, so without this check any signed-in host could pin a
-- game to someone else's gym and have it listed on that gym's public profile.

CREATE OR REPLACE FUNCTION public.enforce_hosted_game_org_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Nothing to authorize when no facility is attached, or it is unchanged.
  IF NEW.org_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id THEN
    RETURN NEW;
  END IF;

  -- Service-role / maintenance writes have no end user to check.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_trainer_org_admin(NEW.org_id, auth.uid()) THEN
    RAISE EXCEPTION 'ORG_NOT_MANAGER: only a facility owner or admin can post events for it.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_hosted_game_org_manager_trg ON public.hosted_games;
CREATE TRIGGER enforce_hosted_game_org_manager_trg
BEFORE INSERT OR UPDATE OF org_id ON public.hosted_games
FOR EACH ROW EXECUTE FUNCTION public.enforce_hosted_game_org_manager();

-- Speeds up the facility page query (upcoming, public, per facility).
CREATE INDEX IF NOT EXISTS hosted_games_org_date_idx
  ON public.hosted_games (org_id, date)
  WHERE org_id IS NOT NULL;
