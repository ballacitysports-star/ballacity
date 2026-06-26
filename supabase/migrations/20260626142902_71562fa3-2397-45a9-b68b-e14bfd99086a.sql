DROP POLICY IF EXISTS "Game payment settings readable by host and game participants" ON public.game_payment_settings;

CREATE POLICY "Game payment settings readable by any authenticated user"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (true);