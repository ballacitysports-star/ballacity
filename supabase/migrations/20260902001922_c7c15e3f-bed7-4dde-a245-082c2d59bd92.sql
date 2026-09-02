-- 1. Age enforcement reads the private birthdays table
CREATE OR REPLACE FUNCTION public.enforce_game_age_requirement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF (g.min_age IS NULL AND g.max_age IS NULL) OR g.host_id = NEW.user_id THEN
    RETURN NEW;
  END IF;

  SELECT birthday INTO bday FROM public.profile_birthdays WHERE user_id = NEW.user_id;
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
$function$;

-- 2. Backfill anything still stored on profiles, then drop the column
INSERT INTO public.profile_birthdays (user_id, birthday)
SELECT id, birthday FROM public.profiles WHERE birthday IS NOT NULL
ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();

DROP TRIGGER IF EXISTS sync_profile_birthday ON public.profiles;
DROP TRIGGER IF EXISTS profiles_sync_birthday ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_profile_birthday() CASCADE;

DROP TRIGGER IF EXISTS trg_sync_profile_age_category ON public.profiles;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS birthday;

-- Age category is now derived when a birthday is written to the private table.
CREATE OR REPLACE FUNCTION public.sync_age_category_from_birthdays()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  cat text;
BEGIN
  cat := public.age_category_from_birthday(NEW.birthday);
  IF cat = 'child' AND NOT public.youth_flag('enabled') THEN
    RAISE EXCEPTION 'AGE_MINIMUM_13: OpenRun requires members to be at least 13 years old.';
  END IF;
  UPDATE public.profiles SET age_category = cat WHERE id = NEW.user_id;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sync_age_category_from_birthdays ON public.profile_birthdays;
CREATE TRIGGER trg_sync_age_category_from_birthdays
AFTER INSERT OR UPDATE OF birthday ON public.profile_birthdays
FOR EACH ROW EXECUTE FUNCTION public.sync_age_category_from_birthdays();

REVOKE ALL ON FUNCTION public.sync_age_category_from_birthdays() FROM PUBLIC, anon, authenticated;

-- 3. Private games are only visible to the host, participants, or requesters
DROP POLICY IF EXISTS "Anyone can view hosted games" ON public.hosted_games;

CREATE POLICY "Public games are viewable by everyone"
ON public.hosted_games
FOR SELECT
USING (is_private = false);

CREATE POLICY "Private games viewable by host, players and requesters"
ON public.hosted_games
FOR SELECT
TO authenticated
USING (
  is_private = true
  AND (
    host_id = auth.uid()
    OR public.is_game_participant(id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.join_requests jr
      WHERE jr.game_id = public.hosted_games.id
        AND jr.player_id = auth.uid()
    )
  )
);