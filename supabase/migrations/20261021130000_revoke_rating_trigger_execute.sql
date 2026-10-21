-- Hardening: nobody needs to be able to call the rating trigger functions.
--
-- enforce_review_integrity() and enforce_skill_vote() are SECURITY DEFINER
-- trigger functions, but were created with PostgreSQL's default EXECUTE grant
-- to PUBLIC, so anon and authenticated could see them as callable. Trigger
-- functions can't be invoked directly ("trigger functions can only be called
-- as triggers"), so this isn't exploitable, but it is what Supabase's security
-- lint flags, and every other trigger function in this repo already has EXECUTE
-- revoked (e.g. bump_helpful_count, enforce_gym_review). Triggers keep firing:
-- PostgreSQL checks EXECUTE only when a trigger is created, not when it fires.

REVOKE ALL ON FUNCTION public.enforce_review_integrity() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_skill_vote() FROM PUBLIC, anon, authenticated;
