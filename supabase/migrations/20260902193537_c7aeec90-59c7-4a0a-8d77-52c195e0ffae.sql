CREATE TABLE public.minor_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  child_name text NOT NULL,
  relationship text NOT NULL DEFAULT 'parent',
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  child_user_id uuid,
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT minor_invites_status_chk CHECK (status IN ('pending','redeemed','revoked'))
);

GRANT SELECT ON public.minor_invites TO authenticated;
GRANT ALL ON public.minor_invites TO service_role;
ALTER TABLE public.minor_invites ENABLE ROW LEVEL SECURITY;

-- Only the inviting parent (or support staff) can see an invitation. The token
-- hash is never usable for lookup from the client: redemption goes through the
-- SECURITY DEFINER routine below.
CREATE POLICY "Parents read own minor invites"
ON public.minor_invites FOR SELECT TO authenticated
USING (parent_user_id = auth.uid() OR public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid()));

CREATE INDEX minor_invites_parent_idx ON public.minor_invites (parent_user_id, created_at DESC);

CREATE TRIGGER minor_invites_touch
BEFORE UPDATE ON public.minor_invites
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Create an invitation (adults only, capped, 14-day single-use token).
CREATE OR REPLACE FUNCTION public.create_minor_invite(
  _child_name text, _relationship text, _token_hash text, _expires_at timestamptz)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _cohort text; _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;
  SELECT age_cohort INTO _cohort FROM public.profiles WHERE id = _uid;
  IF COALESCE(_cohort, 'unknown') <> 'adult' THEN
    RAISE EXCEPTION 'ADULT_REQUIRED: only an adult account can add a minor.';
  END IF;
  IF _child_name IS NULL OR length(btrim(_child_name)) < 1 THEN
    RAISE EXCEPTION 'NAME_REQUIRED: add the child''s first name.';
  END IF;
  IF _token_hash IS NULL OR length(_token_hash) < 32 THEN
    RAISE EXCEPTION 'TOKEN_INVALID: invitation could not be created.';
  END IF;
  IF _expires_at IS NULL OR _expires_at <= now() THEN
    RAISE EXCEPTION 'TOKEN_INVALID: invitation could not be created.';
  END IF;
  IF (SELECT count(*) FROM public.minor_invites
       WHERE parent_user_id = _uid AND status = 'pending' AND expires_at > now()) >= 20 THEN
    RAISE EXCEPTION 'TOO_MANY_INVITES: cancel an open invitation first.';
  END IF;

  INSERT INTO public.minor_invites (parent_user_id, child_name, relationship, token_hash, expires_at)
  VALUES (_uid, btrim(_child_name), COALESCE(NULLIF(btrim(_relationship), ''), 'parent'),
          _token_hash, _expires_at)
  RETURNING id INTO _id;
  RETURN _id;
END $$;

