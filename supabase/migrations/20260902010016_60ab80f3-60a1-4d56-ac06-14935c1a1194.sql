-- Anonymous visitors: no access to any child-safety helper.
REVOKE EXECUTE ON FUNCTION public.age_policy_number(text, int) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.age_policy_flag(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.age_cohort_from_birthday(date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.age_cohort_of(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.parental_consent_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.child_features_locked(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_locked_child_activity() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_child_hosting() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_parental_consent(text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Signed-in members keep only the calls their own flows need.
REVOKE EXECUTE ON FUNCTION public.my_age_cohort() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_guardian_of(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_parental_consent(text, text, text, text, timestamptz, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revoke_parental_consent(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_child_controls(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.create_parent_request(uuid, text, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.clear_age_review(uuid, boolean) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.my_age_cohort() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_guardian_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_parental_consent(text, text, text, text, timestamptz, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_parental_consent(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_child_controls(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_parent_request(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_age_review(uuid, boolean) TO authenticated;
