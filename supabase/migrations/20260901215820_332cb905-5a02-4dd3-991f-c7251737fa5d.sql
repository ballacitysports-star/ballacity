-- 1) Youth feature flags (all OFF by default; LEGAL REVIEW REQUIRED before enabling)
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES (
  'youth_features',
  jsonb_build_object(
    'enabled', false,
    'parent_guardian_accounts', false,
    'parental_consent', false,
    'parent_controlled_profile', false,
    'minor_messaging_restrictions', false,
    'minor_location_restrictions', false,
    'minor_media_restrictions', false,
    'minor_reporting', false,
    'parent_notifications', false
  ),
  'LEGAL REVIEW REQUIRED — youth (under 13) functionality. Keep disabled until legal/privacy review and parental-consent implementation are complete.',
  true
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.youth_flag(_flag text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((value -> _flag)::boolean, false)
  FROM public.app_settings
  WHERE key = 'youth_features'
$$;

REVOKE ALL ON FUNCTION public.youth_flag(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.youth_flag(text) TO authenticated, anon, service_role;

-- 2) Age category derived from birthday (minimum information needed for policy)
CREATE OR REPLACE FUNCTION public.age_category_from_birthday(_bd date)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _bd IS NULL THEN 'unknown'
    WHEN date_part('year', age(_bd))::int >= 18 THEN 'adult'
    WHEN date_part('year', age(_bd))::int >= 13 THEN 'teen'
    ELSE 'child'
  END
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS age_category text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_age_category_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_age_category_check
  CHECK (age_category IN ('adult', 'teen', 'child', 'unknown'));

-- age_category stays private: never granted to anon/authenticated selects.
REVOKE SELECT (age_category) ON public.profiles FROM anon;
REVOKE SELECT (age_category) ON public.profiles FROM authenticated;

CREATE OR REPLACE FUNCTION public.sync_profile_age_category()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat text;
BEGIN
  cat := public.age_category_from_birthday(NEW.birthday);
  -- Minimum age policy: 13+ unless youth functionality is explicitly enabled
  -- by an authorized administrator (LEGAL REVIEW REQUIRED).
  IF cat = 'child' AND NOT public.youth_flag('enabled') THEN
    RAISE EXCEPTION 'AGE_MINIMUM_13: OpenRun requires members to be at least 13 years old.';
  END IF;
  NEW.age_category := cat;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_age_category ON public.profiles;
CREATE TRIGGER trg_sync_profile_age_category
  BEFORE INSERT OR UPDATE OF birthday ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_age_category();

UPDATE public.profiles
SET age_category = public.age_category_from_birthday(birthday)
WHERE age_category IS DISTINCT FROM public.age_category_from_birthday(birthday);

-- Self / moderator readable accessors (no bulk exposure of minor status)
CREATE OR REPLACE FUNCTION public.my_age_category()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT age_category FROM public.profiles WHERE id = auth.uid()), 'unknown')
$$;

REVOKE ALL ON FUNCTION public.my_age_category() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_age_category() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_minor(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT age_category IN ('teen', 'child') FROM public.profiles WHERE id = _user),
    false
  )
$$;

REVOKE ALL ON FUNCTION public.is_minor(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_minor(uuid) TO service_role;

-- 3) Minor privacy floor: no precise location, no public web exposure
CREATE OR REPLACE FUNCTION public.enforce_minor_privacy_floor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cat text;
BEGIN
  SELECT age_category INTO cat FROM public.profiles WHERE id = NEW.user_id;
  IF cat IN ('teen', 'child') THEN
    IF NEW.location_precision = 'exact' THEN
      NEW.location_precision := 'city';
    END IF;
    IF NEW.profile_visibility = 'public' THEN
      NEW.profile_visibility := 'members';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_minor_privacy_floor ON public.privacy_preferences;
CREATE TRIGGER trg_enforce_minor_privacy_floor
  BEFORE INSERT OR UPDATE ON public.privacy_preferences
  FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_privacy_floor();

UPDATE public.privacy_preferences p
SET location_precision = CASE WHEN p.location_precision = 'exact' THEN 'city' ELSE p.location_precision END,
    profile_visibility = CASE WHEN p.profile_visibility = 'public' THEN 'members' ELSE p.profile_visibility END
WHERE EXISTS (
  SELECT 1 FROM public.profiles pr
  WHERE pr.id = p.user_id AND pr.age_category IN ('teen', 'child')
)
AND (p.location_precision = 'exact' OR p.profile_visibility = 'public');

-- 4) Messaging architecture: adult<->minor DMs require the youth messaging control
CREATE OR REPLACE FUNCTION public.minor_messaging_allowed(_a uuid, _b uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ca text;
  cb text;
BEGIN
  -- Youth functionality disabled: existing (13+) behaviour is unchanged.
  IF NOT public.youth_flag('enabled') THEN
    RETURN true;
  END IF;
  -- Youth functionality enabled with the messaging control in place: the
  -- control layer decides, not this guard.
  IF public.youth_flag('minor_messaging_restrictions') THEN
    RETURN true;
  END IF;
  SELECT age_category INTO ca FROM public.profiles WHERE id = _a;
  SELECT age_category INTO cb FROM public.profiles WHERE id = _b;
  -- No unrestricted adult<->minor communication.
  IF (ca IN ('teen', 'child') AND cb = 'adult') OR (cb IN ('teen', 'child') AND ca = 'adult') THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.minor_messaging_allowed(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minor_messaging_allowed(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_minor_messaging()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  other uuid;
BEGIN
  FOR other IN
    SELECT user_id FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
  LOOP
    IF NOT public.minor_messaging_allowed(NEW.sender_id, other) THEN
      RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED: messaging between adults and minors is not available.';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_minor_messaging ON public.messages;
CREATE TRIGGER trg_enforce_minor_messaging
  BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.enforce_minor_messaging();

-- 5) Hosted games cannot target under-13 players while youth features are off
CREATE OR REPLACE FUNCTION public.enforce_game_min_age_policy()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.min_age IS NOT NULL AND NEW.min_age < 13 AND NOT public.youth_flag('enabled') THEN
    RAISE EXCEPTION 'AGE_MINIMUM_13: games must require players to be at least 13 years old.';
  END IF;
  IF NEW.max_age IS NOT NULL AND NEW.max_age < 13 AND NOT public.youth_flag('enabled') THEN
    RAISE EXCEPTION 'AGE_MINIMUM_13: games must require players to be at least 13 years old.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_game_min_age_policy ON public.hosted_games;
CREATE TRIGGER trg_enforce_game_min_age_policy
  BEFORE INSERT OR UPDATE OF min_age, max_age ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.enforce_game_min_age_policy();