-- 1) game_participants: self-updates may only touch position.
CREATE OR REPLACE FUNCTION public.guard_participant_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  baseline public.game_participants;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.games g WHERE g.id = OLD.game_id AND g.host_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  baseline := OLD;
  baseline.position := NEW.position;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(baseline) THEN
    RAISE EXCEPTION 'PARTICIPANT_FIELD_FORBIDDEN: you may only change your own position.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_participant_self_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_participant_self_update ON public.game_participants;
CREATE TRIGGER trg_guard_participant_self_update
  BEFORE UPDATE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_participant_self_update();

-- 2) messages: a recipient may only set read_at.
CREATE OR REPLACE FUNCTION public.guard_message_recipient_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  baseline public.messages;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() = OLD.sender_id THEN
    RETURN NEW;
  END IF;

  baseline := OLD;
  baseline.read_at := NEW.read_at;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(baseline) THEN
    RAISE EXCEPTION 'MESSAGE_FIELD_FORBIDDEN: recipients may only mark a message read.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_message_recipient_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_message_recipient_update ON public.messages;
CREATE TRIGGER trg_guard_message_recipient_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_recipient_update();

-- 3) payment_submissions: during a player-driven state change, only the state
-- columns and the player's own notes may move.
CREATE OR REPLACE FUNCTION public.guard_payment_player_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  baseline public.payment_submissions;
BEGIN
  IF auth.uid() IS NULL
     OR auth.uid() <> OLD.player_id
     OR auth.uid() = OLD.host_id THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  baseline := OLD;
  baseline.status := NEW.status;
  baseline.notes := NEW.notes;
  baseline.cancellation_reason := NEW.cancellation_reason;
  baseline.cancelled_at := NEW.cancelled_at;
  baseline.dispute_reason := NEW.dispute_reason;
  baseline.disputed_at := NEW.disputed_at;
  baseline.disputed_by := NEW.disputed_by;

  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(baseline) THEN
    RAISE EXCEPTION 'PAYMENT_FIELD_FORBIDDEN: payment evidence and host review fields cannot be changed while cancelling or disputing.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_payment_player_fields() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_payment_player_fields ON public.payment_submissions;
CREATE TRIGGER trg_guard_payment_player_fields
  BEFORE UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.guard_payment_player_fields();