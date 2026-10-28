-- Any signed-in user could manage any team through its functions.
--
-- is_team_manager(_team, _user) was `team_role_of(_team, _user) IN (...)`. For
-- someone who is not on the team team_role_of is NULL, and `NULL IN (...)` is NULL,
-- not false. The roster functions guard with `IF NOT is_team_manager(...) THEN
-- RAISE`, and `NOT NULL` is NULL, so for a non-member the guard did not fire. The
-- functions are SECURITY DEFINER, so row-level security did not stop them either.
-- Called directly (not through the app), a stranger could:
--
--   team_invite_player     invite anyone to any team (and notify them)
--   team_remove_member     remove any member except the owner
--   team_set_member_role   change any member's role, including promoting to manager
--   team_cancel_invite     cancel any pending invite
--   publish_team_waiver    publish any draft waiver
--
-- (20260912170000 recorded the same NULL for an unrelated uuid when measured on
-- production, as a way to tell it apart from true.)
--
-- Fix: is_team_manager now answers false for a non-member, which closes every
-- caller that negates it. team_set_member_role has its own inline check of the
-- same shape and gets the same guard. Row-level policies that use
-- is_team_manager positively are unchanged in effect (NULL and false both deny).
-- Grants are untouched (CREATE OR REPLACE keeps them).
-- Regression test: supabase/tests/270_team_message_host_actions.test.sql.

CREATE OR REPLACE FUNCTION public.is_team_manager(_team text, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(public.team_role_of(_team, _user) IN ('owner','manager','coach'), false)
$function$;

CREATE OR REPLACE FUNCTION public.team_set_member_role(_team text, _user uuid, _role team_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  IF _role = 'owner' THEN RAISE EXCEPTION 'OWNER_ROLE_FIXED'; END IF;
  IF public.team_owner_of(_team) = _user THEN RAISE EXCEPTION 'OWNER_ROLE_FIXED'; END IF;
  IF COALESCE(public.team_role_of(_team, _me) NOT IN ('owner','manager'), true) THEN
    RAISE EXCEPTION 'NOT_TEAM_MANAGER';
  END IF;
  UPDATE public.team_members SET role = _role, updated_at = now()
  WHERE team_id = _team AND user_id = _user;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_A_MEMBER'; END IF;
END $function$;
