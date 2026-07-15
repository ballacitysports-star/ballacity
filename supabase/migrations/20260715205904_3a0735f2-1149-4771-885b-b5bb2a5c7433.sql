
ALTER TABLE public.join_requests
  ADD COLUMN IF NOT EXISTS attempt_count int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_rejected_at timestamptz;

-- Backfill last_rejected_at for existing rejected rows so cooldown behaves
-- reasonably after deploy.
UPDATE public.join_requests
  SET last_rejected_at = COALESCE(last_rejected_at, reviewed_at, created_at)
  WHERE status = 'rejected' AND last_rejected_at IS NULL;

-- Enforce cooldown + attempt cap on resubmit, and stamp last_rejected_at on rejection.
CREATE OR REPLACE FUNCTION public.enforce_join_request_resubmit_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _cooldown constant interval := interval '15 minutes';
  _cap constant int := 3;
  _remaining int;
BEGIN
  -- Player resubmit: rejected -> pending
  IF OLD.status = 'rejected' AND NEW.status = 'pending' THEN
    IF COALESCE(OLD.attempt_count, 1) >= _cap THEN
      RAISE EXCEPTION 'You have reached the maximum of % resubmit attempts for this game.', _cap
        USING ERRCODE = 'P0001';
    END IF;
    IF OLD.last_rejected_at IS NOT NULL
       AND OLD.last_rejected_at + _cooldown > now() THEN
      _remaining := GREATEST(
        1,
        CEIL(EXTRACT(EPOCH FROM ((OLD.last_rejected_at + _cooldown) - now())))::int
      );
      RAISE EXCEPTION 'Please wait % seconds before resubmitting this request.', _remaining
        USING ERRCODE = 'P0001';
    END IF;
    NEW.attempt_count := COALESCE(OLD.attempt_count, 1) + 1;
    NEW.reviewer_notes := NULL;
    NEW.reviewed_at := NULL;
  END IF;

  -- Host reject: any -> rejected
  IF OLD.status <> 'rejected' AND NEW.status = 'rejected' THEN
    NEW.last_rejected_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_join_request_resubmit_rules ON public.join_requests;
CREATE TRIGGER trg_enforce_join_request_resubmit_rules
  BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_join_request_resubmit_rules();

-- Allow the player to resubmit their own declined request (rejected -> pending).
-- Host approve/decline policy remains unchanged.
DROP POLICY IF EXISTS "Players resubmit rejected requests" ON public.join_requests;
CREATE POLICY "Players resubmit rejected requests"
  ON public.join_requests
  FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid() AND status = 'rejected')
  WITH CHECK (player_id = auth.uid() AND status = 'pending');
