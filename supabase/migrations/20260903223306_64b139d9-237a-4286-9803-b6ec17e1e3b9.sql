REVOKE EXECUTE ON FUNCTION public.birthday_audit_append_only() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_game_payment_cohort() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_profile_age_fields() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reclamp_privacy_on_cohort_change() FROM anon, authenticated;