-- P0-13 (Phase 0 audit, 2026-11-06): an account cannot register itself as under 13 through the API either.
--
-- The published Terms set 13 as the minimum age, and both places a member enters a date of birth refuse an
-- under-13 date (src/lib/age-verification.ts checkDobParts, used by sign-up and the age gate). The database did
-- not: set_my_birthday stored any plausible date, so a signed-in account calling the RPC directly could become an
-- under-13 self-registered member and then request parental consent through a flow that is not approved for
-- under-13s (see the legal-review issue on the consent method).
--
-- What changes: set_my_birthday refuses a FIRST date of birth whose cohort is child_under_13 (the cohort comes
-- from age_cohort_from_birthday, so the threshold follows app_settings.age_policy like every other age rule).
-- Everything else is as before:
--   * an account that already has a birthday re-saving the same date is untouched, so existing members of any age
--     (including anyone registered before this change) keep working;
--   * guardian-created managed children are unaffected: provision_managed_child writes profile_birthdays itself
--     and never calls set_my_birthday;
--   * moderator birthday corrections are unaffected (review_birthday_correction writes directly).
-- No row is changed.
--
-- ROLLBACK: docs/rollbacks/20261106160000_refuse_under13_self_registration.down.sql (guarded).
-- TEST: supabase/tests/510_under13_self_registration.test.sql.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.set_my_birthday(_dob date)
 RETURNS TABLE(cohort text, member_age integer, status text, review_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _age int; _existing date;
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

  SELECT birthday INTO _existing FROM public.profile_birthdays WHERE user_id = _uid;
  IF _existing IS NOT NULL AND _existing <> _dob THEN
    RAISE EXCEPTION 'BIRTHDAY_LOCKED: your date of birth cannot be changed after registration. Request a birthday correction instead.';
  END IF;

  -- The minimum age applies to self-registration only: a first date of birth. Children under 13 join as
  -- guardian-created managed accounts, which do not come through here.
  IF _existing IS NULL AND public.age_cohort_from_birthday(_dob) = 'child_under_13' THEN
    RAISE EXCEPTION 'MIN_AGE: you need to be at least 13 to use BallaCity.';
  END IF;

  INSERT INTO public.profile_birthdays (user_id, birthday)
  VALUES (_uid, _dob)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();

  RETURN QUERY
    SELECT p.age_cohort, _age, public.platform_status(p.id), p.age_review_required
    FROM public.profiles p WHERE p.id = _uid;
END $function$;

REVOKE ALL ON FUNCTION public.set_my_birthday(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_birthday(date) TO authenticated, service_role;
