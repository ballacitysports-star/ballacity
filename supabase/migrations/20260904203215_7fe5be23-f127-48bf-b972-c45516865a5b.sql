CREATE OR REPLACE FUNCTION public.admin_revoke_user_sessions(_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n integer;
BEGIN
  IF _user_id IS NULL THEN RETURN 0; END IF;
  DELETE FROM auth.refresh_tokens WHERE user_id::text = _user_id::text;
  DELETE FROM auth.sessions WHERE user_id = _user_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_user_sessions(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_user_sessions(uuid) TO service_role;