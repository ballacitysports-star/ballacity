DROP POLICY IF EXISTS "Enabled payment methods readable by authenticated users" ON public.host_payment_methods;

CREATE POLICY "Hosts read own payment methods"
  ON public.host_payment_methods FOR SELECT
  TO authenticated
  USING (host_id = auth.uid());

CREATE OR REPLACE FUNCTION public.get_host_payment_methods(_host_id uuid)
RETURNS TABLE (
  id uuid,
  host_id uuid,
  payment_type text,
  label text,
  username text,
  payment_url text,
  contact_info text,
  instructions text,
  is_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, host_id, payment_type, label, username, payment_url, contact_info, instructions, is_enabled
  FROM public.host_payment_methods
  WHERE host_id = _host_id AND is_enabled = true;
$$;

REVOKE ALL ON FUNCTION public.get_host_payment_methods(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_host_payment_methods(uuid) TO authenticated;