-- Close the payment-dispute integrity gap: a player could rewrite their own
-- claimed payment evidence in the very statement that disputes or cancels it.
--
-- `payment_submissions_state_guard` (20260915201122) already freezes
-- reviewer-owned columns (reviewer_notes, paid_amount, paid_at, host_id,
-- player_id, game_id) against the player. It does not touch the columns that
-- describe the player's own claim: payment_method_id, payment_type,
-- transaction_reference, screenshot_path, submitted_at. The "Players cancel
-- or dispute own submissions" policy (20260901212227) only constrains
-- player_id and the new status, so nothing stops a player from swapping in a
-- different screenshot, transaction reference, or payment method in the same
-- UPDATE that flips status to 'disputed' or 'cancelled' — or in any later
-- update while the row sits in a non-pending state — silently rewriting the
-- evidence the host (or a moderator resolving the dispute) is meant to be
-- reviewing.
--
-- `notes` is deliberately left out: cancelMyPaymentSubmission
-- (src/lib/payments.ts) legitimately lets a player attach a note when they
-- cancel their own claim, and that's a comment, not payment evidence.
--
-- Fields stay editable while the row is genuinely pending on both sides
-- (OLD.status = NEW.status = 'pending'), matching "Players update own
-- pending submissions". The moment either side of the transition leaves
-- pending, the claim is locked for the player.
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

  -- Core claim metadata (how/what the player says they paid) is locked once
  -- the submission leaves pending review. Disputing or cancelling a claim may
  -- only set a reason/note and flip status — never rewrite the payment
  -- method, transaction reference, or proof the host is reviewing.
  IF auth.uid() IS NOT NULL
     AND auth.uid() = OLD.player_id
     AND auth.uid() IS DISTINCT FROM OLD.host_id
     AND (OLD.status <> 'pending' OR NEW.status <> 'pending') THEN
    IF NEW.payment_method_id IS DISTINCT FROM OLD.payment_method_id
       OR NEW.payment_type IS DISTINCT FROM OLD.payment_type
       OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
       OR NEW.screenshot_path IS DISTINCT FROM OLD.screenshot_path
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
      RAISE EXCEPTION 'Payment claim details are locked once a submission leaves pending review'
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

REVOKE ALL ON FUNCTION public.payment_submissions_state_guard() FROM anon, authenticated, PUBLIC;
