
CREATE OR REPLACE FUNCTION public.change_account_type(_new_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _new_type NOT IN ('player','team','trainer','gym') THEN
    RAISE EXCEPTION 'Invalid account type: %', _new_type;
  END IF;

  -- Remove linked profiles owned by caller that don't match the new type.
  -- 'team' keeps teams(kind='team'); 'trainer' keeps teams(kind='coach'); others keep none.
  DELETE FROM public.teams
   WHERE owner_id = _me
     AND NOT (
       (_new_type = 'team'    AND kind = 'team') OR
       (_new_type = 'trainer' AND kind = 'coach')
     );

  -- Only 'gym' keeps trainer_orgs.
  IF _new_type <> 'gym' THEN
    DELETE FROM public.trainer_orgs WHERE owner_id = _me;
  END IF;

  UPDATE public.profiles SET account_type = _new_type WHERE id = _me;
END;
$$;

REVOKE ALL ON FUNCTION public.change_account_type(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.change_account_type(text) TO authenticated;
