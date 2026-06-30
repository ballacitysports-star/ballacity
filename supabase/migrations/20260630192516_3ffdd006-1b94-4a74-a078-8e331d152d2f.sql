
-- =========================================================
-- Join request validation
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_join_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _expected_host uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Force a clean pending state regardless of what client sends.
    NEW.status := 'pending';
    NEW.reviewer_notes := NULL;
    NEW.reviewed_at := NULL;

    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Must be signed in to request to join.' USING ERRCODE = '28000';
    END IF;
    IF NEW.player_id <> auth.uid() THEN
      RAISE EXCEPTION 'Cannot create a join request for another player.' USING ERRCODE = '42501';
    END IF;
    IF NEW.player_id = NEW.host_id THEN
      RAISE EXCEPTION 'Hosts cannot request to join their own game.';
    END IF;

    -- If the host configured payment/approval settings, host_id must match.
    SELECT host_id INTO _expected_host
    FROM public.game_payment_settings
    WHERE game_id = NEW.game_id
    LIMIT 1;
    IF _expected_host IS NOT NULL AND _expected_host <> NEW.host_id THEN
      RAISE EXCEPTION 'host_id does not match the game host.' USING ERRCODE = '42501';
    END IF;

    IF NEW.message IS NOT NULL AND length(NEW.message) > 500 THEN
      RAISE EXCEPTION 'Message too long (max 500 characters).';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Lock identity fields. Only host (via RLS) may update; restrict mutable cols.
    IF NEW.player_id <> OLD.player_id
       OR NEW.host_id   <> OLD.host_id
       OR NEW.game_id   <> OLD.game_id THEN
      RAISE EXCEPTION 'player_id, host_id, and game_id are immutable.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('pending','approved','rejected') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
    IF NEW.reviewer_notes IS NOT NULL AND length(NEW.reviewer_notes) > 1000 THEN
      RAISE EXCEPTION 'Reviewer notes too long (max 1000 characters).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_join_request_ins ON public.join_requests;
DROP TRIGGER IF EXISTS trg_validate_join_request_upd ON public.join_requests;
CREATE TRIGGER trg_validate_join_request_ins
  BEFORE INSERT ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_join_request();
CREATE TRIGGER trg_validate_join_request_upd
  BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_join_request();

REVOKE EXECUTE ON FUNCTION public.validate_join_request() FROM PUBLIC, anon, authenticated;

-- =========================================================
-- Player availability validation
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_player_availability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _allowed_skill text[] := ARRAY['All Levels','Beginner','Intermediate','Advanced','Pro'];
  _allowed_days  text[] := ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  _allowed_sport text[] := ARRAY['Basketball','Soccer','Pickleball','Volleyball','Tennis','Flag Football','Baseball','Softball','Running'];
  d text;
  s text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable.' USING ERRCODE = '42501';
  END IF;

  IF NEW.skill_level IS NULL OR NOT (NEW.skill_level = ANY(_allowed_skill)) THEN
    RAISE EXCEPTION 'Invalid skill_level: %', NEW.skill_level;
  END IF;

  IF NEW.travel_radius_km IS NULL OR NEW.travel_radius_km < 1 OR NEW.travel_radius_km > 500 THEN
    RAISE EXCEPTION 'travel_radius_km must be between 1 and 500.';
  END IF;

  IF NEW.status NOT IN ('open','closed') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;

  IF NEW.sports IS NULL OR array_length(NEW.sports, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one sport is required.';
  END IF;
  IF array_length(NEW.sports, 1) > 10 THEN
    RAISE EXCEPTION 'Too many sports (max 10).';
  END IF;
  FOREACH s IN ARRAY NEW.sports LOOP
    IF NOT (s = ANY(_allowed_sport)) THEN
      RAISE EXCEPTION 'Unknown sport: %', s;
    END IF;
  END LOOP;

  IF NEW.recurring_days IS NOT NULL AND array_length(NEW.recurring_days, 1) IS NOT NULL THEN
    IF array_length(NEW.recurring_days, 1) > 7 THEN
      RAISE EXCEPTION 'recurring_days has too many entries.';
    END IF;
    FOREACH d IN ARRAY NEW.recurring_days LOOP
      IF NOT (d = ANY(_allowed_days)) THEN
        RAISE EXCEPTION 'Unknown day: %', d;
      END IF;
    END LOOP;
  END IF;

  IF NEW.note IS NOT NULL AND length(NEW.note) > 500 THEN
    RAISE EXCEPTION 'Note too long (max 500 characters).';
  END IF;
  IF NEW.city IS NOT NULL AND length(NEW.city) > 120 THEN
    RAISE EXCEPTION 'City too long (max 120 characters).';
  END IF;

  IF NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on < NEW.starts_on THEN
    RAISE EXCEPTION 'ends_on cannot be before starts_on.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_player_availability_ins ON public.player_availabilities;
DROP TRIGGER IF EXISTS trg_validate_player_availability_upd ON public.player_availabilities;
CREATE TRIGGER trg_validate_player_availability_ins
  BEFORE INSERT ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.validate_player_availability();
CREATE TRIGGER trg_validate_player_availability_upd
  BEFORE UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.validate_player_availability();

REVOKE EXECUTE ON FUNCTION public.validate_player_availability() FROM PUBLIC, anon, authenticated;

-- =========================================================
-- Availability contact request validation
-- =========================================================
CREATE OR REPLACE FUNCTION public.validate_availability_contact_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'pending';
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Must be signed in.' USING ERRCODE = '28000';
    END IF;
    IF NEW.from_user_id <> auth.uid() THEN
      RAISE EXCEPTION 'from_user_id must match the signed-in user.' USING ERRCODE = '42501';
    END IF;
    IF NEW.from_user_id = NEW.to_user_id THEN
      RAISE EXCEPTION 'Cannot contact yourself.';
    END IF;
    SELECT user_id INTO _owner FROM public.player_availabilities
      WHERE id = NEW.availability_id;
    IF _owner IS NULL OR _owner <> NEW.to_user_id THEN
      RAISE EXCEPTION 'to_user_id does not match the availability owner.' USING ERRCODE = '42501';
    END IF;
    IF NEW.message IS NOT NULL AND length(NEW.message) > 500 THEN
      RAISE EXCEPTION 'Message too long (max 500 characters).';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.from_user_id <> OLD.from_user_id
       OR NEW.to_user_id <> OLD.to_user_id
       OR NEW.availability_id <> OLD.availability_id THEN
      RAISE EXCEPTION 'Identity fields are immutable.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('pending','accepted','declined','withdrawn') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_avail_contact_ins ON public.availability_contact_requests;
DROP TRIGGER IF EXISTS trg_validate_avail_contact_upd ON public.availability_contact_requests;
CREATE TRIGGER trg_validate_avail_contact_ins
  BEFORE INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_availability_contact_request();
CREATE TRIGGER trg_validate_avail_contact_upd
  BEFORE UPDATE ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_availability_contact_request();

REVOKE EXECUTE ON FUNCTION public.validate_availability_contact_request() FROM PUBLIC, anon, authenticated;
