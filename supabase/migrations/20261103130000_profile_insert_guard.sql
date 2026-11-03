-- PRIV-1c (F7): a client-created profile row cannot choose its own age or moderation state.
--
-- The guards on public.profiles (guard_profile_age_fields, guard_profile_moderation_fields) fire on
-- UPDATE only. The INSERT policy checks nothing but auth.uid() = id, so an account that has no profile row
-- could insert its own with age_cohort = 'adult' and be treated as a confirmed adult by every age rule.
-- Signup creates the row (handle_new_user, as the server) and authenticated users have no DELETE grant, so
-- no API route to that state was found; this closes the INSERT path anyway, because "unknown age" is the
-- state every age rule fails closed on and this is the only way out of it.
--
-- For a client (auth.uid() is set, not an admin/superadmin, and not the birthday-sync flow):
--   * age_cohort / age_category come from the stored birthday (profile_birthdays), or 'unknown' when there is
--     none. The client cannot pick either, in either direction.
--   * a child under 13 gets the same "consent required" row the birthday sync would have created.
--   * age_review_required, moderation_state, suspended_at, suspended_reason and avatar_url_private take their
--     defaults, as the UPDATE guard already pins them.
-- The server (auth.uid() IS NULL: signup trigger, service role, workers) and admins are unaffected.
-- Additive: one function and one trigger; no row is changed.
CREATE OR REPLACE FUNCTION public.guard_profile_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _b date;
  _cohort text;
BEGIN
  IF current_setting('openrun.age_sync', true) = 'on' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL
     OR public.has_role(auth.uid(), 'admin')
     OR public.has_role(auth.uid(), 'superadmin') THEN
    RETURN NEW;
  END IF;

  SELECT birthday INTO _b FROM public.profile_birthdays WHERE user_id = NEW.id;
  _cohort := COALESCE(public.age_cohort_from_birthday(_b), 'unknown');
  NEW.age_cohort := _cohort;
  NEW.age_category := COALESCE(public.age_category_from_birthday(_b), 'unknown');
  NEW.age_review_required := false;
  NEW.moderation_state := 'active';
  NEW.suspended_at := NULL;
  NEW.suspended_reason := NULL;
  NEW.avatar_url_private := NULL;

  IF _cohort = 'child_under_13' THEN
    INSERT INTO public.parental_consents (child_user_id, status)
    VALUES (NEW.id, 'required')
    ON CONFLICT (child_user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_profile_insert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_insert() TO service_role;

-- Named so it runs before the other BEFORE INSERT trigger on profiles (enforce_minor_handle_safety_trg), which
-- reads age_cohort: it must see the corrected value.
DROP TRIGGER IF EXISTS aa_guard_profile_insert_trg ON public.profiles;
CREATE TRIGGER aa_guard_profile_insert_trg
BEFORE INSERT ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_insert();
