
-- 1) Restrict get_host_payment_methods to the host or players linked to a game hosted by _host_id
CREATE OR REPLACE FUNCTION public.get_host_payment_methods(_host_id uuid)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF auth.uid() = _host_id
     OR EXISTS (
       SELECT 1 FROM public.join_requests jr
       WHERE jr.host_id = _host_id AND jr.player_id = auth.uid() AND jr.status = 'approved'
     )
     OR EXISTS (
       SELECT 1 FROM public.payment_submissions ps
       WHERE ps.host_id = _host_id AND ps.player_id = auth.uid()
     )
     OR EXISTS (
       SELECT 1 FROM public.game_participants gp
       JOIN public.hosted_games hg ON hg.id = gp.game_id
       WHERE hg.host_id = _host_id AND gp.user_id = auth.uid()
     )
  THEN
    RETURN QUERY
      SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
      FROM public.host_payment_methods hpm
      WHERE hpm.host_id = _host_id AND hpm.is_enabled = true;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_host_payment_methods(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_host_payment_methods(uuid) TO authenticated;

-- 2) game_payment_settings: restrict SELECT to host and linked players
DROP POLICY IF EXISTS "Game payment settings readable by authenticated users" ON public.game_payment_settings;
CREATE POLICY "Host or linked players read payment settings"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = game_payment_settings.game_id AND jr.player_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.game_id = game_payment_settings.game_id AND ps.player_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = game_payment_settings.game_id AND gp.user_id = auth.uid())
);

-- 3) game_participants: restrict SELECT to host and same-game participants
DROP POLICY IF EXISTS "Authenticated can view participants" ON public.game_participants;
CREATE POLICY "Host or same-game participants view roster"
ON public.game_participants
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.hosted_games hg WHERE hg.id = game_participants.game_id AND hg.host_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.game_participants gp2 WHERE gp2.game_id = game_participants.game_id AND gp2.user_id = auth.uid())
);

-- 4) game_position_waitlist: restrict SELECT to host and the waitlisted user
DROP POLICY IF EXISTS "Authenticated can view waitlist" ON public.game_position_waitlist;
CREATE POLICY "Host or waitlisted user view waitlist"
ON public.game_position_waitlist
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.hosted_games hg WHERE hg.id = game_position_waitlist.game_id AND hg.host_id = auth.uid())
);

-- 5) player_availabilities: no more anonymous access
DROP POLICY IF EXISTS "Open availabilities are public" ON public.player_availabilities;
CREATE POLICY "Open availabilities visible to authenticated users"
ON public.player_availabilities
FOR SELECT
TO authenticated
USING (status = 'open' OR user_id = auth.uid());

-- 6) profiles: no more anonymous access (birthday and other personal fields)
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Profiles viewable by authenticated users"
ON public.profiles
FOR SELECT
TO authenticated
USING (true);

-- 7) auth_signin_events: prevent spoofing another user's id in inserted rows
DROP POLICY IF EXISTS "Anyone can insert signin events" ON public.auth_signin_events;
CREATE POLICY "Users insert own signin events"
ON public.auth_signin_events
FOR INSERT
TO anon, authenticated
WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- 8) Notification-target relationship helper (used by server functions)
CREATE OR REPLACE FUNCTION public.can_notify(_caller uuid, _target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  SELECT
    _caller IS NOT NULL AND _target IS NOT NULL AND (
      _caller = _target
      OR EXISTS (
        SELECT 1
        FROM public.conversation_participants a
        JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
        WHERE a.user_id = _caller AND b.user_id = _target
      )
      OR EXISTS (
        SELECT 1 FROM public.join_requests jr
        WHERE (jr.host_id = _caller AND jr.player_id = _target)
           OR (jr.host_id = _target AND jr.player_id = _caller)
      )
      OR EXISTS (
        SELECT 1 FROM public.game_participants gp
        JOIN public.hosted_games hg ON hg.id = gp.game_id
        WHERE (hg.host_id = _caller AND gp.user_id = _target)
           OR (hg.host_id = _target AND gp.user_id = _caller)
      )
      OR EXISTS (
        SELECT 1 FROM public.game_participants a
        JOIN public.game_participants b ON b.game_id = a.game_id
        WHERE a.user_id = _caller AND b.user_id = _target
      )
      OR EXISTS (
        SELECT 1 FROM public.availability_contact_requests acr
        WHERE (acr.from_user_id = _caller AND acr.to_user_id = _target)
           OR (acr.from_user_id = _target AND acr.to_user_id = _caller)
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_notify(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_notify(uuid, uuid) TO authenticated, service_role;
