-- ============================================================
-- 1. Configurable age / jurisdiction policy
-- ============================================================
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES (
  'age_policy',
  jsonb_build_object(
    'child_max_age', 12,
    'teen_mid_max_age', 15,
    'adult_age', 18,
    'parental_consent_max_age', 12,
    'jurisdiction_default', 'US_FEDERAL',
    'child_adult_dm_requires_guardian_link', true,
    'teen_adult_dm_requires_shared_context', true,
    'child_public_media', false,
    'child_social_discovery', false,
    'child_ai_analysis_requires_parent', true,
    'child_precise_location_ever_public', false,
    'age_assurance_required', false,
    'biometric_age_estimation_enabled', false,
    'consent_reverification_days', 0,
    'jurisdictions', jsonb_build_object(
      'US_FEDERAL', jsonb_build_object('parental_consent_max_age', 12, 'minor_social_discovery', false),
      'GEORGIA',    jsonb_build_object('parental_consent_max_age', 12, 'minor_social_discovery', false),
      'OTHER_STATE',jsonb_build_object('parental_consent_max_age', 12, 'minor_social_discovery', false),
      'DEFAULT',    jsonb_build_object('parental_consent_max_age', 12, 'minor_social_discovery', false)
    )
  ),
  'Configurable age thresholds, parental-consent ages and jurisdiction rules. LEGAL REVIEW REQUIRED before changing.',
  true
)
ON CONFLICT (key) DO NOTHING;

-- Youth capabilities are now part of the shipped child-safety architecture.
UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'enabled', true,
    'parent_guardian_accounts', true,
    'parental_consent', true,
    'parent_controlled_profile', true,
    'minor_messaging_restrictions', true,
    'minor_location_restrictions', true,
    'minor_media_restrictions', true,
    'minor_reporting', true,
    'parent_notifications', true
  )
WHERE key = 'youth_features';

CREATE OR REPLACE FUNCTION public.age_policy_number(_key text, _fallback int)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (value ->> _key)::int FROM public.app_settings WHERE key = 'age_policy'),
    _fallback
  );
$$;

CREATE OR REPLACE FUNCTION public.age_policy_flag(_key text, _fallback boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT (value ->> _key)::boolean FROM public.app_settings WHERE key = 'age_policy'),
    _fallback
  );
$$;

REVOKE ALL ON FUNCTION public.age_policy_number(text, int) FROM anon;
REVOKE ALL ON FUNCTION public.age_policy_flag(text, boolean) FROM anon;

-- ============================================================
-- 2. Age cohorts
-- ============================================================
CREATE OR REPLACE FUNCTION public.age_cohort_from_birthday(_bd date)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a int; child_max int; mid_max int; adult_at int;
BEGIN
  IF _bd IS NULL THEN RETURN 'unknown'; END IF;
  a := date_part('year', age(_bd))::int;
  child_max := public.age_policy_number('child_max_age', 12);
  mid_max   := public.age_policy_number('teen_mid_max_age', 15);
  adult_at  := public.age_policy_number('adult_age', 18);
  IF a <= child_max THEN RETURN 'child_under_13'; END IF;
  IF a <= mid_max THEN RETURN 'teen_13_15'; END IF;
  IF a < adult_at THEN RETURN 'teen_16_17'; END IF;
  RETURN 'adult';
END $$;

CREATE OR REPLACE FUNCTION public.age_cohort_rank(_cohort text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _cohort
    WHEN 'adult' THEN 3
    WHEN 'teen_16_17' THEN 2
    WHEN 'teen_13_15' THEN 1
    ELSE 0
  END;
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_cohort text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS age_review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS jurisdiction text NOT NULL DEFAULT 'US_FEDERAL';

UPDATE public.profiles p
SET age_cohort = COALESCE(
  (SELECT public.age_cohort_from_birthday(b.birthday) FROM public.profile_birthdays b WHERE b.user_id = p.id),
  CASE p.age_category WHEN 'adult' THEN 'adult' WHEN 'teen' THEN 'teen_16_17' WHEN 'child' THEN 'child_under_13' ELSE 'unknown' END
)
WHERE age_cohort = 'unknown';

CREATE OR REPLACE FUNCTION public.age_cohort_of(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT age_cohort FROM public.profiles WHERE id = _user), 'unknown');
$$;

CREATE OR REPLACE FUNCTION public.my_age_cohort()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT age_cohort FROM public.profiles WHERE id = auth.uid()), 'unknown');
$$;

