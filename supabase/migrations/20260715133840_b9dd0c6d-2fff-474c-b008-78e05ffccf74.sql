DROP POLICY IF EXISTS "Signed-in game viewers read payment settings" ON public.game_payment_settings;
DROP POLICY IF EXISTS "Host or linked players read payment settings" ON public.game_payment_settings;

CREATE POLICY "Signed-in users read payment settings"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION public.get_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO _settings
  FROM public.game_payment_settings gps
  WHERE gps.game_id = _game_id
    AND gps.host_id = _host_id
  ORDER BY gps.created_at DESC
  LIMIT 1;

  IF _settings.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (
        COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0
        OR hpm.id = ANY(_settings.accepted_method_ids)
      );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_host_payment_methods(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_host_payment_methods(uuid, text) TO authenticated;

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