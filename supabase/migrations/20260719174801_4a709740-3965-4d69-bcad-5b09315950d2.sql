
-- Enum for org member roles
DO $$ BEGIN
  CREATE TYPE public.trainer_org_role AS ENUM ('owner','admin','member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================
-- trainer_orgs
-- =========================================================
CREATE TABLE public.trainer_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  handle text NOT NULL UNIQUE,
  bio text,
  avatar text,
  city text,
  website text,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_orgs TO authenticated;
GRANT ALL ON public.trainer_orgs TO service_role;
ALTER TABLE public.trainer_orgs ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- trainer_org_members
-- =========================================================
CREATE TABLE public.trainer_org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  trainer_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.trainer_org_role NOT NULL DEFAULT 'member',
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, trainer_id)
);
CREATE INDEX idx_trainer_org_members_org ON public.trainer_org_members(org_id);
CREATE INDEX idx_trainer_org_members_trainer ON public.trainer_org_members(trainer_id);
CREATE INDEX idx_trainer_org_members_user ON public.trainer_org_members(user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_org_members TO authenticated;
GRANT ALL ON public.trainer_org_members TO service_role;
ALTER TABLE public.trainer_org_members ENABLE ROW LEVEL SECURITY;

-- Security definer helpers (created early so policies can use them)
CREATE OR REPLACE FUNCTION public.is_trainer_org_member(_org uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.trainer_org_members
                 WHERE org_id = _org AND user_id = _user);
$$;

CREATE OR REPLACE FUNCTION public.is_trainer_org_admin(_org uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trainer_org_members
    WHERE org_id = _org AND user_id = _user AND role IN ('owner','admin')
  ) OR EXISTS (
    SELECT 1 FROM public.trainer_orgs WHERE id = _org AND owner_id = _user
  );
$$;

-- =========================================================
-- trainer_org_invites
-- =========================================================
CREATE TABLE public.trainer_org_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  invited_trainer_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  invited_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.trainer_org_role NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','revoked')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  UNIQUE (org_id, invited_trainer_id, status) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_trainer_org_invites_org ON public.trainer_org_invites(org_id);
CREATE INDEX idx_trainer_org_invites_user ON public.trainer_org_invites(invited_user_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_org_invites TO authenticated;
GRANT ALL ON public.trainer_org_invites TO service_role;
ALTER TABLE public.trainer_org_invites ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- trainer_org_join_requests
-- =========================================================
CREATE TABLE public.trainer_org_join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  trainer_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  reviewer_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (org_id, trainer_id, status) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_trainer_org_join_org ON public.trainer_org_join_requests(org_id);
CREATE INDEX idx_trainer_org_join_trainer ON public.trainer_org_join_requests(trainer_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trainer_org_join_requests TO authenticated;
GRANT ALL ON public.trainer_org_join_requests TO service_role;
ALTER TABLE public.trainer_org_join_requests ENABLE ROW LEVEL SECURITY;

-- =========================================================
-- Policies
-- =========================================================

-- trainer_orgs
CREATE POLICY "orgs are viewable by authenticated"
  ON public.trainer_orgs FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated can create orgs"
  ON public.trainer_orgs FOR INSERT TO authenticated
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "owner or admin can update org"
  ON public.trainer_orgs FOR UPDATE TO authenticated
  USING (owner_id = auth.uid() OR public.is_trainer_org_admin(id, auth.uid()))
  WITH CHECK (owner_id = auth.uid() OR public.is_trainer_org_admin(id, auth.uid()));
CREATE POLICY "owner can delete org"
  ON public.trainer_orgs FOR DELETE TO authenticated
  USING (owner_id = auth.uid());

-- trainer_org_members
CREATE POLICY "members visible to authenticated"
  ON public.trainer_org_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "owner/admin can add members directly"
  ON public.trainer_org_members FOR INSERT TO authenticated
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()));
CREATE POLICY "member can leave; admin/owner can remove others (not owner)"
  ON public.trainer_org_members FOR DELETE TO authenticated
  USING (
    (user_id = auth.uid() AND role <> 'owner')
    OR (public.is_trainer_org_admin(org_id, auth.uid()) AND role <> 'owner')
  );
CREATE POLICY "owner/admin can change roles"
  ON public.trainer_org_members FOR UPDATE TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()))
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()));

