
DROP POLICY IF EXISTS "Game payment settings readable by host and involved players" ON public.game_payment_settings;

CREATE POLICY "Game payment settings readable by authenticated users"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (true);
