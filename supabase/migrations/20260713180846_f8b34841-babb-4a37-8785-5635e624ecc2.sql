DROP POLICY IF EXISTS "Payment methods readable by host and their game participants" ON public.host_payment_methods;

CREATE POLICY "Enabled payment methods readable by authenticated users"
ON public.host_payment_methods
FOR SELECT
TO authenticated
USING (is_enabled = true OR host_id = auth.uid());