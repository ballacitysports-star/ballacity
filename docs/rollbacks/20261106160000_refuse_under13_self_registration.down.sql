-- ROLLBACK for supabase/migrations/20261106160000_refuse_under13_self_registration.sql (P0-13).
-- NOT a migration (outside supabase/migrations). It restores set_my_birthday without the minimum-age check, so a
-- signed-in account calling the RPC directly can again register itself as under 13. It refuses to run unless the
-- session confirms that is intended:
--     PGOPTIONS="-c app.confirm_reopen_under13_self_registration=yes" psql ... -f <this file>
-- No row is changed by the migration or by this script.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_under13_self_registration', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback lets an account register itself as under 13 through the API. Set app.confirm_reopen_under13_self_registration=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;
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

  INSERT INTO public.profile_birthdays (user_id, birthday)
  VALUES (_uid, _dob)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();

  RETURN QUERY
    SELECT p.age_cohort, _age, public.platform_status(p.id), p.age_review_required
    FROM public.profiles p WHERE p.id = _uid;
END $function$;
COMMIT;
