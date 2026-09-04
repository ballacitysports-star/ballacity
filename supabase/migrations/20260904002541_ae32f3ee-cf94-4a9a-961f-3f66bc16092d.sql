CREATE OR REPLACE FUNCTION public.enforce_child_game_participation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE subject uuid;
BEGIN
  -- Resolve the owning column with IF/ELSIF, never a single SQL CASE over NEW:
  -- Postgres prepares the whole expression against NEW's rowtype, so a CASE
  -- naming NEW.player_id breaks every insert into game_participants (which has
  -- only user_id) with `record "new" has no field "player_id"`.
  IF TG_TABLE_NAME = 'join_requests' THEN
    subject := NEW.player_id;
  ELSE
    subject := NEW.user_id;
  END IF;
  subject := COALESCE(subject, auth.uid());

  IF subject IS NOT NULL AND subject = auth.uid() AND NOT public.age_verified(subject) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.';
  END IF;
  IF subject IS NOT NULL AND NOT public.child_game_participation_allowed(subject) THEN
    RAISE EXCEPTION 'CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account and allow game participation.';
  END IF;
  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.enforce_child_game_participation() FROM PUBLIC, anon, authenticated;
