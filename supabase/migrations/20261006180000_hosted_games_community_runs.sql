-- Community runs at facilities.
--
-- Any signed-in host may now tag a *public* game with a facility
-- (`hosted_games.org_id`) so it shows on that facility's "Upcoming events &
-- runs" list ("Host a run here"). Whether the game is an official facility
-- event is decided here, never by the client: `org_official` is true only when
-- the host is an owner/admin of the facility at tag time.
--
-- Facility admins moderate community runs with `set_game_hidden_from_org`,
-- which sets `org_hidden_at`. A hidden game cannot be re-tagged by its host to
-- dodge moderation.

ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS org_official boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS org_hidden_at timestamptz,
  ADD COLUMN IF NOT EXISTS org_hidden_by uuid;

-- Every tag that exists today was written under the admin-only trigger.
UPDATE public.hosted_games SET org_official = true WHERE org_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_hosted_game_org_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _moderating boolean := coalesce(current_setting('app.org_moderation', true), '') = 'on';
  _is_admin boolean;
BEGIN
  -- Service-role / maintenance writes have no end user to check.
  IF _uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Moderation RPC: only the hide columns may change on this path.
  IF _moderating THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- A community run that goes private drops off the facility page.
    IF NEW.is_private AND NOT OLD.is_private
       AND OLD.org_id IS NOT NULL AND NOT OLD.org_official
       AND OLD.org_hidden_at IS NULL
       AND NEW.org_id IS NOT DISTINCT FROM OLD.org_id THEN
      NEW.org_id := NULL;
    END IF;

    IF NEW.org_id IS DISTINCT FROM OLD.org_id AND OLD.org_hidden_at IS NOT NULL THEN
      RAISE EXCEPTION 'ORG_HIDDEN: this game was hidden by the facility and cannot be re-tagged.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NEW.org_id IS NULL THEN
    NEW.org_official := false;
    IF TG_OP = 'INSERT' THEN
      NEW.org_hidden_at := NULL;
      NEW.org_hidden_by := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' OR NEW.org_id IS DISTINCT FROM OLD.org_id THEN
    _is_admin := public.is_trainer_org_admin(NEW.org_id, _uid);
    IF NOT _is_admin AND NEW.is_private THEN
      RAISE EXCEPTION 'ORG_PRIVATE_RUN: only public runs can be listed on a facility page.'
        USING ERRCODE = '42501';
    END IF;
    NEW.org_official := _is_admin;
    NEW.org_hidden_at := NULL;
    NEW.org_hidden_by := NULL;
    RETURN NEW;
  END IF;

  -- Facility unchanged: the flags are server-owned.
  IF NEW.org_official IS DISTINCT FROM OLD.org_official
     OR NEW.org_hidden_at IS DISTINCT FROM OLD.org_hidden_at
     OR NEW.org_hidden_by IS DISTINCT FROM OLD.org_hidden_by THEN
    RAISE EXCEPTION 'ORG_FLAGS_READONLY: facility listing flags are set by the server.'
      USING ERRCODE = '42501';
  END IF;

  -- Keep a non-admin's tagged run public while it is listed.
  IF NEW.is_private AND NOT NEW.org_official AND NEW.org_hidden_at IS NULL THEN
    RAISE EXCEPTION 'ORG_PRIVATE_RUN: only public runs can be listed on a facility page.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_hosted_game_org_manager_trg ON public.hosted_games;
CREATE TRIGGER enforce_hosted_game_org_manager_trg
BEFORE INSERT OR UPDATE ON public.hosted_games
FOR EACH ROW EXECUTE FUNCTION public.enforce_hosted_game_org_manager();

-- Facility owners/admins hide (or restore) a game from their facility page.
CREATE OR REPLACE FUNCTION public.set_game_hidden_from_org(_game text, _hidden boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _org uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT org_id INTO _org FROM public.hosted_games WHERE id = _game;
  IF _org IS NULL THEN
    RAISE EXCEPTION 'NOT_FOUND: game is not listed at a facility.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_trainer_org_admin(_org, _uid) THEN
    RAISE EXCEPTION 'ORG_NOT_MANAGER: only a facility owner or admin can moderate its events.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.org_moderation', 'on', true);
  UPDATE public.hosted_games
     SET org_hidden_at = CASE WHEN _hidden THEN now() ELSE NULL END,
         org_hidden_by = CASE WHEN _hidden THEN _uid ELSE NULL END
   WHERE id = _game;
  PERFORM set_config('app.org_moderation', 'off', true);
END $$;

REVOKE ALL ON FUNCTION public.set_game_hidden_from_org(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_game_hidden_from_org(text, boolean) TO authenticated;
