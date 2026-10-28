-- A trainer's facility shows on their public profile, so only the trainer can put
-- it there.
--
-- Probing the schema found three ways to attach someone else's trainer profile to
-- a facility. Anyone can create a facility and so be its admin, and in every case
-- the trainer could neither see the row nor remove it (they are only allowed to
-- touch rows carrying their own user id):
--
--   1. The direct-add insert policy let an admin write any (trainer_id, user_id).
--   2. An invite could name one user and another person's trainer profile;
--      accept_trainer_org_invite then wrote the profile of the invite, not of the
--      person accepting.
--   3. An admin could update an existing member row to point at another profile.
--
-- Joining is by invite (the trainer accepts) or join request (the trainer asks);
-- both are SECURITY DEFINER paths that write the row as the table's owner. The app
-- never writes another person's membership directly, so the direct path is closed.

-- Does this user own this trainer profile?
CREATE OR REPLACE FUNCTION public.trainer_profile_owned_by(_trainer text, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
     WHERE t.id = _trainer AND t.owner_id = _user AND t.kind = 'coach'
  );
$$;
REVOKE ALL ON FUNCTION public.trainer_profile_owned_by(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.trainer_profile_owned_by(text, uuid) TO authenticated, service_role;

-- 1. An admin may add their own trainer profile, not anyone else's.
DROP POLICY IF EXISTS "owner/admin can add members directly" ON public.trainer_org_members;
DROP POLICY IF EXISTS "admin can add their own trainer profile" ON public.trainer_org_members;
CREATE POLICY "admin can add their own trainer profile"
ON public.trainer_org_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_trainer_org_admin(org_id, auth.uid())
  AND user_id = auth.uid()
  AND public.trainer_profile_owned_by(trainer_id, auth.uid())
  AND (
    role <> 'owner'::trainer_org_role
    OR EXISTS (
      SELECT 1 FROM public.trainer_org_members me
       WHERE me.org_id = trainer_org_members.org_id
         AND me.user_id = auth.uid()
         AND me.role = 'owner'::trainer_org_role
    )
  )
);

-- 2. An invite names a trainer profile that belongs to the person invited.
DROP POLICY IF EXISTS "owner/admin can create invites" ON public.trainer_org_invites;
CREATE POLICY "owner/admin can create invites"
ON public.trainer_org_invites
FOR INSERT
TO authenticated
WITH CHECK (
  invited_by = auth.uid()
  AND public.is_trainer_org_admin(org_id, auth.uid())
  AND public.trainer_profile_owned_by(invited_trainer_id, invited_user_id)
);

-- ...and accepting it checks the same, for invites made before this rule.
CREATE OR REPLACE FUNCTION public.accept_trainer_org_invite(_invite uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _inv public.trainer_org_invites%ROWTYPE;
  _member_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  SELECT * INTO _inv FROM public.trainer_org_invites WHERE id = _invite;
  IF _inv.id IS NULL THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.invited_user_id <> _me THEN RAISE EXCEPTION 'Not your invite' USING ERRCODE='42501'; END IF;
  IF _inv.status <> 'pending' THEN RAISE EXCEPTION 'Invite is no longer pending'; END IF;
  IF NOT public.trainer_profile_owned_by(_inv.invited_trainer_id, _me) THEN
    RAISE EXCEPTION 'That trainer profile is not yours' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role)
  VALUES (_inv.org_id, _inv.invited_trainer_id, _me, _inv.role)
  ON CONFLICT (org_id, trainer_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING id INTO _member_id;

  UPDATE public.trainer_org_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = _invite;

  RETURN _member_id;
END $$;

-- 3. A member row keeps its org, trainer profile and person; only the role changes.
CREATE OR REPLACE FUNCTION public.guard_trainer_org_member_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.org_id IS DISTINCT FROM OLD.org_id
     OR NEW.trainer_id IS DISTINCT FROM OLD.trainer_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'MEMBER_IDENTITY_LOCKED: only the role of a facility member can be changed.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_trainer_org_member_identity() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_trainer_org_member_identity ON public.trainer_org_members;
CREATE TRIGGER trg_guard_trainer_org_member_identity
BEFORE UPDATE ON public.trainer_org_members
FOR EACH ROW EXECUTE FUNCTION public.guard_trainer_org_member_identity();

-- Rows written before this rule that name a profile the person does not own are
-- not removed here (that is a decision for a person); they are counted so they
-- can be looked at:
--   SELECT m.* FROM trainer_org_members m
--   LEFT JOIN teams t ON t.id = m.trainer_id
--   WHERE t.owner_id IS DISTINCT FROM m.user_id;
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n
    FROM public.trainer_org_members m
    LEFT JOIN public.teams t ON t.id = m.trainer_id
   WHERE t.owner_id IS DISTINCT FROM m.user_id;
  RAISE NOTICE 'trainer_org_members rows whose trainer profile is not owned by their user: %', n;
END $$;
