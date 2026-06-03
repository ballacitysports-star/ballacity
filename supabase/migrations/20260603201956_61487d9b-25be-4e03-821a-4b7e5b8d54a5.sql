
ALTER TABLE public.game_payment_settings ADD COLUMN IF NOT EXISTS requires_approval boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  player_id uuid NOT NULL,
  host_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  message text,
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (game_id, player_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.join_requests TO authenticated;
GRANT ALL ON public.join_requests TO service_role;

ALTER TABLE public.join_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players see own join requests" ON public.join_requests
  FOR SELECT TO authenticated USING (player_id = auth.uid());
CREATE POLICY "Hosts see join requests for their games" ON public.join_requests
  FOR SELECT TO authenticated USING (host_id = auth.uid());
CREATE POLICY "Players create own join requests" ON public.join_requests
  FOR INSERT TO authenticated WITH CHECK (player_id = auth.uid());
CREATE POLICY "Players cancel own pending join requests" ON public.join_requests
  FOR DELETE TO authenticated USING (player_id = auth.uid() AND status = 'pending');
CREATE POLICY "Hosts review join requests" ON public.join_requests
  FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());

-- Allow players to withdraw payment submissions (delete own pending)
CREATE POLICY "Players delete own pending submissions" ON public.payment_submissions
  FOR DELETE TO authenticated USING (player_id = auth.uid() AND status = 'pending');
