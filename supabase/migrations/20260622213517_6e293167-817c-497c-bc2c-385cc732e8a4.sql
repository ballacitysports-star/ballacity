
-- Player availability posts
CREATE TABLE public.player_availabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sports text[] NOT NULL DEFAULT '{}',
  skill_level text NOT NULL DEFAULT 'All Levels',
  starts_on date,
  ends_on date,
  recurring_days text[] NOT NULL DEFAULT '{}',
  city text,
  travel_radius_km integer NOT NULL DEFAULT 25,
  note text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.player_availabilities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_availabilities TO authenticated;
GRANT ALL ON public.player_availabilities TO service_role;

ALTER TABLE public.player_availabilities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Open availabilities are public"
  ON public.player_availabilities FOR SELECT
  USING (status = 'open' OR user_id = auth.uid());

CREATE POLICY "Users create own availability"
  ON public.player_availabilities FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own availability"
  ON public.player_availabilities FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users delete own availability"
  ON public.player_availabilities FOR DELETE
  TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER trg_player_availabilities_touch
  BEFORE UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX player_availabilities_open_idx
  ON public.player_availabilities (created_at DESC) WHERE status = 'open';
CREATE INDEX player_availabilities_user_idx
  ON public.player_availabilities (user_id);

-- Contact requests (formal interest from team/coach to player)
CREATE TABLE public.availability_contact_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_id uuid NOT NULL REFERENCES public.player_availabilities(id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (availability_id, from_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.availability_contact_requests TO authenticated;
GRANT ALL ON public.availability_contact_requests TO service_role;

ALTER TABLE public.availability_contact_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Sender or recipient can read"
  ON public.availability_contact_requests FOR SELECT
  TO authenticated USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

CREATE POLICY "Sender creates request"
  ON public.availability_contact_requests FOR INSERT
  TO authenticated WITH CHECK (from_user_id = auth.uid() AND from_user_id <> to_user_id);

CREATE POLICY "Recipient updates status"
  ON public.availability_contact_requests FOR UPDATE
  TO authenticated USING (to_user_id = auth.uid()) WITH CHECK (to_user_id = auth.uid());

CREATE POLICY "Sender deletes own request"
  ON public.availability_contact_requests FOR DELETE
  TO authenticated USING (from_user_id = auth.uid());

CREATE TRIGGER trg_availability_contact_requests_touch
  BEFORE UPDATE ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX acr_to_user_idx ON public.availability_contact_requests (to_user_id, created_at DESC);
CREATE INDEX acr_availability_idx ON public.availability_contact_requests (availability_id);
