
DROP POLICY IF EXISTS "Game payment settings readable by authenticated" ON public.game_payment_settings;
CREATE POLICY "Game payment settings readable by host and game participants"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = game_payment_settings.game_id AND jr.player_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.game_id = game_payment_settings.game_id AND ps.player_id = auth.uid())
);

DROP POLICY IF EXISTS "Payment methods readable by authenticated" ON public.host_payment_methods;
CREATE POLICY "Payment methods readable by host and their game participants"
ON public.host_payment_methods
FOR SELECT
TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.host_id = host_payment_methods.host_id AND jr.player_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.host_id = host_payment_methods.host_id AND ps.player_id = auth.uid())
);

DROP POLICY IF EXISTS "Authenticated insert notifications" ON public.notifications;
CREATE POLICY "Users insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users update own highlight videos" ON storage.objects;
CREATE POLICY "Users update own highlight videos"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'highlight-videos' AND (auth.uid())::text = (storage.foldername(name))[1])
WITH CHECK (bucket_id = 'highlight-videos' AND (auth.uid())::text = (storage.foldername(name))[1]);

DROP POLICY IF EXISTS "Players update own payment proofs" ON storage.objects;
CREATE POLICY "Players update own payment proofs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = (auth.uid())::text)
WITH CHECK (bucket_id = 'payment-proofs' AND (storage.foldername(name))[1] = (auth.uid())::text);

ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users subscribe to own realtime topics" ON realtime.messages;
CREATE POLICY "Users subscribe to own realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() LIKE ('user:' || (auth.uid())::text || ':%')
  OR realtime.topic() = ('user:' || (auth.uid())::text)
);
