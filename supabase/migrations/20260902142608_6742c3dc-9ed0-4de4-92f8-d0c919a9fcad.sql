-- 1. ONE calendar-based age calculation
CREATE OR REPLACE FUNCTION public.calculate_age(_dob date, _now date DEFAULT current_date)
RETURNS int
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _dob IS NULL OR _now IS NULL OR _dob > _now THEN NULL
    ELSE (date_part('year', age(_now, _dob)))::int
  END
$$;

REVOKE ALL ON FUNCTION public.calculate_age(date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_age(date, date) TO authenticated, service_role;

-- 2. Existing derivations delegate to it (no competing implementations)
CREATE OR REPLACE FUNCTION public.age_category_from_birthday(_bd date)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _bd IS NULL OR public.calculate_age(_bd) IS NULL THEN 'unknown'
    WHEN public.calculate_age(_bd) >= 18 THEN 'adult'
    WHEN public.calculate_age(_bd) >= 13 THEN 'teen'
    ELSE 'child'
  END
$$;

CREATE OR REPLACE FUNCTION public.age_cohort_from_birthday(_bd date)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE a int; child_max int; mid_max int; adult_at int;
BEGIN
  a := public.calculate_age(_bd);
  IF a IS NULL THEN RETURN 'unknown'; END IF;
  child_max := public.age_policy_number('child_max_age', 12);
  mid_max   := public.age_policy_number('teen_mid_max_age', 15);
  adult_at  := public.age_policy_number('adult_age', 18);
  IF a <= child_max THEN RETURN 'child_under_13'; END IF;
  IF a <= mid_max THEN RETURN 'teen_13_15'; END IF;
  IF a < adult_at THEN RETURN 'teen_16_17'; END IF;
  RETURN 'adult';
END $$;

-- 3. Age verification + one authoritative platform status
CREATE OR REPLACE FUNCTION public.age_verified(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT age_cohort <> 'unknown' FROM public.profiles WHERE id = _user), false);
$$;

