CREATE OR REPLACE FUNCTION public.list_birthday_corrections(_status text DEFAULT 'pending'::text)
 RETURNS TABLE(id uuid, user_id uuid, display_name text, handle text, current_birthday date, requested_birthday date, reason text, evidence text, status text, reviewed_at timestamp with time zone, review_notes text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_role(auth.uid(), 'admin') OR public.is_superadmin(auth.uid())) THEN
    RAISE EXCEPTION 'FORBIDDEN: admin access required.';
  END IF;
  RETURN QUERY
    SELECT r.id, r.user_id, p.display_name, p.username, r.current_birthday, r.requested_birthday,
           r.reason, r.evidence, r.status, r.reviewed_at, r.review_notes, r.created_at
      FROM public.birthday_correction_requests r
      LEFT JOIN public.profiles p ON p.id = r.user_id
     WHERE _status IS NULL OR r.status = _status
     ORDER BY r.created_at DESC
     LIMIT 200;
END $function$;