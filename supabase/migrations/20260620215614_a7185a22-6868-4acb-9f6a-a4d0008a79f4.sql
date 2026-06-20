CREATE TABLE public.location_denial_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  code INTEGER,
  message TEXT,
  permission_state TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT ON public.location_denial_events TO anon, authenticated;
GRANT SELECT, DELETE ON public.location_denial_events TO authenticated;
GRANT ALL ON public.location_denial_events TO service_role;

ALTER TABLE public.location_denial_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can record a denial event"
  ON public.location_denial_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "Admins can read denial events"
  ON public.location_denial_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete denial events"
  ON public.location_denial_events
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_location_denial_events_reason_at
  ON public.location_denial_events (reason, created_at DESC);
CREATE INDEX idx_location_denial_events_created_at
  ON public.location_denial_events (created_at DESC);