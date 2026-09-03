-- block_locked_child_activity resolved the owner column with a single SQL CASE
-- expression referencing NEW.sender_id, NEW.host_id and NEW.user_id at once.
-- Postgres prepares that whole expression against NEW's rowtype, so on any
-- table without a sender_id column the trigger failed with
-- 'record "new" has no field "sender_id"' — breaking hosted_games,
-- highlight_reels and player_availabilities inserts for every account type.
-- Branching with IF/ELSIF prepares only the executed statement.
CREATE OR REPLACE FUNCTION public.block_locked_child_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE owner uuid;
BEGIN
  IF TG_TABLE_NAME = 'messages' THEN
    owner := NEW.sender_id;
  ELSIF TG_TABLE_NAME = 'hosted_games' THEN
    owner := NEW.host_id;
  ELSE
    owner := NEW.user_id;
  END IF;

  IF owner IS NOT NULL AND owner = auth.uid() AND NOT public.age_verified(owner) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before using ballaCity.';
  END IF;
  IF owner IS NOT NULL AND public.child_features_locked(owner) THEN
    RAISE EXCEPTION 'CHILD_CONSENT_REQUIRED: a parent or guardian must approve this account first.';
  END IF;
  RETURN NEW;
END $function$;