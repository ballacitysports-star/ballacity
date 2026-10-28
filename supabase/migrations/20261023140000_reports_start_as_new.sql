-- A report is "new" when it is filed, whatever its author sends.
--
-- `user_reports` lets any signed-in user insert a row for themselves, and the
-- API role may write every column, including `status`, `reviewed_by`,
-- `reviewed_at` and `resolution_notes`. So a member could file a report that
-- arrives as "resolved" or "dismissed", naming a moderator as its reviewer
-- with notes in their voice. The moderation queue and the compliance counters
-- both filter on status, so such a report never shows as open, and the
-- record looks as if a moderator had handled it. Found by the SQL test
-- 190_report_integrity.
--
-- This BEFORE INSERT trigger resets those four columns for anyone who is not
-- a moderator or server code (auth.uid() IS NULL). The app already sends
-- status = 'new', so ordinary reports are unchanged. Moderators still update
-- reports through the existing policy; authors have no update policy.
--
-- ROLLBACK: DROP TRIGGER user_reports_start_as_new ON public.user_reports;
-- DROP FUNCTION public.user_reports_start_as_new(). No data changes.

CREATE OR REPLACE FUNCTION public.user_reports_start_as_new()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_moderator(auth.uid()) THEN
    NEW.status := 'new';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.resolution_notes := NULL;
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION public.user_reports_start_as_new() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS user_reports_start_as_new ON public.user_reports;
CREATE TRIGGER user_reports_start_as_new
  BEFORE INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.user_reports_start_as_new();
