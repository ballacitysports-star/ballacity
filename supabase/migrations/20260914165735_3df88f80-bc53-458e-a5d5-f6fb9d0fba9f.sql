CREATE OR REPLACE FUNCTION public.enforce_direct_host_payment_mode()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  enabled boolean := false;
BEGIN
  IF NEW.payment_mode IS NULL THEN
    NEW.payment_mode := 'direct_host';
  END IF;

  IF NEW.payment_mode = 'ballacity_processed' THEN
    SELECT COALESCE((value->>'ballacityProcessedPaymentsEnabled')::boolean, false)
      INTO enabled
      FROM public.app_settings
     WHERE key = 'monetization';

    IF NOT COALESCE(enabled, false) THEN
      RAISE EXCEPTION 'ballaCity does not process game payments yet — hosts collect directly';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_direct_host_payment_mode_trg ON public.game_payment_settings;
CREATE TRIGGER enforce_direct_host_payment_mode_trg
BEFORE INSERT OR UPDATE ON public.game_payment_settings
FOR EACH ROW EXECUTE FUNCTION public.enforce_direct_host_payment_mode();