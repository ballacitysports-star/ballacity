
-- ============= host_payment_methods =============
CREATE TABLE public.host_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_type text NOT NULL CHECK (payment_type IN ('venmo','cashapp','zelle','paypal','applecash','googlepay','cash','custom')),
  label text,
  username text,
  payment_url text,
  contact_info text,
  instructions text,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.host_payment_methods TO authenticated;
GRANT ALL ON public.host_payment_methods TO service_role;
ALTER TABLE public.host_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Payment methods readable by authenticated"
  ON public.host_payment_methods FOR SELECT TO authenticated USING (true);
CREATE POLICY "Hosts manage own payment methods (insert)"
  ON public.host_payment_methods FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts manage own payment methods (update)"
  ON public.host_payment_methods FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts manage own payment methods (delete)"
  ON public.host_payment_methods FOR DELETE TO authenticated USING (host_id = auth.uid());

CREATE TRIGGER trg_host_payment_methods_updated
  BEFORE UPDATE ON public.host_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_host_payment_methods_host ON public.host_payment_methods(host_id);

-- ============= game_payment_settings =============
CREATE TABLE public.game_payment_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_fee numeric(10,2) NOT NULL DEFAULT 0,
  accepted_method_ids uuid[] NOT NULL DEFAULT '{}',
  payment_deadline timestamptz,
  refund_policy text,
  payment_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, host_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_payment_settings TO authenticated;
GRANT ALL ON public.game_payment_settings TO service_role;
ALTER TABLE public.game_payment_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Game payment settings readable by authenticated"
  ON public.game_payment_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Hosts manage own game payment settings (insert)"
  ON public.game_payment_settings FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts manage own game payment settings (update)"
  ON public.game_payment_settings FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
CREATE POLICY "Hosts manage own game payment settings (delete)"
  ON public.game_payment_settings FOR DELETE TO authenticated USING (host_id = auth.uid());

CREATE TRIGGER trg_game_payment_settings_updated
  BEFORE UPDATE ON public.game_payment_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_game_payment_settings_game ON public.game_payment_settings(game_id);
CREATE INDEX idx_game_payment_settings_host ON public.game_payment_settings(host_id);

-- ============= payment_submissions =============
CREATE TABLE public.payment_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id text NOT NULL,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_method_id uuid REFERENCES public.host_payment_methods(id) ON DELETE SET NULL,
  payment_type text,
  screenshot_path text,
  transaction_reference text,
  notes text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  reviewer_notes text,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_submissions TO authenticated;
GRANT ALL ON public.payment_submissions TO service_role;
ALTER TABLE public.payment_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players see own submissions"
  ON public.payment_submissions FOR SELECT TO authenticated USING (player_id = auth.uid());
CREATE POLICY "Hosts see submissions for their games"
  ON public.payment_submissions FOR SELECT TO authenticated USING (host_id = auth.uid());
CREATE POLICY "Players create own submissions"
  ON public.payment_submissions FOR INSERT TO authenticated WITH CHECK (player_id = auth.uid());
CREATE POLICY "Hosts update submissions for their games"
  ON public.payment_submissions FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
CREATE POLICY "Players update own pending submissions"
  ON public.payment_submissions FOR UPDATE TO authenticated USING (player_id = auth.uid() AND status = 'pending') WITH CHECK (player_id = auth.uid());

CREATE INDEX idx_payment_submissions_game ON public.payment_submissions(game_id);
CREATE INDEX idx_payment_submissions_host ON public.payment_submissions(host_id);
CREATE INDEX idx_payment_submissions_player ON public.payment_submissions(player_id);

-- ============= Storage policies for payment-proofs bucket =============
-- Files stored as: payment-proofs/{auth.uid()}/{filename}
CREATE POLICY "Players upload own payment proofs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Players read own payment proofs"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Hosts read payment proofs for their games"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND EXISTS (
      SELECT 1 FROM public.payment_submissions s
      WHERE s.screenshot_path = name AND s.host_id = auth.uid()
    )
  );

CREATE POLICY "Players delete own payment proofs"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
