-- Keep a facility's internal columns away from anonymous visitors.
--
-- `trainer_orgs` already hides phone and email from anon, but a visitor could
-- still read who owns a facility (`owner_id`), which moderator listed it
-- (`listed_by`) and when it was listed or claimed. The public facility page no
-- longer needs them: whether the viewer owns the listing, or it is unclaimed,
-- comes from `getMyOrgAccess`, which runs as the signed-in viewer.
--
-- Signed-in users keep full read access.

REVOKE SELECT (owner_id, listed_by, listed_at, claimed_at) ON public.trainer_orgs FROM anon;
