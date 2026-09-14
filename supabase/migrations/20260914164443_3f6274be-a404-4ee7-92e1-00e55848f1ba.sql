ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS tier text,
  ADD COLUMN IF NOT EXISTS trial_end timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS subscriptions_user_env_status_idx
  ON public.subscriptions (user_id, environment, status);

ALTER TABLE public.game_payment_settings
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'direct_host';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_payment_settings_payment_mode_check'
  ) THEN
    ALTER TABLE public.game_payment_settings
      ADD CONSTRAINT game_payment_settings_payment_mode_check
      CHECK (payment_mode IN ('direct_host','ballacity_processed'));
  END IF;
END $$;

-- Maps a billing price identifier to a monetization tier. Legacy identifiers
-- stay mapped forever so existing subscribers never lose access.
CREATE OR REPLACE FUNCTION public.tier_for_price_id(_price_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE _price_id
    WHEN 'host_subscription_monthly' THEN 'host_pro'
    WHEN 'host_pro_monthly' THEN 'host_pro'
    WHEN 'ai_highlight_reel_monthly' THEN 'player_plus'
    WHEN 'ballacity_plus_monthly' THEN 'player_plus'
    WHEN 'team_plan_monthly' THEN 'team_pro'
    WHEN 'team_pro_monthly' THEN 'team_pro'
    WHEN 'org_plan_monthly' THEN 'org_pro'
    WHEN 'org_pro_monthly' THEN 'org_pro'
    WHEN 'facility_plan_monthly' THEN 'facility_pro'
    ELSE NULL
  END;
$$;

-- The single trusted entitlement check. Derived only from subscription rows
-- written by the verified billing webhook, never from client input.
CREATE OR REPLACE FUNCTION public.has_entitlement(
  _user_id uuid,
  _entitlement text,
  _env text DEFAULT 'sandbox'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.subscriptions s
    WHERE s.user_id = _user_id
      AND s.environment = _env
      AND COALESCE(s.tier, public.tier_for_price_id(s.price_id)) = _entitlement
      AND (
        (s.status IN ('active','trialing','past_due')
          AND (s.current_period_end IS NULL OR s.current_period_end > now()))
        OR (s.status = 'canceled' AND s.current_period_end > now())
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.tier_for_price_id(text) TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, description, is_public)
VALUES (
  'monetization',
  '{}'::jsonb,
  'Monetization overrides: plan display prices, trial days, platform/processing fees. Empty means use built-in defaults.',
  true
)
ON CONFLICT (key) DO NOTHING;