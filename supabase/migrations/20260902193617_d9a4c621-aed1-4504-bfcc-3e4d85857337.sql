REVOKE EXECUTE ON FUNCTION public.set_my_birthday(date) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_birthday_correction(date, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.review_birthday_correction(uuid, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_birthday_corrections(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.my_birthday_corrections() FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_minor_invite(text, text, text, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.revoke_minor_invite(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lookup_minor_invite(text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.redeem_minor_invite(text) FROM anon;