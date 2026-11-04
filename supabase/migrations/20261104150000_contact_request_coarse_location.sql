-- PRIV-2D (3/3): an invitation to a youth-inclusive game never carries the exact location.
--
-- WHY. An invitation (availability_contact_requests, kind 'invite') copies the game's location, title and a free-text message
-- into a row the recipient can read, and the app also writes a notification whose body repeats the location. The recipient is
-- by definition not on the roster yet. Until now the client chose what to copy, so a host (who is entitled to the exact
-- venue) sent it to someone who is not.
--
-- WHAT THIS DOES (server side, whatever a client sends, old app or new):
--   * for a request tied to a game that is not enforced adult-only, or to a game id we cannot find (fail closed):
--       - game_location is replaced by the game's coarse form (private_sec.coarse_game_label of its neighborhood), never the
--         client's text; game_title is replaced by the game's own title; game_sport by its sport;
--       - the free-text message has the game's exact location (public or private copy) replaced by the coarse label, and is
--         refused (LOCATION_IN_PUBLIC_TEXT) if it still contains an address, map link or coordinates;
--   * for a request with no game, game_location is cleared (it has no meaning without a game);
--   * adult-only games are untouched (their locations are already public).
--   * a notification of type 'game_invite' that links to a game that is not enforced adult-only has its body rebuilt from the
--     sport and the coarse form.
--
-- HOW THE RECIPIENT GETS THE EXACT PLACE. Not from these rows. Exactly as for everyone else, from hosted_game_private, which
-- the database releases (private_sec.can_see_exact_game_location) to the host, a roster member whose entry fee is settled (a free
-- game, or a verified payment), their verified guardians and the game's managers. A pending, denied or revoked participation,
-- a waitlist place and a refunded payment release nothing. No new read path is added.
--
-- Existing rows: coarsened once below (a no-op where there are none; production has zero invitations).
-- Depends on 20261104100000 (coarse_game_label, hosted_game_private) and 20261104130000 (detector).
CREATE OR REPLACE FUNCTION public.guard_contact_request_location()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _g       record;
  _priv    text;
  _label   text;
  _msg     text;
  _loc     text;
BEGIN
  IF NEW.game_id IS NULL THEN
    NEW.game_location := NULL;
    RETURN NEW;
  END IF;

  SELECT g.title, g.sport, g.neighborhood, g.location, g.min_age, g.max_age
    INTO _g FROM public.hosted_games g WHERE g.id = NEW.game_id;
  IF FOUND AND public.game_age_range_is_adult_only(_g.min_age, _g.max_age) THEN
    RETURN NEW;                                                     -- adult-only: location is public anyway
  END IF;

  IF FOUND THEN
    _label := private_sec.coarse_game_label(_g.neighborhood);
    SELECT p.location INTO _priv FROM public.hosted_game_private p WHERE p.game_id = NEW.game_id;
    NEW.game_title := _g.title;
    NEW.game_sport := _g.sport;
  ELSE
    _label := private_sec.coarse_game_label(NULL);                  -- unknown game: fail closed
    NEW.game_title := NULL;
  END IF;
  NEW.game_location := _label;

  IF NEW.message IS NOT NULL AND btrim(NEW.message) <> '' THEN
    _msg := NEW.message;
    FOREACH _loc IN ARRAY ARRAY[_g.location, _priv] LOOP
      IF _loc IS NOT NULL AND btrim(_loc) <> '' AND _loc <> _label THEN
        _msg := regexp_replace(_msg, regexp_replace(_loc, '([\\.\[\]\(\)\{\}\*\+\?\|\^\$])', '\\\1', 'g'), _label, 'gi');
      END IF;
    END LOOP;
    IF private_sec.text_discloses_location(_msg, COALESCE(_priv, _g.location)) IS NOT NULL THEN
      RAISE EXCEPTION 'LOCATION_IN_PUBLIC_TEXT: an invitation to a game that includes children cannot contain an address, map link, coordinates or the venue name. The exact place is shared once the person has joined.'
        USING ERRCODE = '22023';
    END IF;
    NEW.message := _msg;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_contact_request_location() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_contact_request_location() TO service_role;

DROP TRIGGER IF EXISTS a0_guard_contact_request_location_trg ON public.availability_contact_requests;
CREATE TRIGGER a0_guard_contact_request_location_trg BEFORE INSERT OR UPDATE OF game_location, message, game_title, game_id
  ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_request_location();

-- Notifications for invitations: rebuild the body from the coarse form.
CREATE OR REPLACE FUNCTION public.guard_game_invite_notification()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _id text;
  _g  record;
BEGIN
  IF NEW.type IS DISTINCT FROM 'game_invite' OR NEW.link IS NULL THEN RETURN NEW; END IF;
  _id := substring(NEW.link FROM '^/games/([^/?#]+)');
  IF _id IS NULL THEN RETURN NEW; END IF;
  SELECT g.sport, g.neighborhood, g.min_age, g.max_age INTO _g FROM public.hosted_games g WHERE g.id = _id;
  IF FOUND AND public.game_age_range_is_adult_only(_g.min_age, _g.max_age) THEN RETURN NEW; END IF;
  NEW.body := concat_ws(' · ', NULLIF(btrim(COALESCE(_g.sport, '')), ''),
                        private_sec.coarse_game_label(CASE WHEN FOUND THEN _g.neighborhood ELSE NULL END));
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_game_invite_notification() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_game_invite_notification() TO service_role;
DROP TRIGGER IF EXISTS a0_guard_game_invite_notification_trg ON public.notifications;
CREATE TRIGGER a0_guard_game_invite_notification_trg BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_game_invite_notification();

-- Existing rows (no-op when there are none).
UPDATE public.availability_contact_requests SET game_location = game_location WHERE game_id IS NOT NULL OR game_location IS NOT NULL;
