-- Featured facilities: a curated, moderator-set highlight shown first (with a
-- "Featured" badge) in the /orgs directory. NULL = not featured; the value is
-- when it was featured, so the most recently featured sorts first.

ALTER TABLE public.trainer_orgs ADD COLUMN IF NOT EXISTS featured_at timestamptz;

-- Anonymous visitors only have column-level SELECT on this table (phone and
-- email are withheld), so the new column has to be granted explicitly.
GRANT SELECT (featured_at) ON public.trainer_orgs TO anon;

CREATE INDEX IF NOT EXISTS trainer_orgs_featured_idx
  ON public.trainer_orgs (featured_at DESC)
  WHERE featured_at IS NOT NULL;

-- Owners can edit their own facility row, so without a guard anyone could
-- feature themselves. Only moderators/admins may set or clear the flag;
-- service-role (no end user) writes pass through.
CREATE OR REPLACE FUNCTION public.guard_org_featured()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.featured_at IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.featured_at IS NOT DISTINCT FROM OLD.featured_at THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'FEATURED_NOT_ALLOWED: only moderators can feature a facility.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS guard_org_featured_trg ON public.trainer_orgs;
CREATE TRIGGER guard_org_featured_trg
BEFORE INSERT OR UPDATE OF featured_at ON public.trainer_orgs
FOR EACH ROW EXECUTE FUNCTION public.guard_org_featured();
