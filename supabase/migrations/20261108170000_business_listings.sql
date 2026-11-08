-- P2-4 slice 1: businesses as listings (docs/phase0-audit-and-implementation-plan.md, section 7.3 E).
--
-- Shops, physios, photographers, leagues and camp providers are listed alongside venues. They live in trainer_orgs
-- (not a new table), so they keep everything a venue already has: category, hours, photos, claims, dual hide,
-- reviews, follows and inquiries.
-- 1. trainer_orgs.org_type: 'facility' (a venue, the default and every existing row) or 'business'.
-- 2. Signed-out visitors may read it (their access to trainer_orgs is column by column); signed-in members already
--    read and, as owners or admins, update the whole row under the existing policies.
-- Claims and reviews keep their current subject kinds ('gym' points at trainer_orgs), so a business is claimed and
-- reviewed exactly as a venue is; nothing in their rules changes.
--
-- Rollback: docs/rollbacks/20261108170000_business_listings.down.sql.

ALTER TABLE public.trainer_orgs
  ADD COLUMN IF NOT EXISTS org_type text NOT NULL DEFAULT 'facility';
ALTER TABLE public.trainer_orgs DROP CONSTRAINT IF EXISTS trainer_orgs_org_type_check;
ALTER TABLE public.trainer_orgs ADD CONSTRAINT trainer_orgs_org_type_check
  CHECK (org_type IN ('facility', 'business'));
CREATE INDEX IF NOT EXISTS trainer_orgs_org_type_idx ON public.trainer_orgs (org_type);

GRANT SELECT (org_type) ON public.trainer_orgs TO anon;
