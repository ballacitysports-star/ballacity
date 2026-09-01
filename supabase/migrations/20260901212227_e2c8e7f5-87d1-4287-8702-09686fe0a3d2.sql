-- 1. Extend payment submission states
ALTER TABLE public.payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_status_check;
ALTER TABLE public.payment_submissions
  ADD CONSTRAINT payment_submissions_status_check
  CHECK (status = ANY (ARRAY['pending','verified','rejected','disputed','cancelled']));

ALTER TABLE public.payment_submissions
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamptz,
  ADD COLUMN IF NOT EXISTS disputed_by uuid,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

ALTER TABLE public.payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_cancellation_reason_check;
ALTER TABLE public.payment_submissions
  ADD CONSTRAINT payment_submissions_cancellation_reason_check
  CHECK (cancellation_reason IS NULL OR cancellation_reason = ANY (
    ARRAY['host_cancelled','player_cancelled','game_cancelled','weather','dispute','other']));

ALTER TABLE public.payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_dispute_reason_len_check;
ALTER TABLE public.payment_submissions
  ADD CONSTRAINT payment_submissions_dispute_reason_len_check
  CHECK (dispute_reason IS NULL OR char_length(dispute_reason) <= 500);

-- 2. Players may cancel/dispute their own claim (hosts already have an update policy)
DROP POLICY IF EXISTS "Players cancel or dispute own submissions" ON public.payment_submissions;
CREATE POLICY "Players cancel or dispute own submissions"
  ON public.payment_submissions FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid())
  WITH CHECK (player_id = auth.uid() AND status = ANY (ARRAY['cancelled','disputed']));

-- 3. State guard: confirmation is host-only; players can never self-confirm
CREATE OR REPLACE FUNCTION public.payment_submissions_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A player claiming "payment sent" always lands in host review.
    IF auth.uid() = NEW.player_id AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'A new payment claim must start in host review'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('verified','rejected') AND auth.uid() IS DISTINCT FROM OLD.host_id THEN
      RAISE EXCEPTION 'Only the game host can confirm or decline a payment'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.status = 'disputed' AND NEW.disputed_at IS NULL THEN
      NEW.disputed_at := now();
      NEW.disputed_by := auth.uid();
    END IF;
    IF NEW.status = 'cancelled' AND NEW.cancelled_at IS NULL THEN
      NEW.cancelled_at := now();
    END IF;
    IF NEW.status IN ('verified','rejected') THEN
      NEW.reviewed_at := COALESCE(NEW.reviewed_at, now());
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payment_submissions_state_guard ON public.payment_submissions;
CREATE TRIGGER payment_submissions_state_guard
  BEFORE INSERT OR UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.payment_submissions_state_guard();

-- 4. Payment scam reports
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_subject_type_check;
ALTER TABLE public.user_reports
  ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type = ANY (ARRAY['user','game','message','reel','payment']));

ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_reason_check;
ALTER TABLE public.user_reports
  ADD CONSTRAINT user_reports_reason_check
  CHECK (reason = ANY (ARRAY['spam','harassment','inappropriate','impersonation','safety','other',
    'threats','fake_account','scam','unsafe_behavior','minor_safety','fake_game','unsafe_location',
    'misleading','illegal','payment_scam','payment_not_received','payment_pressure']));