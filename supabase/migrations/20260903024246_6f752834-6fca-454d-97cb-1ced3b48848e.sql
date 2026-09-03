CREATE OR REPLACE FUNCTION public.approve_parental_consent(_token_hash text, _method text, _parent_user uuid, _versions jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE r public.parental_consents; days int;
BEGIN
  SELECT * INTO r FROM public.parental_consents
  WHERE verification_token_hash = _token_hash AND _token_hash IS NOT NULL;
  IF r.id IS NULL THEN RAISE EXCEPTION 'CONSENT_TOKEN_INVALID'; END IF;
  IF r.token_expires_at IS NOT NULL AND r.token_expires_at < now() THEN
    UPDATE public.parental_consents SET status = 'expired', verification_token_hash = NULL WHERE id = r.id;
    RAISE EXCEPTION 'CONSENT_TOKEN_EXPIRED';
  END IF;
  IF _method NOT IN ('email_confirmation','third_party_verified','manual_review') THEN
    RAISE EXCEPTION 'CONSENT_METHOD_NOT_ALLOWED';
  END IF;

  days := public.age_policy_number('consent_reverification_days', 0);

  UPDATE public.parental_consents SET
    status = 'approved',
    method = _method,
    parent_user_id = COALESCE(_parent_user, parent_user_id),
    approved_at = now(),
    revoked_at = NULL,
    revoked_reason = NULL,
    verification_token_hash = NULL,
    token_expires_at = NULL,
    reverify_at = CASE WHEN days > 0 THEN now() + make_interval(days => days) ELSE NULL END,
    privacy_version = COALESCE(_versions ->> 'privacy', privacy_version),
    terms_version = COALESCE(_versions ->> 'terms', terms_version),
    child_policy_version = COALESCE(_versions ->> 'child_policy', child_policy_version),
    scope = COALESCE(_versions -> 'scope', scope)
  WHERE id = r.id;

  INSERT INTO public.child_controls (child_user_id, updated_by)
  VALUES (r.child_user_id, _parent_user)
  ON CONFLICT (child_user_id) DO NOTHING;

  IF _parent_user IS NOT NULL THEN
    INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
    VALUES (_parent_user, r.child_user_id, r.relationship, 'active', now())
    ON CONFLICT (parent_user_id, child_user_id)
      DO UPDATE SET status = 'active', verified_at = now();
  END IF;

  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, method)
  VALUES (r.id, r.child_user_id, _parent_user, 'consent_approved', r.status, 'approved', _method);

  -- Tell the child their account is active, and confirm to the guardian.
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (r.child_user_id, 'guardian_link', 'Your account is approved',
          'A parent or guardian approved your ballaCity account. Games, messages and videos follow their settings.',
          '/feed');
  IF _parent_user IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_parent_user, 'guardian_link', 'Child account approved',
            'You approved a child account. Manage their safety settings in the Parent Center.',
            '/parent');
  END IF;

  RETURN r.id;
END
$$;