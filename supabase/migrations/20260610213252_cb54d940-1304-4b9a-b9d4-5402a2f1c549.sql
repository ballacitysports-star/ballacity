CREATE TABLE public.purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_session_id text NOT NULL UNIQUE,
  stripe_payment_intent_id text,
  stripe_customer_id text,
  product_id text NOT NULL,
  price_id text NOT NULL,
  amount_total integer NOT NULL,
  currency text NOT NULL DEFAULT 'usd',
  quantity integer NOT NULL DEFAULT 1,
  customer_email text,
  shipping_name text,
  shipping_address jsonb,
  status text NOT NULL DEFAULT 'paid',
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_purchases_user_id ON public.purchases(user_id);
GRANT SELECT, INSERT ON public.purchases TO authenticated;
GRANT ALL ON public.purchases TO service_role;
ALTER TABLE public.purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own purchases" ON public.purchases FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Service role manages purchases" ON public.purchases FOR ALL TO service_role USING (true) WITH CHECK (true);