
-- org_members: generic (non-trainer) membership
CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_members TO authenticated;
GRANT SELECT ON public.org_members TO anon;
GRANT ALL ON public.org_members TO service_role;

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view org members"
  ON public.org_members FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert org members"
  ON public.org_members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()));

CREATE POLICY "Admins or self can delete org members"
  ON public.org_members FOR DELETE
  TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()) OR user_id = auth.uid());

CREATE POLICY "Admins can update org members"
  ON public.org_members FOR UPDATE
  TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()))
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()));

-- org_member_requests
CREATE TABLE public.org_member_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.trainer_orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  message text,
  status text NOT NULL DEFAULT 'pending',
  denial_reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX org_member_requests_one_open_per_user
  ON public.org_member_requests (org_id, user_id)
  WHERE status = 'pending';

CREATE INDEX org_member_requests_org_status_idx
  ON public.org_member_requests (org_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_member_requests TO authenticated;
GRANT ALL ON public.org_member_requests TO service_role;

ALTER TABLE public.org_member_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Requester can view own requests"
  ON public.org_member_requests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins can view org requests"
  ON public.org_member_requests FOR SELECT
  TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()));

CREATE POLICY "Requester can insert own request"
  ON public.org_member_requests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Requester can update own request"
  ON public.org_member_requests FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Admins can update org requests"
  ON public.org_member_requests FOR UPDATE
  TO authenticated
  USING (public.is_trainer_org_admin(org_id, auth.uid()))
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()));

CREATE TRIGGER org_member_requests_touch_updated_at
  BEFORE UPDATE ON public.org_member_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.validate_org_member_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Must be signed in.' USING ERRCODE='28000';
    END IF;
    IF NEW.user_id <> auth.uid() THEN
      RAISE EXCEPTION 'user_id must match caller.' USING ERRCODE='42501';
    END IF;
    NEW.status := 'pending';
    NEW.denial_reason := NULL;
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    IF NEW.message IS NOT NULL AND length(NEW.message) > 500 THEN
      RAISE EXCEPTION 'Message too long (max 500 characters).';
    END IF;
    IF EXISTS (SELECT 1 FROM public.org_members WHERE org_id = NEW.org_id AND user_id = NEW.user_id) THEN
      RAISE EXCEPTION 'Already a member of this organization.';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.org_id <> OLD.org_id OR NEW.user_id <> OLD.user_id THEN
      RAISE EXCEPTION 'Identity fields are immutable.' USING ERRCODE='42501';
    END IF;
    IF NEW.status NOT IN ('pending','approved','denied','withdrawn') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
    IF NEW.denial_reason IS NOT NULL AND length(NEW.denial_reason) > 500 THEN
      RAISE EXCEPTION 'Denial reason too long (max 500 characters).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER org_member_requests_validate
  BEFORE INSERT OR UPDATE ON public.org_member_requests
  FOR EACH ROW EXECUTE FUNCTION public.validate_org_member_request();

-- Approve / deny RPCs
CREATE OR REPLACE FUNCTION public.approve_org_member_request(_req uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _r public.org_member_requests%ROWTYPE;
  _org_name text;
  _member_id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  SELECT * INTO _r FROM public.org_member_requests WHERE id = _req;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.is_trainer_org_admin(_r.org_id, _me) THEN
    RAISE EXCEPTION 'Only owner/admin can approve' USING ERRCODE='42501';
  END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;

  INSERT INTO public.org_members (org_id, user_id, role)
  VALUES (_r.org_id, _r.user_id, 'member')
  ON CONFLICT (org_id, user_id) DO NOTHING
  RETURNING id INTO _member_id;

  UPDATE public.org_member_requests
    SET status = 'approved', reviewed_at = now(), reviewed_by = _me
    WHERE id = _req;

  SELECT name INTO _org_name FROM public.trainer_orgs WHERE id = _r.org_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _r.user_id,
    'org_membership',
    'You joined ' || COALESCE(_org_name, 'the organization'),
    'Your request to join was approved.',
    '/orgs/' || _r.org_id::text
  );

  RETURN _member_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.deny_org_member_request(_req uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _me uuid := auth.uid();
  _r public.org_member_requests%ROWTYPE;
  _org_name text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE='28000'; END IF;
  SELECT * INTO _r FROM public.org_member_requests WHERE id = _req;
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF NOT public.is_trainer_org_admin(_r.org_id, _me) THEN
    RAISE EXCEPTION 'Only owner/admin can deny' USING ERRCODE='42501';
  END IF;
  IF _r.status <> 'pending' THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;

  UPDATE public.org_member_requests
    SET status = 'denied',
        denial_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
        reviewed_at = now(),
        reviewed_by = _me
    WHERE id = _req;

  SELECT name INTO _org_name FROM public.trainer_orgs WHERE id = _r.org_id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _r.user_id,
    'org_membership',
    'Your request to join ' || COALESCE(_org_name, 'the organization') || ' was declined',
    NULLIF(btrim(COALESCE(_reason, '')), ''),
    '/orgs/' || _r.org_id::text
  );
END;
$$;
