-- Capture of production's EXECUTE grants on the trigger function enforce_review_integrity().
--
-- DRIFT. Production allows EXECUTE only for service_role (ACL {postgres=X/postgres,service_role=X/postgres}). The
-- migration that creates the function (20261012120000) never revokes the default PUBLIC EXECUTE, and the later
-- structured-review capture (#245) replaces the body only, which keeps whatever grants exist. A database rebuilt from
-- source therefore lets anon and authenticated execute it.
--
-- WHAT THIS DOES. Revokes EXECUTE from PUBLIC, anon and authenticated and grants it to service_role. Grants only: the
-- body is not touched here, so this migration is independent of the definition drift that #245 captures and can be
-- merged before or after it. The trigger reviews.enforce_review_integrity_trg keeps firing.
-- ON PRODUCTION THIS CHANGES NOTHING. Idempotent.
REVOKE ALL ON FUNCTION public.enforce_review_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_review_integrity() TO service_role;
