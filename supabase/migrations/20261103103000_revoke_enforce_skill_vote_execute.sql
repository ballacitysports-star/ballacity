-- Capture of production's EXECUTE grants on the trigger function enforce_skill_vote().
--
-- DRIFT. Production allows EXECUTE only for service_role (ACL {postgres=X/postgres,service_role=X/postgres}). The
-- migration that creates the function (20261012150000) never revokes the default PUBLIC EXECUTE, so a database rebuilt
-- from source lets anon and authenticated roles execute a SECURITY DEFINER trigger function. PostgreSQL refuses to run a
-- trigger function outside a trigger, so this is hardening and not an open door, but trigger functions here are
-- service_role-only by rule (supabase/tests/00_schema_invariants).
--
-- WHAT THIS DOES. Revokes EXECUTE from PUBLIC, anon and authenticated and grants it to service_role. No definition
-- change. The trigger skill_votes.enforce_skill_vote_trg keeps firing (EXECUTE is not checked when a trigger fires).
-- ON PRODUCTION THIS CHANGES NOTHING. Idempotent.
REVOKE ALL ON FUNCTION public.enforce_skill_vote() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_skill_vote() TO service_role;
