CREATE OR REPLACE FUNCTION public.game_payments_allowed(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT public.age_cohort_of(_user) NOT IN ('child_under_13', 'teen_13_15')
     AND NOT public.child_features_locked(_user);
$$;

REVOKE ALL ON FUNCTION public.game_payments_allowed(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.game_payments_allowed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.game_payments_allowed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.game_payments_allowed(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_game_payment_cohort()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.player_id IS NOT NULL AND NOT public.game_payments_allowed(NEW.player_id) THEN
    RAISE EXCEPTION 'PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this account yet.';
  END IF;
  IF NEW.host_id IS NOT NULL AND NOT public.game_payments_allowed(NEW.host_id) THEN
    RAISE EXCEPTION 'PAYMENTS_NOT_AVAILABLE: payment coordination is not available for this host account yet.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS enforce_game_payment_cohort ON public.payment_submissions;
CREATE TRIGGER enforce_game_payment_cohort
BEFORE INSERT OR UPDATE ON public.payment_submissions
FOR EACH ROW EXECUTE FUNCTION public.enforce_game_payment_cohort();