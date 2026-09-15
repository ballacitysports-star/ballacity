CREATE OR REPLACE FUNCTION public.ai_reserve_quota(_user_id uuid, _feature text, _units integer, _daily_limit integer, _monthly_limit integer, _max_concurrent integer, _input_summary jsonb DEFAULT '{}'::jsonb, _related_reel_id uuid DEFAULT NULL::uuid, _provider text DEFAULT NULL::text, _model text DEFAULT NULL::text, _max_attempts integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  want_units integer := GREATEST(1, COALESCE(_units, 1));
  day_start timestamptz := date_trunc('day', now());
  month_start timestamptz := date_trunc('month', now());
  used_day integer := 0;
  used_month integer := 0;
  running integer := 0;
  new_job uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || _feature, 0));

  SELECT COUNT(*) INTO running
    FROM public.ai_generation_jobs j
   WHERE j.user_id = _user_id AND j.status IN ('queued','running');

  SELECT COALESCE(SUM(e.units), 0) INTO used_day
    FROM public.ai_usage_events e
   WHERE e.user_id = _user_id AND e.feature = _feature
     AND e.outcome = 'ok' AND e.created_at >= day_start;

  SELECT COALESCE(SUM(e.units), 0) INTO used_month
    FROM public.ai_usage_events e
   WHERE e.user_id = _user_id AND e.feature = _feature
     AND e.outcome = 'ok' AND e.created_at >= month_start;

  used_day := used_day + COALESCE((
    SELECT SUM(GREATEST(1, COALESCE((j.input_summary->>'units')::int, 1)))
      FROM public.ai_generation_jobs j
     WHERE j.user_id = _user_id AND j.feature = _feature
       AND j.status IN ('queued','running') AND j.created_at >= day_start
  ), 0);

  used_month := used_month + COALESCE((
    SELECT SUM(GREATEST(1, COALESCE((j.input_summary->>'units')::int, 1)))
      FROM public.ai_generation_jobs j
     WHERE j.user_id = _user_id AND j.feature = _feature
       AND j.status IN ('queued','running') AND j.created_at >= month_start
  ), 0);

  IF _max_concurrent IS NOT NULL AND _max_concurrent >= 0 AND running >= _max_concurrent THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'CONCURRENCY_LIMIT',
      'used_day', used_day, 'used_month', used_month, 'running', running);
  END IF;

  IF _daily_limit IS NOT NULL AND _daily_limit >= 0 AND used_day + want_units > _daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'QUOTA_EXCEEDED',
      'used_day', used_day, 'used_month', used_month, 'running', running, 'window', 'day');
  END IF;

  IF _monthly_limit IS NOT NULL AND _monthly_limit >= 0 AND used_month + want_units > _monthly_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'QUOTA_EXCEEDED',
      'used_day', used_day, 'used_month', used_month, 'running', running, 'window', 'month');
  END IF;

  INSERT INTO public.ai_generation_jobs
    (user_id, feature, status, input_summary, related_reel_id, provider, model, max_attempts, heartbeat_at, started_at)
  VALUES
    (_user_id, _feature, 'running',
     COALESCE(_input_summary, '{}'::jsonb) || jsonb_build_object('units', want_units),
     _related_reel_id, _provider, _model, GREATEST(1, COALESCE(_max_attempts, 3)), now(), now())
  RETURNING id INTO new_job;

  RETURN jsonb_build_object('allowed', true, 'job_id', new_job,
    'used_day', used_day, 'used_month', used_month, 'running', running);
END $function$;

REVOKE ALL ON FUNCTION public.ai_reserve_quota(uuid, text, integer, integer, integer, integer, jsonb, uuid, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_reserve_quota(uuid, text, integer, integer, integer, integer, jsonb, uuid, text, text, integer) TO service_role;