REVOKE ALL ON FUNCTION public.age_verified(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.age_verified(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.platform_status(_user uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _cohort text; _consent text; _suspended timestamptz;
BEGIN
  SELECT age_cohort, suspended_at INTO _cohort, _suspended
  FROM public.profiles WHERE id = _user;
  IF _cohort IS NULL THEN RETURN 'no_account'; END IF;
  IF _suspended IS NOT NULL THEN RETURN 'suspended'; END IF;
  IF _cohort = 'unknown' THEN RETURN 'age_verification_required'; END IF;
  IF _cohort <> 'child_under_13' THEN RETURN 'active'; END IF;
  _consent := public.parental_consent_state(_user);
  RETURN CASE _consent
    WHEN 'approved' THEN 'active'
    WHEN 'denied' THEN 'consent_denied'
    WHEN 'revoked' THEN 'consent_revoked'
    WHEN 'expired' THEN 'consent_expired'
    WHEN 'pending' THEN 'pending_parental_consent'
    ELSE 'consent_required'
  END;
END $$;

REVOKE ALL ON FUNCTION public.platform_status(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.platform_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.my_platform_status()
RETURNS TABLE(cohort text, age_category text, review_required boolean, status text, birthday_set boolean)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.age_cohort, p.age_category, p.age_review_required,
         public.platform_status(p.id),
         EXISTS (SELECT 1 FROM public.profile_birthdays b WHERE b.user_id = p.id AND b.birthday IS NOT NULL)
  FROM public.profiles p WHERE p.id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.my_platform_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.my_platform_status() TO authenticated;

-- 4. Age fields on profiles are system-owned
CREATE OR REPLACE FUNCTION public.guard_profile_age_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF current_setting('openrun.age_sync', true) = 'on' THEN RETURN NEW; END IF;
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'superadmin') THEN
    NEW.age_category := OLD.age_category;
    NEW.age_cohort := OLD.age_cohort;
    NEW.age_review_required := OLD.age_review_required;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_profile_age_fields ON public.profiles;
CREATE TRIGGER guard_profile_age_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_age_fields();

-- the birthday sync is the one blessed writer of those fields
CREATE OR REPLACE FUNCTION public.sync_age_category_from_birthdays()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE cat text; cohort text; old_cohort text; effective text;
BEGIN
  cat := public.age_category_from_birthday(NEW.birthday);
  cohort := public.age_cohort_from_birthday(NEW.birthday);
  SELECT age_cohort INTO old_cohort FROM public.profiles WHERE id = NEW.user_id;
  effective := cohort;
  PERFORM set_config('openrun.age_sync', 'on', true);

  IF TG_OP = 'UPDATE' AND old_cohort IS NOT NULL AND old_cohort <> 'unknown'
     AND public.age_cohort_rank(cohort) > public.age_cohort_rank(old_cohort) THEN
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

  PERFORM set_config('openrun.age_sync', 'off', true);
  RETURN NEW;
END $$;

-- 5. Date of birth is only writable through a validating routine
DROP POLICY IF EXISTS "Own birthday write" ON public.profile_birthdays;
DROP POLICY IF EXISTS "Own birthday update" ON public.profile_birthdays;
REVOKE INSERT, UPDATE ON public.profile_birthdays FROM authenticated;

CREATE OR REPLACE FUNCTION public.set_my_birthday(_dob date)
RETURNS TABLE(cohort text, member_age int, status text, review_required boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid(); _age int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: sign in before saving a date of birth.';
  END IF;
  IF _dob IS NULL THEN
    RAISE EXCEPTION 'DOB_REQUIRED: enter your date of birth.';
  END IF;
  IF _dob > current_date THEN
    RAISE EXCEPTION 'DOB_IN_FUTURE: enter a date of birth in the past.';
  END IF;
  _age := public.calculate_age(_dob);
  IF _age IS NULL OR _age > 120 THEN
    RAISE EXCEPTION 'DOB_INVALID: enter a valid date of birth.';
  END IF;

  INSERT INTO public.profile_birthdays (user_id, birthday)
  VALUES (_uid, _dob)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();

  RETURN QUERY
    SELECT p.age_cohort, _age, public.platform_status(p.id), p.age_review_required
    FROM public.profiles p WHERE p.id = _uid;
END $$;

REVOKE ALL ON FUNCTION public.set_my_birthday(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_my_birthday(date) TO authenticated;

-- 6. No age on file = no member activity (same shape as the child consent lock)
CREATE OR REPLACE FUNCTION public.block_locked_child_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE owner uuid;
BEGIN
  owner := CASE TG_TABLE_NAME
    WHEN 'messages' THEN NEW.sender_id
    WHEN 'hosted_games' THEN NEW.host_id
    ELSE NEW.user_id
  END;
  IF owner IS NOT NULL AND owner = auth.uid() AND NOT public.age_verified(owner) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before using OpenRun.';
  END IF;
  IF owner IS NOT NULL AND public.child_features_locked(owner) THEN
    RAISE EXCEPTION 'CHILD_CONSENT_REQUIRED: a parent or guardian must approve this account first.';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.enforce_child_game_participation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE subject uuid;
BEGIN
  subject := COALESCE(
    CASE WHEN TG_TABLE_NAME = 'join_requests' THEN NEW.player_id ELSE NEW.user_id END,
    auth.uid());
  IF subject IS NOT NULL AND subject = auth.uid() AND NOT public.age_verified(subject) THEN
    RAISE EXCEPTION 'AGE_VERIFICATION_REQUIRED: add your date of birth before joining games.';
  END IF;
  IF subject IS NOT NULL AND NOT public.child_game_participation_allowed(subject) THEN
    RAISE EXCEPTION 'CHILD_GAME_PARTICIPATION_BLOCKED: a parent or guardian must approve this account and allow game participation.';
  END IF;
  RETURN NEW;
END $$;