REVOKE ALL ON FUNCTION public.age_cohort_of(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.my_age_cohort() FROM anon;
REVOKE ALL ON FUNCTION public.age_cohort_from_birthday(date) FROM anon;

-- ============================================================
-- 3. Parental consent
-- ============================================================
CREATE TABLE IF NOT EXISTS public.parental_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  parent_email text,
  parent_name text,
  parent_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  relationship text NOT NULL DEFAULT 'guardian',
  status text NOT NULL DEFAULT 'required'
    CHECK (status IN ('required','pending','approved','revoked','expired')),
  method text NOT NULL DEFAULT 'unverified'
    CHECK (method IN ('unverified','email_confirmation','third_party_verified','manual_review')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  jurisdiction text NOT NULL DEFAULT 'US_FEDERAL',
  privacy_version text,
  terms_version text,
  child_policy_version text,
  verification_token_hash text,
  token_expires_at timestamptz,
  requested_at timestamptz,
  approved_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  reverify_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.parental_consents TO authenticated;
GRANT ALL ON public.parental_consents TO service_role;
ALTER TABLE public.parental_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Child reads own consent record"
ON public.parental_consents FOR SELECT TO authenticated
USING (child_user_id = auth.uid());

CREATE POLICY "Linked parent reads child consent record"
ON public.parental_consents FOR SELECT TO authenticated
USING (parent_user_id = auth.uid());

CREATE POLICY "Moderators review consent records"
ON public.parental_consents FOR SELECT TO authenticated
USING (public.is_moderator(auth.uid()));

CREATE TRIGGER parental_consents_touch
BEFORE UPDATE ON public.parental_consents
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.parental_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id uuid NOT NULL REFERENCES public.parental_consents(id) ON DELETE CASCADE,
  child_user_id uuid NOT NULL,
  actor_id uuid,
  action text NOT NULL,
  from_status text,
  to_status text,
  method text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.parental_consent_events TO authenticated;
GRANT ALL ON public.parental_consent_events TO service_role;
ALTER TABLE public.parental_consent_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Child reads own consent history"
ON public.parental_consent_events FOR SELECT TO authenticated
USING (child_user_id = auth.uid());

CREATE POLICY "Moderators read consent history"
ON public.parental_consent_events FOR SELECT TO authenticated
USING (public.is_moderator(auth.uid()));

-- ============================================================
-- 4. Guardian links, parent controls, parent requests
-- ============================================================
CREATE TABLE IF NOT EXISTS public.guardian_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  relationship text NOT NULL DEFAULT 'guardian',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parent_user_id, child_user_id)
);

GRANT SELECT ON public.guardian_links TO authenticated;
GRANT ALL ON public.guardian_links TO service_role;
ALTER TABLE public.guardian_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Guardian link visible to both parties"
ON public.guardian_links FOR SELECT TO authenticated
USING (parent_user_id = auth.uid() OR child_user_id = auth.uid());

CREATE POLICY "Moderators read guardian links"
ON public.guardian_links FOR SELECT TO authenticated
USING (public.is_moderator(auth.uid()));

CREATE OR REPLACE FUNCTION public.is_guardian_of(_parent uuid, _child uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.guardian_links
    WHERE parent_user_id = _parent AND child_user_id = _child
      AND status = 'active' AND verified_at IS NOT NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_guardian_of(uuid, uuid) FROM anon;

CREATE TABLE IF NOT EXISTS public.child_controls (
  child_user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  messaging text NOT NULL DEFAULT 'guardian_only'
    CHECK (messaging IN ('off','guardian_only','teammates','peers')),
  media_visibility text NOT NULL DEFAULT 'private'
    CHECK (media_visibility IN ('private','guardian','teammates')),
  social_discovery boolean NOT NULL DEFAULT false,
  ai_analysis boolean NOT NULL DEFAULT false,
  location_precision text NOT NULL DEFAULT 'city'
    CHECK (location_precision IN ('city','region')),
  game_participation boolean NOT NULL DEFAULT true,
  notifications boolean NOT NULL DEFAULT true,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.child_controls TO authenticated;
GRANT ALL ON public.child_controls TO service_role;
ALTER TABLE public.child_controls ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Child reads own controls"
ON public.child_controls FOR SELECT TO authenticated
USING (child_user_id = auth.uid());

CREATE POLICY "Guardian reads child controls"
ON public.child_controls FOR SELECT TO authenticated
USING (public.is_guardian_of(auth.uid(), child_user_id));

CREATE TRIGGER child_controls_touch
BEFORE UPDATE ON public.child_controls
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.parent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  child_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('access','correction','deletion','revoke_consent')),
  details text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','completed','denied')),
  handled_by uuid,
  handled_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.parent_requests TO authenticated;
GRANT ALL ON public.parent_requests TO service_role;
ALTER TABLE public.parent_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parent reads own requests"
ON public.parent_requests FOR SELECT TO authenticated
USING (parent_user_id = auth.uid());

CREATE POLICY "Child reads requests about them"
ON public.parent_requests FOR SELECT TO authenticated
USING (child_user_id = auth.uid());

CREATE POLICY "Moderators read parent requests"
ON public.parent_requests FOR SELECT TO authenticated
USING (public.is_moderator(auth.uid()));

CREATE TRIGGER parent_requests_touch
BEFORE UPDATE ON public.parent_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.age_change_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_cohort text,
  to_cohort text,
  outcome text NOT NULL,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.age_change_events TO authenticated;
GRANT ALL ON public.age_change_events TO service_role;
ALTER TABLE public.age_change_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Member reads own age change history"
ON public.age_change_events FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Moderators read age change history"
ON public.age_change_events FOR SELECT TO authenticated
USING (public.is_moderator(auth.uid()));

-- ============================================================
-- 5. Consent state helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.parental_consent_state(_child uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT status FROM public.parental_consents WHERE child_user_id = _child), 'required');
$$;

