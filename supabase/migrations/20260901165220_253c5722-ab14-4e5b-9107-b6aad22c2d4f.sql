REVOKE ALL ON FUNCTION public.apply_availability_location_privacy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_contact_request_privacy() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reject_payment_credentials() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_direct_conversation(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_direct_conversation(uuid, uuid) TO authenticated, service_role;