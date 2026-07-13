
-- 1. Restrict game_payment_settings SELECT
DROP POLICY IF EXISTS "Game payment settings readable by any authenticated user" ON public.game_payment_settings;

CREATE POLICY "Game payment settings readable by host and involved players"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.join_requests jr
    WHERE jr.game_id = game_payment_settings.game_id
      AND jr.player_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.payment_submissions ps
    WHERE ps.game_id = game_payment_settings.game_id
      AND ps.player_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.game_participants gp
    WHERE gp.game_id = game_payment_settings.game_id
      AND gp.user_id = auth.uid()
  )
);

-- 2. Notifications: only self-inserts allowed via RLS (server fn uses service role)
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

CREATE POLICY "Users insert own notifications"
ON public.notifications
FOR INSERT
TO authenticated
WITH CHECK (user_id = auth.uid());

-- 3. auth_signin_events: allow owner SELECT
CREATE POLICY "Users see own signin events"
ON public.auth_signin_events
FOR SELECT
TO authenticated
USING (user_id = auth.uid());

-- 4. Revoke anon EXECUTE on SECURITY DEFINER trigger functions
REVOKE EXECUTE ON FUNCTION public.enforce_approval_before_payment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_hosted_game_joined_count() FROM PUBLIC, anon, authenticated;