CREATE OR REPLACE FUNCTION public.child_features_locked(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.age_cohort_of(_user) = 'child_under_13'
     AND public.parental_consent_state(_user) <> 'approved';
$$;

REVOKE ALL ON FUNCTION public.parental_consent_state(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.child_features_locked(uuid) FROM anon;

-- ============================================================
-- 6. Server-controlled consent mutations
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_parental_consent(
  _parent_email text,
  _parent_name text,
  _relationship text,
  _token_hash text,
  _token_expires_at timestamptz,
  _jurisdiction text,
  _versions jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); cid uuid; prev text;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF _parent_email IS NULL OR position('@' in _parent_email) = 0 THEN
    RAISE EXCEPTION 'INVALID_PARENT_EMAIL';
  END IF;

  SELECT id, status INTO cid, prev FROM public.parental_consents WHERE child_user_id = me;

  IF cid IS NULL THEN
    INSERT INTO public.parental_consents (
      child_user_id, parent_email, parent_name, relationship, status, method,
      jurisdiction, privacy_version, terms_version, child_policy_version,
      verification_token_hash, token_expires_at, requested_at
    ) VALUES (
      me, lower(_parent_email), _parent_name, COALESCE(_relationship, 'guardian'), 'pending', 'unverified',
      COALESCE(_jurisdiction, 'US_FEDERAL'),
      _versions ->> 'privacy', _versions ->> 'terms', _versions ->> 'child_policy',
      _token_hash, _token_expires_at, now()
    ) RETURNING id INTO cid;
    prev := 'required';
  ELSE
    IF prev = 'approved' THEN RAISE EXCEPTION 'CONSENT_ALREADY_APPROVED'; END IF;
    UPDATE public.parental_consents SET
      parent_email = lower(_parent_email),
      parent_name = _parent_name,
      relationship = COALESCE(_relationship, relationship),
      status = 'pending',
      jurisdiction = COALESCE(_jurisdiction, jurisdiction),
      privacy_version = _versions ->> 'privacy',
      terms_version = _versions ->> 'terms',
      child_policy_version = _versions ->> 'child_policy',
      verification_token_hash = _token_hash,
      token_expires_at = _token_expires_at,
      requested_at = now()
    WHERE id = cid;
  END IF;

  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
  VALUES (cid, me, me, 'consent_requested', prev, 'pending', jsonb_build_object('parent_email_domain', split_part(lower(_parent_email), '@', 2)));

  RETURN cid;
END $$;

CREATE OR REPLACE FUNCTION public.approve_parental_consent(
  _token_hash text,
  _method text,
  _parent_user uuid,
  _versions jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

  RETURN r.id;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_parental_consent(_child uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); r public.parental_consents;
BEGIN
  SELECT * INTO r FROM public.parental_consents WHERE child_user_id = _child;
  IF r.id IS NULL THEN RAISE EXCEPTION 'CONSENT_NOT_FOUND'; END IF;
  IF NOT (public.is_guardian_of(me, _child) OR public.is_moderator(me)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.parental_consents SET
    status = 'revoked', revoked_at = now(), revoked_reason = _reason,
    verification_token_hash = NULL, token_expires_at = NULL
  WHERE id = r.id;

  -- Immediately apply restrictions rather than only flipping a flag.
  UPDATE public.child_controls SET
    messaging = 'off', media_visibility = 'private', social_discovery = false,
    ai_analysis = false, game_participation = false, updated_by = me
  WHERE child_user_id = _child;

  UPDATE public.privacy_preferences SET
    profile_visibility = 'private', allow_messages = 'none', allow_invites = 'none',
    location_precision = 'city', ai_processing = false, ai_training_opt_in = false
  WHERE user_id = _child;

  UPDATE public.highlight_reels SET hidden_at = COALESCE(hidden_at, now()) WHERE user_id = _child;
  UPDATE public.player_availabilities SET hidden_at = COALESCE(hidden_at, now()), status = 'inactive'
  WHERE user_id = _child;

  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
  VALUES (r.id, _child, me, 'consent_revoked', r.status, 'revoked', jsonb_build_object('reason', _reason));
END $$;

CREATE OR REPLACE FUNCTION public.set_child_controls(_child uuid, _controls jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    updated_by = me
  WHERE child_user_id = _child;

  IF (_controls ->> 'media_visibility') = 'private' THEN
    UPDATE public.highlight_reels SET hidden_at = COALESCE(hidden_at, now()) WHERE user_id = _child;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.create_parent_request(_child uuid, _kind text, _details text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); rid uuid;
BEGIN
  IF NOT public.is_guardian_of(me, _child) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  INSERT INTO public.parent_requests (parent_user_id, child_user_id, kind, details)
  VALUES (me, _child, _kind, _details) RETURNING id INTO rid;
  RETURN rid;
END $$;

REVOKE ALL ON FUNCTION public.request_parental_consent(text, text, text, text, timestamptz, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.approve_parental_consent(text, text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_parental_consent(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.set_child_controls(uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.create_parent_request(uuid, text, text) FROM anon;

-- ============================================================
-- 7. Birthday sync: allow under-13, protect age changes
-- ============================================================
CREATE OR REPLACE FUNCTION public.sync_age_category_from_birthdays()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cat text; cohort text; old_cohort text; effective text;
BEGIN
  cat := public.age_category_from_birthday(NEW.birthday);
  cohort := public.age_cohort_from_birthday(NEW.birthday);
  SELECT age_cohort INTO old_cohort FROM public.profiles WHERE id = NEW.user_id;
  effective := cohort;

  IF TG_OP = 'UPDATE' AND old_cohort IS NOT NULL AND old_cohort <> 'unknown'
     AND public.age_cohort_rank(cohort) > public.age_cohort_rank(old_cohort) THEN
    -- A change that would unlock features stays restricted until reviewed.
    effective := old_cohort;
    UPDATE public.profiles SET age_review_required = true WHERE id = NEW.user_id;
    INSERT INTO public.age_change_events (user_id, from_cohort, to_cohort, outcome, actor_id)
    VALUES (NEW.user_id, old_cohort, cohort, 'review_required', auth.uid());
  ELSIF old_cohort IS DISTINCT FROM cohort THEN
    INSERT INTO public.age_change_events (user_id, from_cohort, to_cohort, outcome, actor_id)
    VALUES (NEW.user_id, old_cohort, cohort, 'applied', auth.uid());
  END IF;

  UPDATE public.profiles SET age_category = cat, age_cohort = effective WHERE id = NEW.user_id;

  IF effective = 'child_under_13' THEN
    INSERT INTO public.parental_consents (child_user_id, status)
    VALUES (NEW.user_id, 'required')
    ON CONFLICT (child_user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_game_min_age_policy()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.clear_age_review(_user uuid, _approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE bd date; cohort text;
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORIZED'; END IF;
  SELECT birthday INTO bd FROM public.profile_birthdays WHERE user_id = _user;
  cohort := public.age_cohort_from_birthday(bd);
  IF _approve THEN
    UPDATE public.profiles SET age_cohort = cohort, age_review_required = false WHERE id = _user;
  ELSE
    UPDATE public.profiles SET age_review_required = false WHERE id = _user;
  END IF;
  INSERT INTO public.age_change_events (user_id, to_cohort, outcome, actor_id)
  VALUES (_user, cohort, CASE WHEN _approve THEN 'review_approved' ELSE 'review_denied' END, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.clear_age_review(uuid, boolean) FROM anon;

-- ============================================================
-- 8. Pre-consent data minimisation (server-side enforcement)
-- ============================================================
CREATE OR REPLACE FUNCTION public.block_locked_child_activity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner uuid;
BEGIN
  owner := CASE TG_TABLE_NAME
    WHEN 'messages' THEN NEW.sender_id
    WHEN 'hosted_games' THEN NEW.host_id
    ELSE NEW.user_id
  END;
  IF owner IS NOT NULL AND public.child_features_locked(owner) THEN
    RAISE EXCEPTION 'CHILD_CONSENT_REQUIRED: a parent or guardian must approve this account first.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS block_locked_child_messages ON public.messages;
CREATE TRIGGER block_locked_child_messages
BEFORE INSERT ON public.messages
FOR EACH ROW EXECUTE FUNCTION public.block_locked_child_activity();

DROP TRIGGER IF EXISTS block_locked_child_reels ON public.highlight_reels;
CREATE TRIGGER block_locked_child_reels
BEFORE INSERT ON public.highlight_reels
FOR EACH ROW EXECUTE FUNCTION public.block_locked_child_activity();

DROP TRIGGER IF EXISTS block_locked_child_availability ON public.player_availabilities;
CREATE TRIGGER block_locked_child_availability
BEFORE INSERT ON public.player_availabilities
FOR EACH ROW EXECUTE FUNCTION public.block_locked_child_activity();

DROP TRIGGER IF EXISTS block_locked_child_hosting ON public.hosted_games;
CREATE TRIGGER block_locked_child_hosting
BEFORE INSERT ON public.hosted_games
FOR EACH ROW EXECUTE FUNCTION public.block_locked_child_activity();

-- Children never host games.
CREATE OR REPLACE FUNCTION public.block_child_hosting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.age_cohort_of(NEW.host_id) = 'child_under_13' THEN
    RAISE EXCEPTION 'CHILD_CANNOT_HOST: an adult must host games that include children.';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS block_child_hosting_trg ON public.hosted_games;
CREATE TRIGGER block_child_hosting_trg
BEFORE INSERT ON public.hosted_games
FOR EACH ROW EXECUTE FUNCTION public.block_child_hosting();

-- ============================================================
-- 9. Age-aware messaging
-- ============================================================
CREATE OR REPLACE FUNCTION public.minor_messaging_allowed(_a uuid, _b uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE ca text; cb text; child uuid; adult_id uuid; ctrl text;
BEGIN
  ca := public.age_cohort_of(_a);
  cb := public.age_cohort_of(_b);

  -- Adult <-> under-13
  IF (ca = 'child_under_13' AND cb = 'adult') OR (cb = 'child_under_13' AND ca = 'adult') THEN
    child := CASE WHEN ca = 'child_under_13' THEN _a ELSE _b END;
    adult_id := CASE WHEN ca = 'child_under_13' THEN _b ELSE _a END;
    IF public.is_guardian_of(adult_id, child) THEN RETURN true; END IF;
    IF public.age_policy_flag('child_adult_dm_requires_guardian_link', true) THEN RETURN false; END IF;
    RETURN public.shares_game_or_chat(_a, _b);
  END IF;

  -- Adult <-> 13-15 requires a shared game or existing conversation
  IF (ca = 'teen_13_15' AND cb = 'adult') OR (cb = 'teen_13_15' AND ca = 'adult') THEN
    IF public.age_policy_flag('teen_adult_dm_requires_shared_context', true) THEN
      RETURN public.shares_game_or_chat(_a, _b);
    END IF;
    RETURN true;
  END IF;

  -- Child controls can switch messaging off entirely
  IF ca = 'child_under_13' THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _a;
    IF ctrl = 'off' THEN RETURN false; END IF;
  END IF;
  IF cb = 'child_under_13' THEN
    SELECT messaging INTO ctrl FROM public.child_controls WHERE child_user_id = _b;
    IF ctrl = 'off' THEN RETURN false; END IF;
  END IF;

  RETURN true;
END $$;

-- ============================================================
-- 10. Minor privacy floor covers the new cohorts
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_minor_privacy_floor()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cohort text;
BEGIN
  cohort := public.age_cohort_of(NEW.user_id);
  IF cohort IN ('child_under_13','teen_13_15','teen_16_17') THEN
    IF NEW.location_precision = 'exact' THEN NEW.location_precision := 'city'; END IF;
    IF NEW.profile_visibility = 'public' THEN NEW.profile_visibility := 'members'; END IF;
  END IF;
  IF cohort = 'child_under_13' THEN
    NEW.profile_visibility := 'private';
    NEW.marketing_emails := false;
    NEW.ai_training_opt_in := false;
  END IF;
  RETURN NEW;
END $$;
