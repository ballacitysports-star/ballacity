-- Captured from the live database on 2026-10-20: this guard existed only there.
-- 20260915225632 revokes EXECUTE on it but no migration ever created it, so a
-- rebuild from migrations failed at that file and, worse, lacked the trigger.
--
-- Profiles are self-updatable through RLS; this trigger keeps a non-admin user
-- from changing their own moderation fields (suspension, moderation state, the
-- private avatar copy). Service-role writes (auth.uid() IS NULL) pass through.

CREATE OR REPLACE FUNCTION public.guard_profile_moderation_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'superadmin') THEN
    NEW.avatar_url_private := OLD.avatar_url_private;
    NEW.suspended_at := OLD.suspended_at;
    NEW.suspended_reason := OLD.suspended_reason;
    NEW.moderation_state := OLD.moderation_state;
  END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS guard_profile_moderation_fields ON public.profiles;
CREATE TRIGGER guard_profile_moderation_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_moderation_fields();
