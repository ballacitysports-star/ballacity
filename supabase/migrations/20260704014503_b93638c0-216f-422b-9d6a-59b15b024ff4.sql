-- Add server-side idempotency key to join_requests so duplicate submissions
-- (rapid taps, multiple tabs, retries) cannot create multiple rows.
ALTER TABLE public.join_requests
  ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Backfill existing rows so we can enforce NOT NULL / uniqueness.
UPDATE public.join_requests
  SET idempotency_key = id::text
  WHERE idempotency_key IS NULL;

ALTER TABLE public.join_requests
  ALTER COLUMN idempotency_key SET NOT NULL;

-- Uniqueness is per-player so different players can reuse the same client-side key.
CREATE UNIQUE INDEX IF NOT EXISTS join_requests_player_idem_key
  ON public.join_requests (player_id, idempotency_key);

-- Enforce basic shape + immutability, and require the key on insert.
CREATE OR REPLACE FUNCTION public.validate_join_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _expected_host uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
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

    IF NEW.idempotency_key IS NULL OR length(NEW.idempotency_key) = 0 THEN
      RAISE EXCEPTION 'idempotency_key is required.';
    END IF;
    IF length(NEW.idempotency_key) > 200 THEN
      RAISE EXCEPTION 'idempotency_key too long (max 200 characters).';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.player_id <> OLD.player_id
       OR NEW.host_id   <> OLD.host_id
       OR NEW.game_id   <> OLD.game_id
       OR NEW.idempotency_key <> OLD.idempotency_key THEN
      RAISE EXCEPTION 'player_id, host_id, game_id, and idempotency_key are immutable.' USING ERRCODE = '42501';
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
$function$;