REVOKE ALL ON FUNCTION public.create_minor_invite(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_minor_invite(text, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_minor_invite(_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in first.';
  END IF;
  UPDATE public.minor_invites
     SET status = 'revoked'
   WHERE id = _id AND parent_user_id = _uid AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_FOUND: that invitation is no longer open.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.revoke_minor_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_minor_invite(uuid) TO authenticated;

-- Look up an invitation by token hash without revealing family details.
CREATE OR REPLACE FUNCTION public.lookup_minor_invite(_token_hash text)
RETURNS TABLE(child_name text, relationship text, parent_name text,
              expires_at timestamptz, state text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _inv public.minor_invites;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to accept a family invitation.';
  END IF;
  SELECT * INTO _inv FROM public.minor_invites WHERE token_hash = _token_hash;
  IF _inv.id IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, NULL::text, NULL::timestamptz, 'invalid'::text;
    RETURN;
  END IF;
  RETURN QUERY
    SELECT _inv.child_name, _inv.relationship, p.name, _inv.expires_at,
           CASE WHEN _inv.status = 'revoked' THEN 'revoked'
                WHEN _inv.status = 'redeemed' THEN 'redeemed'
                WHEN _inv.expires_at <= now() THEN 'expired'
                ELSE 'pending' END
      FROM public.profiles p WHERE p.id = _inv.parent_user_id;
END $$;

REVOKE ALL ON FUNCTION public.lookup_minor_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_minor_invite(text) TO authenticated;

-- Redeem: link guardian, record consent for under-13, seed default controls.
CREATE OR REPLACE FUNCTION public.redeem_minor_invite(_token_hash text)
RETURNS TABLE(parent_user_id uuid, consent_recorded boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _inv public.minor_invites; _cohort text;
        _consent boolean := false; _cid uuid; _prev text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in to accept a family invitation.';
  END IF;

  SELECT * INTO _inv FROM public.minor_invites WHERE token_hash = _token_hash FOR UPDATE;
  IF _inv.id IS NULL THEN
    RAISE EXCEPTION 'INVITE_INVALID: that invitation link is not valid.';
  END IF;
  IF _inv.status = 'revoked' THEN
    RAISE EXCEPTION 'INVITE_REVOKED: that invitation was cancelled.';
  END IF;
  IF _inv.status = 'redeemed' THEN
    RAISE EXCEPTION 'INVITE_USED: that invitation was already used.';
  END IF;
  IF _inv.expires_at <= now() THEN
    RAISE EXCEPTION 'INVITE_EXPIRED: that invitation has expired.';
  END IF;
  IF _inv.parent_user_id = _uid THEN
    RAISE EXCEPTION 'INVITE_SELF: you cannot accept your own invitation.';
  END IF;

  SELECT age_cohort INTO _cohort FROM public.profiles WHERE id = _uid;
  IF COALESCE(_cohort, 'unknown') = 'unknown' THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_links
              WHERE parent_user_id = _inv.parent_user_id AND child_user_id = _uid) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: you are already connected to this parent or guardian.';
  END IF;

  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (_inv.parent_user_id, _uid, _inv.relationship, 'verified', now())
  ON CONFLICT (parent_user_id, child_user_id) DO NOTHING;

  IF _cohort = 'child_under_13' THEN
    SELECT id, status INTO _cid, _prev FROM public.parental_consents WHERE child_user_id = _uid;
    IF _cid IS NULL THEN
      INSERT INTO public.parental_consents (
        child_user_id, parent_email, parent_name, parent_user_id, relationship,
        status, method, jurisdiction, approved_at, requested_at)
      VALUES (_uid, COALESCE((SELECT email FROM auth.users WHERE id = _inv.parent_user_id), ''),
              (SELECT name FROM public.profiles WHERE id = _inv.parent_user_id),
              _inv.parent_user_id, _inv.relationship, 'approved', 'parent_account', 'US_FEDERAL',
              now(), now())
      RETURNING id INTO _cid;
      _prev := 'required';
    ELSIF _prev <> 'approved' THEN
      UPDATE public.parental_consents
         SET status = 'approved', method = 'parent_account',
             parent_user_id = _inv.parent_user_id, relationship = _inv.relationship,
             approved_at = now(), revoked_at = NULL, revoked_reason = NULL,
             verification_token_hash = NULL, token_expires_at = NULL
       WHERE id = _cid;
    END IF;

    INSERT INTO public.parental_consent_events
      (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
    VALUES (_cid, _uid, _uid, 'consent_approved', COALESCE(_prev, 'required'), 'approved',
            jsonb_build_object('method', 'parent_account', 'invite_id', _inv.id));

    INSERT INTO public.child_controls (child_user_id, updated_by)
    VALUES (_uid, _inv.parent_user_id)
    ON CONFLICT (child_user_id) DO NOTHING;

    _consent := true;
  END IF;

  UPDATE public.minor_invites
     SET status = 'redeemed', child_user_id = _uid, redeemed_at = now()
   WHERE id = _inv.id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_inv.parent_user_id, 'guardian_link', 'Family invitation accepted',
          COALESCE(_inv.child_name, 'Your minor') || ' is now linked to your account.', '/parent'),
         (_uid, 'guardian_link', 'Parent or guardian connected',
          'Your parent or guardian can now manage your safety settings.', '/settings');

  RETURN QUERY SELECT _inv.parent_user_id, _consent;
END $$;

REVOKE ALL ON FUNCTION public.redeem_minor_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_minor_invite(text) TO authenticated;