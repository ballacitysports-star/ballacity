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
  SELECT CASE
    WHEN auth.uid() IS NOT NULL
      AND _user_id <> auth.uid()
      AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'))
    THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.subscriptions s
      WHERE s.user_id = _user_id
        AND s.environment = _env
        AND COALESCE(s.tier, public.tier_for_price_id(s.price_id)) = _entitlement
        AND (
          (s.status IN ('active','trialing','past_due')
            AND (s.current_period_end IS NULL OR s.current_period_end > now()))
          OR (s.status = 'canceled' AND s.current_period_end > now())
        )
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.tier_for_price_id(text) FROM anon;