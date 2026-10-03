ALTER TABLE public.child_controls
  ADD COLUMN IF NOT EXISTS public_profile boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_profile_authorized_by uuid,
  ADD COLUMN IF NOT EXISTS public_profile_authorized_at timestamptz;

-- A minor's profile is public only while a verified, active guardian who
-- authorised it still holds the link. Revoking the link re-locks instantly.
CREATE OR REPLACE FUNCTION private_sec.guardian_public_profile(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.child_controls c
    WHERE c.child_user_id = _user
      AND c.public_profile = true
      AND c.public_profile_authorized_by IS NOT NULL
      AND public.is_guardian_of(c.public_profile_authorized_by, _user)
  );
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.guardian_public_profile(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private_sec.profile_visibility_of(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN public.age_cohort_of(_user) IN ('child_under_13','teen_13_15','teen_16_17')
         AND private_sec.guardian_public_profile(_user) THEN 'public'
    ELSE COALESCE(
      (SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = _user),
      public.default_profile_visibility_for(_user)
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.set_child_controls(_child uuid, _controls jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF NOT (public.is_guardian_of(me, _child) OR public.is_moderator(me)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  INSERT INTO public.child_controls (child_user_id, updated_by) VALUES (_child, me)
  ON CONFLICT (child_user_id) DO NOTHING;

  UPDATE public.child_controls SET
    messaging = COALESCE(_controls ->> 'messaging', messaging),
    media_visibility = COALESCE(_controls ->> 'media_visibility', media_visibility),
    social_discovery = COALESCE((_controls ->> 'social_discovery')::boolean, social_discovery),
    ai_analysis = COALESCE((_controls ->> 'ai_analysis')::boolean, ai_analysis),
    location_precision = COALESCE(_controls ->> 'location_precision', location_precision),
    game_participation = COALESCE((_controls ->> 'game_participation')::boolean, game_participation),
    notifications = COALESCE((_controls ->> 'notifications')::boolean, notifications),
    notification_curfew_lifted = COALESCE(
      (_controls ->> 'notification_curfew_lifted')::boolean, notification_curfew_lifted),
    updated_by = me
  WHERE child_user_id = _child;

  -- Only a verified guardian (not a moderator) can authorise a public profile.
  IF _controls ? 'public_profile' THEN
    IF (_controls ->> 'public_profile')::boolean THEN
      IF NOT public.is_guardian_of(me, _child) THEN
        RAISE EXCEPTION 'GUARDIAN_REQUIRED';
      END IF;
      UPDATE public.child_controls SET public_profile = true,
        public_profile_authorized_by = me, public_profile_authorized_at = now()
      WHERE child_user_id = _child;
    ELSE
      UPDATE public.child_controls SET public_profile = false,
        public_profile_authorized_by = NULL, public_profile_authorized_at = NULL
      WHERE child_user_id = _child;
    END IF;
  END IF;

  IF (_controls ->> 'media_visibility') = 'private' THEN
    UPDATE public.highlight_reels SET hidden_at = COALESCE(hidden_at, now()) WHERE user_id = _child;
  END IF;
END $function$;

-- Guardian lookup for a public minor card: returns the authorising guardian
-- only while the profile is guardian-public. Signed-in callers only.
CREATE OR REPLACE FUNCTION public.public_minor_guardian(_child uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.public_profile_authorized_by FROM public.child_controls c
  WHERE c.child_user_id = _child AND private_sec.guardian_public_profile(_child);
$$;
REVOKE ALL ON FUNCTION public.public_minor_guardian(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.public_minor_guardian(uuid) TO authenticated, service_role;