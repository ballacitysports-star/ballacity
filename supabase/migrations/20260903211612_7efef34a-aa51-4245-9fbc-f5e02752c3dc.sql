REVOKE ALL ON FUNCTION public.log_child_controls_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_parental_consent_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_guardian_link_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.family_audit_log_append_only() FROM PUBLIC, anon, authenticated;