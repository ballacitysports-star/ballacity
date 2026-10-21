-- Captured from the live database on 2026-10-20: two functions were changed
-- there without a migration in supabase/migrations or drizzle/migrations.
-- Both definitions below are exactly what live runs.

-- Family posts cover children under 16 (child_under_13 and teen_13_15) since
-- 2026-10-15; the app already maps FAMILY_POST_UNDER_16_ONLY. The last
-- migration (20261008150000_family_posts) still allowed under-13 only.
CREATE OR REPLACE FUNCTION public.guard_family_post()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE enabled boolean;
BEGIN
  IF NEW.subject_child_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.subject_child_id IS NOT DISTINCT FROM OLD.subject_child_id THEN RETURN NEW; END IF;
  SELECT COALESCE((value ->> 'enabled')::boolean, false) INTO enabled FROM public.app_settings WHERE key = 'family_posts';
  IF NOT COALESCE(enabled, false) THEN RAISE EXCEPTION 'FAMILY_POSTS_OFF'; END IF;
  IF NOT public.is_guardian_of(NEW.user_id, NEW.subject_child_id) THEN RAISE EXCEPTION 'FAMILY_POST_NOT_GUARDIAN'; END IF;
  IF public.age_cohort_of(NEW.subject_child_id) IS NULL
     OR public.age_cohort_of(NEW.subject_child_id) NOT IN ('child_under_13','teen_13_15') THEN
    RAISE EXCEPTION 'FAMILY_POST_UNDER_16_ONLY';
  END IF;
  IF COALESCE((SELECT c.ai_analysis FROM public.child_controls c WHERE c.child_user_id = NEW.subject_child_id), false) IS NOT TRUE THEN
    RAISE EXCEPTION 'FAMILY_POST_AI_OFF';
  END IF;
  RETURN NEW;
END $function$;

-- Same behaviour as 20260911000000_unclaimed_listings (teams.id is text), as
-- one statement.
CREATE OR REPLACE FUNCTION public.cleanup_listing_claims()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.listing_claims
   WHERE subject_type = CASE WHEN TG_TABLE_NAME = 'teams' THEN 'team' ELSE 'gym' END
     AND subject_id = OLD.id::text;
  RETURN OLD;
END $function$;
