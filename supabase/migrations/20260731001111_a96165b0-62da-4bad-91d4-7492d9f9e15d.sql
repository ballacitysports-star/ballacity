ALTER TABLE public.player_availabilities
  ADD COLUMN IF NOT EXISTS time_slots jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS timezone text;

CREATE OR REPLACE FUNCTION public.validate_player_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _allowed_skill text[] := ARRAY['All Levels','Beginner','Intermediate','Advanced','Pro'];
  _allowed_days  text[] := ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  _allowed_sport text[] := ARRAY['Basketball','Soccer','Pickleball','Volleyball','Tennis','Flag Football','Baseball','Softball','Running'];
  d text;
  s text;
  slot jsonb;
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

  IF NEW.time_slots IS NULL THEN
    NEW.time_slots := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(NEW.time_slots) <> 'array' THEN
    RAISE EXCEPTION 'time_slots must be an array.';
  END IF;
  IF jsonb_array_length(NEW.time_slots) > 40 THEN
    RAISE EXCEPTION 'Too many time slots (max 40).';
  END IF;
  FOR slot IN SELECT * FROM jsonb_array_elements(NEW.time_slots) LOOP
    IF jsonb_typeof(slot) <> 'object' THEN
      RAISE EXCEPTION 'Each time slot must be an object.';
    END IF;
    IF (slot->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Invalid slot start time: %', slot->>'start';
    END IF;
    IF (slot->>'end') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' THEN
      RAISE EXCEPTION 'Invalid slot end time: %', slot->>'end';
    END IF;
    IF (slot->>'end') <= (slot->>'start') THEN
      RAISE EXCEPTION 'Slot end must be after start.';
    END IF;
    IF slot ? 'date' THEN
      IF (slot->>'date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'Invalid slot date: %', slot->>'date';
      END IF;
    ELSIF slot ? 'weekday' THEN
      IF (slot->>'weekday') !~ '^[0-6]$' THEN
        RAISE EXCEPTION 'Invalid slot weekday: %', slot->>'weekday';
      END IF;
    ELSE
      RAISE EXCEPTION 'Each time slot needs a date or a weekday.';
    END IF;
  END LOOP;

  IF NEW.timezone IS NOT NULL AND length(NEW.timezone) > 64 THEN
    RAISE EXCEPTION 'timezone too long.';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_player_availability_trg ON public.player_availabilities;
CREATE TRIGGER validate_player_availability_trg
BEFORE INSERT OR UPDATE ON public.player_availabilities
FOR EACH ROW EXECUTE FUNCTION public.validate_player_availability();