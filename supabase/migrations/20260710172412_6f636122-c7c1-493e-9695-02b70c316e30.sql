
CREATE TABLE public.auth_signin_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'google',
  event TEXT NOT NULL CHECK (event IN ('attempt','popup_blocked','retry_clicked','success','failure','copy_link_clicked')),
  error_message TEXT,
  user_agent TEXT,
  browser TEXT,
  platform TEXT,
  is_ios BOOLEAN,
  is_ios_chrome BOOLEAN,
  is_in_app_webview BOOLEAN,
  viewport_width INT,
  viewport_height INT
);

CREATE INDEX auth_signin_events_created_at_idx ON public.auth_signin_events (created_at DESC);
CREATE INDEX auth_signin_events_event_idx ON public.auth_signin_events (event);

GRANT INSERT ON public.auth_signin_events TO anon, authenticated;
GRANT SELECT ON public.auth_signin_events TO authenticated;
GRANT ALL ON public.auth_signin_events TO service_role;

ALTER TABLE public.auth_signin_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert signin events"
  ON public.auth_signin_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read signin events"
  ON public.auth_signin_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