-- trainer_org_invites
CREATE POLICY "invite visible to org admins or invitee"
  ON public.trainer_org_invites FOR SELECT TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR invited_by = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  );
CREATE POLICY "owner/admin can create invites"
  ON public.trainer_org_invites FOR INSERT TO authenticated
  WITH CHECK (
    invited_by = auth.uid()
    AND public.is_trainer_org_admin(org_id, auth.uid())
  );
CREATE POLICY "invitee can respond; admin can revoke"
  ON public.trainer_org_invites FOR UPDATE TO authenticated
  USING (
    invited_user_id = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  )
  WITH CHECK (
    invited_user_id = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  );
CREATE POLICY "admin can delete invites"
  ON public.trainer_org_invites FOR DELETE TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()) OR invited_by = auth.uid());

-- trainer_org_join_requests
CREATE POLICY "join req visible to requester or org admin"
  ON public.trainer_org_join_requests FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  );
CREATE POLICY "trainer owner can create join request"
  ON public.trainer_org_join_requests FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = trainer_id AND t.owner_id = auth.uid() AND t.kind = 'coach'
    )
  );
CREATE POLICY "requester or admin can update join request"
  ON public.trainer_org_join_requests FOR UPDATE TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  )
  WITH CHECK (
    requested_by = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  );
CREATE POLICY "requester or admin can delete join request"
  ON public.trainer_org_join_requests FOR DELETE TO authenticated
  USING (
    requested_by = auth.uid()
    OR public.is_trainer_org_admin(org_id, auth.uid())
  );

-- =========================================================
-- RPCs
-- =========================================================
CREATE OR REPLACE FUNCTION public.accept_trainer_org_invite(_invite uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role)
  VALUES (_inv.org_id, _inv.invited_trainer_id, _me, _inv.role)
  ON CONFLICT (org_id, trainer_id) DO UPDATE SET role = EXCLUDED.role
  RETURNING id INTO _member_id;

  UPDATE public.trainer_org_invites
    SET status = 'accepted', responded_at = now()
    WHERE id = _invite;

  RETURN _member_id;
END $$;

CREATE OR REPLACE FUNCTION public.approve_trainer_org_join(_req uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _r public.trainer_org_join_requests%ROWTYPE;
  _member_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  SELECT * INTO _r FROM public.trainer_org_join_requests WHERE id = _req;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.is_trainer_org_admin(_r.org_id, _me) THEN
    RAISE EXCEPTION 'Only org owner/admin can approve' USING ERRCODE='42501';
  END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;

  INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role)
  VALUES (_r.org_id, _r.trainer_id, _r.requested_by, 'member')
  ON CONFLICT (org_id, trainer_id) DO NOTHING
  RETURNING id INTO _member_id;

  UPDATE public.trainer_org_join_requests
    SET status = 'approved', reviewed_at = now()
    WHERE id = _req;

  RETURN _member_id;
END $$;

-- Auto-add creator as owner-member when trainer profile provided
CREATE OR REPLACE FUNCTION public.create_trainer_org_with_owner(
  _name text, _handle text, _trainer_id text,
  _bio text DEFAULT NULL, _avatar text DEFAULT NULL,
  _city text DEFAULT NULL, _website text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _org_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = _trainer_id AND owner_id = _me AND kind = 'coach') THEN
    RAISE EXCEPTION 'Trainer profile not owned by caller' USING ERRCODE='42501';
  END IF;

  INSERT INTO public.trainer_orgs (owner_id, name, handle, bio, avatar, city, website)
  VALUES (_me, _name, _handle, _bio, _avatar, _city, _website)
  RETURNING id INTO _org_id;

  INSERT INTO public.trainer_org_members (org_id, trainer_id, user_id, role)
  VALUES (_org_id, _trainer_id, _me, 'owner');

  RETURN _org_id;
END $$;

-- Updated_at trigger for trainer_orgs
CREATE TRIGGER trg_trainer_orgs_updated_at
  BEFORE UPDATE ON public.trainer_orgs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
