ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS min_players integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS allow_waitlist boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cancellation_policy text NOT NULL DEFAULT 'flexible',
  ADD COLUMN IF NOT EXISTS cancellation_notes text,
  ADD COLUMN IF NOT EXISTS game_rules text;

CREATE OR REPLACE FUNCTION public.validate_hosted_game_policy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.min_players IS NULL OR NEW.min_players < 0 THEN
    NEW.min_players := 0;
  END IF;

  IF NEW.min_players > NEW.max_players THEN
    RAISE EXCEPTION 'Minimum players (%) cannot exceed maximum players (%)', NEW.min_players, NEW.max_players;
  END IF;

  IF NEW.cancellation_policy IS NULL OR btrim(NEW.cancellation_policy) = '' THEN
    NEW.cancellation_policy := 'flexible';
  END IF;

  IF NEW.cancellation_policy NOT IN ('flexible', 'standard', 'strict', 'custom') THEN
    RAISE EXCEPTION 'Unknown cancellation policy: %', NEW.cancellation_policy;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validate_hosted_game_policy_trg ON public.hosted_games;
CREATE TRIGGER validate_hosted_game_policy_trg
  BEFORE INSERT OR UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.validate_hosted_game_policy();