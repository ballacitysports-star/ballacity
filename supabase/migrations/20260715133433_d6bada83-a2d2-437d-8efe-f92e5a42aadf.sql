CREATE OR REPLACE FUNCTION public.can_access_game_payment(_game_id text, _host_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _game_id IS NOT NULL
    AND _host_id IS NOT NULL
    AND _user_id IS NOT NULL
    AND (
      _host_id = _user_id
      OR EXISTS (
        SELECT 1
        FROM public.hosted_games hg
        WHERE hg.id = _game_id
          AND hg.host_id = _host_id
          AND COALESCE(hg.status, 'open') <> 'cancelled'
      )
      OR EXISTS (
        SELECT 1
        FROM public.join_requests jr
        WHERE jr.game_id = _game_id
          AND jr.host_id = _host_id
          AND jr.player_id = _user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.payment_submissions ps
        WHERE ps.game_id = _game_id
          AND ps.host_id = _host_id
          AND ps.player_id = _user_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.game_participants gp
        WHERE gp.game_id = _game_id
          AND gp.user_id = _user_id
      )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_game_payment(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_game_payment(text, uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Host or linked players read payment settings" ON public.game_payment_settings;

CREATE POLICY "Signed-in game viewers read payment settings"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (public.can_access_game_payment(game_id, host_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.get_game_payment_options(_game_id text)
RETURNS TABLE(
  settings jsonb,
  methods jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
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
  ORDER BY gps.created_at DESC
  LIMIT 1;

  IF _settings.id IS NULL THEN
    RETURN QUERY SELECT NULL::jsonb, '[]'::jsonb;
    RETURN;
  END IF;

  IF NOT public.can_access_game_payment(_settings.game_id, _settings.host_id, auth.uid()) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    to_jsonb(_settings) AS settings,
    COALESCE(
      jsonb_agg(
        to_jsonb(hpm) - 'created_at' - 'updated_at'
        ORDER BY hpm.created_at ASC
      ) FILTER (WHERE hpm.id IS NOT NULL),
      '[]'::jsonb
    ) AS methods
  FROM public.host_payment_methods hpm
  WHERE hpm.host_id = _settings.host_id
    AND hpm.is_enabled = true
    AND (
      COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0
      OR hpm.id = ANY(_settings.accepted_method_ids)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_game_payment_options(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_payment_options(text) TO authenticated;

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
       SELECT 1
       FROM public.game_payment_settings gps
       WHERE gps.host_id = _host_id
         AND public.can_access_game_payment(gps.game_id, gps.host_id, auth.uid())
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