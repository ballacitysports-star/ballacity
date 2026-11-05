-- Lovable rollback, hotfix 20261031120000 (PR #287), part 4 of 4: report guard and audit (user_reports).
-- RE-OPENS F13: a moderator can again rewrite a report and its reviewer attribution with no audit row.
-- Only with the owner's explicit approval, and recorded. Send this whole file to Lovable's agent as one migration,
-- unchanged (docs/release/hotfix-286-287-runbook.md, section 7). It is one statement, so it applies whole or not at all.
DO $rollback$
BEGIN
  DROP TRIGGER IF EXISTS zz_user_reports_moderation_guard ON public.user_reports;
  DROP FUNCTION IF EXISTS public.guard_report_moderation_update();
  DROP FUNCTION IF EXISTS private_sec.audit_report_change(jsonb, jsonb);
  IF to_regprocedure('public.guard_report_moderation_update()') IS NOT NULL
     OR to_regprocedure('private_sec.audit_report_change(jsonb,jsonb)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'zz_user_reports_moderation_guard') THEN
    RAISE EXCEPTION 'rollback of 20261031120000 part 4 incomplete';
  END IF;
END
$rollback$;
