-- `REVOKE EXECUTE ... FROM anon` does not revoke anything.
--
-- 20260910000000, 20260910001000 and 20260911000000 each tried to keep anon out
-- of their functions with `REVOKE EXECUTE ON FUNCTION f FROM anon`. Every one of
-- those statements succeeded and none of them had any effect: Postgres grants
-- EXECUTE on a new function to PUBLIC by default, `anon` is a member of PUBLIC,
-- and revoking a privilege a role never held directly leaves the inherited one
-- untouched. The privilege has to be taken from PUBLIC.
--
-- Measured against production before writing this: all eleven functions those
-- three migrations created answered `has_function_privilege('anon', ..., 'EXECUTE')
-- = true`, while every pre-existing SECURITY DEFINER routine in the schema —
-- publish_legal_document, set_child_controls, approve_parental_consent,
-- admin_revoke_user_sessions, redeem_minor_invite among them — answered false.
-- These were the only exceptions in the database, which is also why the house
-- pattern in this directory is `FROM PUBLIC, anon` (38 occurrences) rather than
-- the `FROM anon` form those three migrations reached for.
--
-- This was not an open door. Each callable RPC opens with
-- `IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'`, and auth.uid() is NULL
-- for anon, so an anonymous call was refused on the function's first line rather
-- than at the privilege check. The grant still should not exist: it puts an
-- unauthenticated caller inside a SECURITY DEFINER body, one edit away from
-- mattering, and it makes these eleven the only routines in the schema that
-- disagree with the rule the rest of it follows.
--
-- The four trigger routines have EXECUTE taken from authenticated as well, which
-- is what their original REVOKE statements were reaching for. Verified on
-- production in a rolled-back transaction that this does not stop them running:
-- with nobody holding EXECUTE on guard_listing_owner_change, a direct owner_id
-- UPDATE was still refused with OWNER_SET_BY_CLAIM_ONLY. Trigger execution does
-- not consult EXECUTE on the trigger function.

-- Callable RPCs: PUBLIC and anon out, authenticated back in explicitly.
REVOKE EXECUTE ON FUNCTION public.transfer_team_ownership(text, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_listing_claim(text, text, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.approve_listing_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.deny_listing_claim(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.withdraw_listing_claim(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_unclaimed_team(text, text, text, text, text, text[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_unclaimed_gym(text, text, text, text, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.transfer_team_ownership(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_listing_claim(text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_listing_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deny_listing_claim(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.withdraw_listing_claim(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_unclaimed_team(text, text, text, text, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_unclaimed_gym(text, text, text, text, text, text) TO authenticated;

-- Trigger routines: nobody needs to call these by name.
REVOKE EXECUTE ON FUNCTION public.guard_team_member_role_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_listing_owner_change()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_listing_claim()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_listing_claims()        FROM PUBLIC, anon, authenticated;
