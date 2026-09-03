CREATE OR REPLACE FUNCTION public.redeem_minor_invite(_token_hash text)
 RETURNS TABLE(parent_id uuid, consent_recorded boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _inv public.minor_invites; _cohort text;
        _consent boolean := false; _cid uuid; _prev text; _parent uuid;
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
  _parent := _inv.parent_user_id;
  IF _parent = _uid THEN
    RAISE EXCEPTION 'INVITE_SELF: you cannot accept your own invitation.';
  END IF;

  SELECT age_cohort INTO _cohort FROM public.profiles WHERE id = _uid;
  IF COALESCE(_cohort, 'unknown') = 'unknown' THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth first.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.guardian_links g
              WHERE g.parent_user_id = _parent AND g.child_user_id = _uid) THEN
    RAISE EXCEPTION 'ALREADY_LINKED: you are already connected to this parent or guardian.';
  END IF;

  INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
  VALUES (_parent, _uid, _inv.relationship, 'active', now())
  ON CONFLICT (parent_user_id, child_user_id) DO NOTHING;

  -- LEGAL REVIEW REQUIRED: consent-required age band is configurable policy,
  -- not hardcoded to under-13; mirrors platform_status(). The invited adult
  -- holds a confirmed account email, so the method is email_confirmation.
  IF public.parental_consent_required(_cohort) THEN
    SELECT id, status INTO _cid, _prev FROM public.parental_consents WHERE child_user_id = _uid;
    IF _cid IS NULL THEN
      INSERT INTO public.parental_consents (
        child_user_id, parent_email, parent_name, parent_user_id, relationship,
        status, method, jurisdiction, approved_at, requested_at)
      VALUES (_uid, COALESCE((SELECT email FROM auth.users u WHERE u.id = _parent), ''),
              (SELECT display_name FROM public.profiles p WHERE p.id = _parent),
              _parent, _inv.relationship, 'approved', 'email_confirmation', 'US_FEDERAL',
              now(), now())
      RETURNING id INTO _cid;
      _prev := 'required';
    ELSIF _prev <> 'approved' THEN
      UPDATE public.parental_consents
         SET status = 'approved', method = 'email_confirmation',
             parent_user_id = _parent, relationship = _inv.relationship,
             approved_at = now(), revoked_at = NULL, revoked_reason = NULL,
             verification_token_hash = NULL, token_expires_at = NULL
       WHERE id = _cid;
    END IF;

    INSERT INTO public.parental_consent_events
      (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
    VALUES (_cid, _uid, _uid, 'consent_approved', COALESCE(_prev, 'required'), 'approved',
            jsonb_build_object('method', 'email_confirmation', 'invite_id', _inv.id));

    INSERT INTO public.child_controls (child_user_id, updated_by)
    VALUES (_uid, _parent)
    ON CONFLICT (child_user_id) DO NOTHING;

    _consent := true;
  END IF;

  UPDATE public.minor_invites
     SET status = 'redeemed', child_user_id = _uid, redeemed_at = now()
   WHERE id = _inv.id;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_parent, 'guardian_link', 'Family invitation accepted',
          COALESCE(_inv.child_name, 'Your minor') || ' is now linked to your account.', '/parent'),
         (_uid, 'guardian_link', 'Parent or guardian connected',
          'Your parent or guardian can now manage your safety settings.', '/settings');

  RETURN QUERY SELECT _parent, _consent;
END $function$;