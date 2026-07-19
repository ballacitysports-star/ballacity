CREATE OR REPLACE FUNCTION public.list_trainer_booked_slots(_trainer_id text, _date date)
RETURNS TABLE(start_time time, end_time time, status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.preferred_start_time AS start_time,
    (r.preferred_start_time + make_interval(mins => r.duration_minutes))::time AS end_time,
    r.status
  FROM public.trainer_session_requests r
  WHERE r.trainer_id = _trainer_id
    AND r.preferred_date = _date
    AND r.preferred_start_time IS NOT NULL
    AND r.status IN ('pending','accepted');
$$;

REVOKE ALL ON FUNCTION public.list_trainer_booked_slots(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_trainer_booked_slots(text, date) TO authenticated, service_role;