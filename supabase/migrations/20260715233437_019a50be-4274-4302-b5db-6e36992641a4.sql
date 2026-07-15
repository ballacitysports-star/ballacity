
CREATE TABLE public.payment_verification_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES public.payment_submissions(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL,
  host_id UUID NOT NULL,
  player_id UUID NOT NULL,
  actor_id UUID,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.payment_verification_events TO authenticated;
GRANT ALL ON public.payment_verification_events TO service_role;

ALTER TABLE public.payment_verification_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Host can view events for their games"
  ON public.payment_verification_events FOR SELECT
  TO authenticated
  USING (auth.uid() = host_id);

CREATE POLICY "Player can view events for their submissions"
  ON public.payment_verification_events FOR SELECT
  TO authenticated
  USING (auth.uid() = player_id);

CREATE POLICY "Host or player can insert events"
  ON public.payment_verification_events FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = host_id OR auth.uid() = player_id);

CREATE INDEX idx_pve_submission ON public.payment_verification_events(submission_id, created_at DESC);
CREATE INDEX idx_pve_game_player ON public.payment_verification_events(game_id, player_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.log_payment_verification_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _action TEXT;
  _from TEXT;
  _to TEXT;
  _notes TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _action := CASE WHEN NEW.status = 'verified' THEN 'created_verified'
                    WHEN NEW.status = 'rejected' THEN 'created_rejected'
                    ELSE 'submitted' END;
    _from := NULL;
    _to := NEW.status;
    _notes := NEW.reviewer_notes;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.reviewer_notes IS NOT DISTINCT FROM OLD.reviewer_notes THEN
      RETURN NEW;
    END IF;
    _action := CASE
      WHEN NEW.status = 'verified' THEN 'verified'
      WHEN NEW.status = 'rejected' THEN 'rejected'
      WHEN NEW.status = 'pending'  THEN 'reopened'
      ELSE 'updated'
    END;
    _from := OLD.status;
    _to := NEW.status;
    _notes := NEW.reviewer_notes;
  END IF;

  INSERT INTO public.payment_verification_events
    (submission_id, game_id, host_id, player_id, actor_id, action, from_status, to_status, notes)
  VALUES
    (NEW.id, NEW.game_id, NEW.host_id, NEW.player_id, auth.uid(), _action, _from, _to, _notes);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_payment_verification_event ON public.payment_submissions;
CREATE TRIGGER trg_log_payment_verification_event
  AFTER INSERT OR UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.log_payment_verification_event();
