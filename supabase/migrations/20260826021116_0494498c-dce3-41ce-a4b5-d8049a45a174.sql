ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS min_age integer,
  ADD COLUMN IF NOT EXISTS max_age integer;

CREATE OR REPLACE FUNCTION public.validate_hosted_game_age_range()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.min_age IS NOT NULL AND (NEW.min_age < 5 OR NEW.min_age > 99) THEN
    RAISE EXCEPTION 'min_age must be between 5 and 99';
  END IF;
  IF NEW.max_age IS NOT NULL AND (NEW.max_age < 5 OR NEW.max_age > 99) THEN
    RAISE EXCEPTION 'max_age must be between 5 and 99';
  END IF;
  IF NEW.min_age IS NOT NULL AND NEW.max_age IS NOT NULL AND NEW.min_age > NEW.max_age THEN
    RAISE EXCEPTION 'min_age must be less than or equal to max_age';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_hosted_game_age_range ON public.hosted_games;
CREATE TRIGGER validate_hosted_game_age_range
BEFORE INSERT OR UPDATE ON public.hosted_games
FOR EACH ROW EXECUTE FUNCTION public.validate_hosted_game_age_range();

CREATE OR REPLACE FUNCTION public.enforce_game_age_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  bday date;
  player_age integer;
  approved boolean;
BEGIN
  SELECT min_age, max_age, host_id INTO g
  FROM public.hosted_games
  WHERE id = NEW.game_id;

  IF g IS NULL THEN
    RETURN NEW;
  END IF;

  -- No age requirement, or the host themself: nothing to enforce.
  IF (g.min_age IS NULL AND g.max_age IS NULL) OR g.host_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT birthday INTO bday FROM public.profiles WHERE id = NEW.user_id;
  IF bday IS NOT NULL THEN
    player_age := date_part('year', age(bday))::int;
  END IF;

  IF player_age IS NOT NULL
     AND (g.min_age IS NULL OR player_age >= g.min_age)
     AND (g.max_age IS NULL OR player_age <= g.max_age) THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.join_requests
    WHERE game_id = NEW.game_id
      AND player_id = NEW.user_id
      AND status = 'approved'
  ) INTO approved;

  IF approved THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'This game has an age requirement — the host must approve your request to join.';
END;
$$;

DROP TRIGGER IF EXISTS enforce_game_age_requirement ON public.game_participants;
CREATE TRIGGER enforce_game_age_requirement
BEFORE INSERT ON public.game_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_game_age_requirement();