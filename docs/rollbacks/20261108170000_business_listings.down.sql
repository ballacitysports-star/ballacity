-- ROLLBACK for supabase/migrations/20261108170000_business_listings.sql (P2-4 slice 1).
-- NOT a migration. It drops trainer_orgs.org_type: every business becomes an ordinary listing again (its category
-- text stays). The app must be on a version that does not read org_type first, or listings fail to load.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_org_type=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_org_type', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: businesses lose their type and an app that reads org_type breaks. Set app.confirm_drop_org_type=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

REVOKE SELECT (org_type) ON public.trainer_orgs FROM anon;
DROP INDEX IF EXISTS public.trainer_orgs_org_type_idx;
ALTER TABLE public.trainer_orgs DROP CONSTRAINT IF EXISTS trainer_orgs_org_type_check;
ALTER TABLE public.trainer_orgs DROP COLUMN IF EXISTS org_type;

COMMIT;
