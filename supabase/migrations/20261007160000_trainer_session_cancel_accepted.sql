-- Let the person who booked a trainer session cancel it after the trainer has
-- accepted. Until now the sender could only cancel while the request was
-- still `pending`, so an accepted session had no way out.
--
-- An RLS policy can't compare old and new values, so widening it on its own
-- would let a sender flip their own request to `accepted`. The guard trigger
-- below keeps the sender's power to exactly one move: set the status to
-- `cancelled`.

DROP POLICY IF EXISTS "Sender can cancel own" ON public.trainer_session_requests;
CREATE POLICY "Sender can cancel own"
  ON public.trainer_session_requests FOR UPDATE TO authenticated
  USING (from_user_id = auth.uid() AND status IN ('pending', 'accepted'))
  WITH CHECK (from_user_id = auth.uid() AND status IN ('pending', 'accepted', 'cancelled'));

CREATE OR REPLACE FUNCTION public.guard_trainer_request_sender_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Only constrain the person who made the request. The trainer (recipient),
  -- the service role and database-side jobs go through unchanged.
  IF auth.uid() IS NULL OR auth.uid() <> OLD.from_user_id OR auth.uid() = OLD.to_user_id THEN
    RETURN NEW;
  END IF;

  IF NEW.from_user_id IS DISTINCT FROM OLD.from_user_id
     OR NEW.to_user_id IS DISTINCT FROM OLD.to_user_id
     OR NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
     OR NEW.responder_note IS DISTINCT FROM OLD.responder_note THEN
    RAISE EXCEPTION 'You can only cancel your own session request.' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'cancelled' THEN
    RAISE EXCEPTION 'You can only cancel your own session request.' USING ERRCODE = '42501';
  END IF;

  -- An accepted session is agreed; the requester can cancel it but not
  -- quietly move it to another time or change its terms.
  IF OLD.status = 'accepted' AND NEW.status = 'accepted' AND (
       NEW.session_type IS DISTINCT FROM OLD.session_type
    OR NEW.preferred_date IS DISTINCT FROM OLD.preferred_date
    OR NEW.preferred_start_time IS DISTINCT FROM OLD.preferred_start_time
    OR NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes
    OR NEW.message IS DISTINCT FROM OLD.message
  ) THEN
    RAISE EXCEPTION 'An accepted session can only be cancelled.' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trainer_session_sender_guard ON public.trainer_session_requests;
CREATE TRIGGER trainer_session_sender_guard
  BEFORE UPDATE ON public.trainer_session_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_trainer_request_sender_update();

-- Tell the trainer when someone cancels a session they had accepted. Done in
-- the database so it can't be skipped by a client that cancels and closes.
CREATE OR REPLACE FUNCTION public.notify_trainer_session_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _who text;
  _when text;
BEGIN
  IF OLD.status = 'accepted' AND NEW.status = 'cancelled' AND auth.uid() = OLD.from_user_id THEN
    SELECT display_name INTO _who FROM public.profiles WHERE id = OLD.from_user_id;
    _when := CASE
      WHEN OLD.preferred_date IS NOT NULL
        THEN to_char(OLD.preferred_date, 'Mon FMDD') ||
             CASE WHEN OLD.preferred_start_time IS NOT NULL
                  THEN ' at ' || to_char(OLD.preferred_start_time, 'FMHH12:MI AM') ELSE '' END
      ELSE NULL
    END;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      OLD.to_user_id,
      'trainer_session_cancelled',
      left(COALESCE(_who, 'A player') || ' cancelled their session', 200),
      COALESCE(OLD.session_type, 'Session') || COALESCE(' · ' || _when, '') ||
        '. That time is open again.',
      '/trainers/' || OLD.trainer_id
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_trainer_session_cancelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trainer_session_cancel_notify ON public.trainer_session_requests;
CREATE TRIGGER trainer_session_cancel_notify
  AFTER UPDATE ON public.trainer_session_requests
  FOR EACH ROW EXECUTE FUNCTION public.notify_trainer_session_cancelled();
