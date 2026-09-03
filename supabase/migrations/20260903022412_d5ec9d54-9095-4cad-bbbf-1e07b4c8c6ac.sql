-- 1. Public reel visibility must respect the age cohort of the reel owner.
-- "protected" (teen_16_17) = visible to authenticated members, never to anon.
CREATE OR REPLACE FUNCTION public.reel_audience(_reel_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN r.id IS NULL THEN 'none'
    WHEN r.hidden_at IS NOT NULL OR r.status <> 'completed' THEN 'none'
    WHEN public.age_cohort_of(r.user_id) IN ('child_under_13', 'teen_13_15') THEN 'none'
    WHEN public.child_features_locked(r.user_id) THEN 'none'
    WHEN public.age_cohort_of(r.user_id) = 'teen_16_17' THEN 'members'
    ELSE 'public'
  END
  FROM (SELECT * FROM public.highlight_reels WHERE id = _reel_id) r;
$function$;

CREATE OR REPLACE FUNCTION public.reel_publicly_visible(_reel_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE public.reel_audience(_reel_id)
    WHEN 'public' THEN true
    WHEN 'members' THEN auth.uid() IS NOT NULL
    ELSE false
  END;
$function$;

REVOKE ALL ON FUNCTION public.reel_audience(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reel_publicly_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reel_audience(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reel_publicly_visible(uuid) TO anon, authenticated, service_role;

-- Fold the cohort check into the single existing permissive SELECT policy
-- (a second permissive policy would be OR'd and re-open the hole).
DROP POLICY IF EXISTS "Anyone can view visible completed reels" ON public.highlight_reels;
CREATE POLICY "Anyone can view visible completed reels"
  ON public.highlight_reels FOR SELECT TO anon, authenticated
  USING (
    hidden_at IS NULL
    AND status = 'completed'
    AND public.reel_publicly_visible(id)
  );

-- 2. Cohort-aware privacy fallback when no privacy_preferences row exists.
CREATE OR REPLACE FUNCTION public.default_profile_visibility_for(_user uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE public.age_cohort_of(_user)
    WHEN 'child_under_13' THEN 'private'
    WHEN 'teen_13_15' THEN 'members'
    WHEN 'teen_16_17' THEN 'members'
    ELSE 'public'
  END;
$function$;

REVOKE ALL ON FUNCTION public.default_profile_visibility_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_profile_visibility_for(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.profile_visibility_of(_user uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT pp.profile_visibility FROM public.privacy_preferences pp WHERE pp.user_id = _user),
    public.default_profile_visibility_for(_user)
  );
$function$;

-- Layer two: every new account gets a privacy_preferences row, and the row is
-- re-clamped through enforce_minor_privacy_floor as soon as the cohort is known.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _type text;
BEGIN
  _type := NEW.raw_user_meta_data->>'account_type';
  IF _type IS NOT NULL AND _type NOT IN ('player','team','trainer','gym') THEN
    _type := NULL;
  END IF;

  INSERT INTO public.profiles (id, display_name, avatar_initials, account_type)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'Player'),
    UPPER(LEFT(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'name', NEW.email, 'P'), 2)),
    _type
  );

  INSERT INTO public.privacy_preferences (user_id, profile_visibility)
  VALUES (NEW.id, public.default_profile_visibility_for(NEW.id))
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reclamp_privacy_on_cohort_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.age_cohort IS DISTINCT FROM OLD.age_cohort THEN
    -- The UPDATE re-runs enforce_minor_privacy_floor, which applies the floor.
    UPDATE public.privacy_preferences
       SET updated_at = now()
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS trg_reclamp_privacy_on_cohort_change ON public.profiles;
CREATE TRIGGER trg_reclamp_privacy_on_cohort_change
  AFTER UPDATE OF age_cohort ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.reclamp_privacy_on_cohort_change();

-- 3. Hosting is blocked for every cohort below 16, matching PERMISSION_MATRIX.
CREATE OR REPLACE FUNCTION public.block_child_hosting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.age_cohort_of(NEW.host_id) NOT IN ('teen_16_17', 'adult') THEN
    RAISE EXCEPTION 'CHILD_CANNOT_HOST: an adult must host games that include children.';
  END IF;
  RETURN NEW;
END $function$;