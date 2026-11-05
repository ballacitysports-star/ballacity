-- Lovable rollback, hotfix 20261031120000 (PR #287), part 1 of 4: roster identity lock (team_members).
-- RE-OPENS F02: a team manager can again re-point a roster row at any person, including a minor.
-- Only with the owner's explicit approval, and recorded. Send this whole file to Lovable's agent as one migration,
-- unchanged (docs/release/hotfix-286-287-runbook.md, section 7). It is one statement, so it applies whole or not at all.
DO $rollback$
BEGIN
  DROP TRIGGER IF EXISTS a0_team_members_identity_locked ON public.team_members;
  DROP FUNCTION IF EXISTS public.lock_member_row_identity();
  IF to_regprocedure('public.lock_member_row_identity()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a0_team_members_identity_locked') THEN
    RAISE EXCEPTION 'rollback of 20261031120000 part 1 incomplete';
  END IF;
END
$rollback$;
