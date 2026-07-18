
CREATE TABLE public.trainer_session_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_type text NOT NULL DEFAULT '1:1 Coaching',
  preferred_date date,
  duration_minutes int NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 15 AND 240),
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled','completed')),
  responder_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tsr_trainer_idx ON public.trainer_session_requests(trainer_id, created_at DESC);
CREATE INDEX tsr_from_idx ON public.trainer_session_requests(from_user_id, created_at DESC);
CREATE INDEX tsr_to_idx ON public.trainer_session_requests(to_user_id, created_at DESC);
CREATE UNIQUE INDEX tsr_unique_pending ON public.trainer_session_requests(trainer_id, from_user_id) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_session_requests TO authenticated;
GRANT ALL ON public.trainer_session_requests TO service_role;

ALTER TABLE public.trainer_session_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sender or recipient can read"
  ON public.trainer_session_requests FOR SELECT TO authenticated
  USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

CREATE POLICY "Sender creates request"
  ON public.trainer_session_requests FOR INSERT TO authenticated
  WITH CHECK (from_user_id = auth.uid() AND from_user_id <> to_user_id);

CREATE POLICY "Recipient updates status"
  ON public.trainer_session_requests FOR UPDATE TO authenticated
  USING (to_user_id = auth.uid())
  WITH CHECK (to_user_id = auth.uid());

CREATE POLICY "Sender can cancel own"
  ON public.trainer_session_requests FOR UPDATE TO authenticated
  USING (from_user_id = auth.uid() AND status = 'pending')
  WITH CHECK (from_user_id = auth.uid() AND status IN ('pending','cancelled'));

CREATE POLICY "Sender deletes own"
  ON public.trainer_session_requests FOR DELETE TO authenticated
  USING (from_user_id = auth.uid());

CREATE TRIGGER trainer_session_requests_touch
  BEFORE UPDATE ON public.trainer_session_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.trainer_session_requests;
