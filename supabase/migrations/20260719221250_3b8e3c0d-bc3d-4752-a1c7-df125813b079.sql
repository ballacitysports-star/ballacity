
ALTER TABLE public.trainer_orgs
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS place_id text,
  ADD COLUMN IF NOT EXISTS geo jsonb;

CREATE OR REPLACE FUNCTION public.create_trainer_org_with_owner(
  _name text,
  _handle text,
  _trainer_id text,
  _bio text DEFAULT NULL,
  _avatar text DEFAULT NULL,
  _city text DEFAULT NULL,
  _website text DEFAULT NULL,
  _address text DEFAULT NULL,
  _place_id text DEFAULT NULL,
  _geo jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _me uuid := auth.uid();
  _org_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = _trainer_id AND owner_id = _me AND kind = 'coach') THEN
    RAISE EXCEPTION 'Trainer profile not owned by caller' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.trainer_orgs (owner_id, name, handle, bio, avatar, city, website, address, place_id, geo)
  VALUES (_me, _name, _handle, _bio, _avatar, _city, _website, _address, _place_id, _geo)
  RETURNING id INTO _org_id;

  INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role)
  VALUES (_org_id, _trainer_id, _me, 'owner');

  RETURN _org_id;
END $$;
