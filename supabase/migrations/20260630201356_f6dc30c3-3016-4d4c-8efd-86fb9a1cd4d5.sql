ALTER TABLE public.availability_contact_requests
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS game_id text,
  ADD COLUMN IF NOT EXISTS game_title text,
  ADD COLUMN IF NOT EXISTS game_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS game_sport text,
  ADD COLUMN IF NOT EXISTS game_location text;

CREATE OR REPLACE FUNCTION public.validate_availability_contact_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    IF NEW.kind IS NULL OR NEW.kind NOT IN ('contact','invite') THEN
      RAISE EXCEPTION 'Invalid kind: %', NEW.kind;
    END IF;
    IF NEW.kind = 'invite' AND (NEW.game_id IS NULL OR length(NEW.game_id) = 0) THEN
      RAISE EXCEPTION 'game_id required for invites.';
    END IF;
    IF NEW.game_id IS NOT NULL AND length(NEW.game_id) > 120 THEN
      RAISE EXCEPTION 'game_id too long.';
    END IF;
    IF NEW.game_title IS NOT NULL AND length(NEW.game_title) > 200 THEN
      RAISE EXCEPTION 'game_title too long.';
    END IF;
    IF NEW.game_location IS NOT NULL AND length(NEW.game_location) > 300 THEN
      RAISE EXCEPTION 'game_location too long.';
    END IF;
    IF NEW.game_sport IS NOT NULL AND length(NEW.game_sport) > 60 THEN
      RAISE EXCEPTION 'game_sport too long.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.from_user_id <> OLD.from_user_id
       OR NEW.to_user_id <> OLD.to_user_id
       OR NEW.availability_id <> OLD.availability_id
       OR NEW.kind <> OLD.kind
       OR COALESCE(NEW.game_id,'') <> COALESCE(OLD.game_id,'') THEN
      RAISE EXCEPTION 'Identity fields are immutable.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('pending','accepted','declined','withdrawn') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;