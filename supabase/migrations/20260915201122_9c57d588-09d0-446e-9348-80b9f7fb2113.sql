-- Players may only edit their own submission while it is still pending, and may
-- never move it out of 'pending' through this policy (cancel/dispute has its own
-- policy; verify/reject stays host-only).
DROP POLICY IF EXISTS "Players update own pending submissions" ON public.payment_submissions;
CREATE POLICY "Players update own pending submissions"
  ON public.payment_submissions FOR UPDATE
  TO authenticated
  USING (player_id = auth.uid() AND status = 'pending')
  WITH CHECK (player_id = auth.uid() AND status = 'pending');

-- Defense in depth: a player can never write reviewer-owned columns.
CREATE OR REPLACE FUNCTION public.payment_submissions_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() = NEW.player_id AND NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'A new payment claim must start in host review'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- Reviewer-owned columns are host/service-role territory.
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.player_id
     AND auth.uid() IS DISTINCT FROM OLD.host_id THEN
    IF NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.paid_amount IS DISTINCT FROM OLD.paid_amount
       OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
       OR NEW.host_id IS DISTINCT FROM OLD.host_id
       OR NEW.player_id IS DISTINCT FROM OLD.player_id
       OR NEW.game_id IS DISTINCT FROM OLD.game_id THEN
      RAISE EXCEPTION 'Only the game host can confirm payment details'
        USING ERRCODE = 'P0001';
    END IF;
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