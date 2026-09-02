-- ============================================================
-- 1. PARENTAL CONSENT THRESHOLD (conservative global default: through age 15)
--    LEGAL REVIEW REQUIRED — modeled on Georgia's under-16 requirement.
-- ============================================================

UPDATE public.app_settings
SET value = jsonb_set(
      COALESCE(value, '{}'::jsonb),
      '{parental_consent_max_age}',
      to_jsonb(15)
    ),
    updated_at = now()
WHERE key = 'age_policy';

CREATE OR REPLACE FUNCTION public.parental_consent_required(_cohort text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE consent_max int; mid_max int; adult_at int;
BEGIN
  IF _cohort IS NULL OR _cohort = 'unknown' OR _cohort = 'adult' THEN RETURN false; END IF;
  IF _cohort = 'child_under_13' THEN RETURN true; END IF;
  consent_max := public.age_policy_number('parental_consent_max_age', 15);
  mid_max     := public.age_policy_number('teen_mid_max_age', 15);
  adult_at    := public.age_policy_number('adult_age', 18);
  IF _cohort = 'teen_13_15' THEN RETURN consent_max >= mid_max; END IF;
  IF _cohort = 'teen_16_17' THEN RETURN consent_max >= adult_at - 1; END IF;
  RETURN false;
END $function$;

REVOKE ALL ON FUNCTION public.parental_consent_required(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.parental_consent_required(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.child_features_locked(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.parental_consent_required(public.age_cohort_of(_user))
     AND public.parental_consent_state(_user) <> 'approved';
$function$;

CREATE OR REPLACE FUNCTION public.platform_status(_user uuid)
RETURNS text
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _cohort text; _consent text; _suspended timestamptz;
BEGIN
  SELECT age_cohort, suspended_at INTO _cohort, _suspended
  FROM public.profiles WHERE id = _user;
  IF _cohort IS NULL THEN RETURN 'no_account'; END IF;
  IF _suspended IS NOT NULL THEN RETURN 'suspended'; END IF;
  IF _cohort = 'unknown' THEN RETURN 'age_verification_required'; END IF;
  -- Consent is required by configurable age band, not hardcoded to under-13.
  IF NOT public.parental_consent_required(_cohort) THEN RETURN 'active'; END IF;
  _consent := public.parental_consent_state(_user);
  RETURN CASE _consent
    WHEN 'approved' THEN 'active'
    WHEN 'denied' THEN 'consent_denied'
    WHEN 'revoked' THEN 'consent_revoked'
    WHEN 'expired' THEN 'consent_expired'
    WHEN 'pending' THEN 'pending_parental_consent'
    ELSE 'consent_required'
  END;
END $function$;

-- ============================================================
-- 2. NOTIFICATION CURFEW FOR MINORS
-- ============================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.child_controls
  ADD COLUMN IF NOT EXISTS notification_curfew_lifted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.set_child_controls(_child uuid, _controls jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF NOT (public.is_guardian_of(me, _child) OR public.is_moderator(me)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;
  INSERT INTO public.child_controls (child_user_id, updated_by) VALUES (_child, me)
  ON CONFLICT (child_user_id) DO NOTHING;

  UPDATE public.child_controls SET
    messaging = COALESCE(_controls ->> 'messaging', messaging),
    media_visibility = COALESCE(_controls ->> 'media_visibility', media_visibility),
    social_discovery = COALESCE((_controls ->> 'social_discovery')::boolean, social_discovery),
    ai_analysis = COALESCE((_controls ->> 'ai_analysis')::boolean, ai_analysis),
    location_precision = COALESCE(_controls ->> 'location_precision', location_precision),
    game_participation = COALESCE((_controls ->> 'game_participation')::boolean, game_participation),
    notifications = COALESCE((_controls ->> 'notifications')::boolean, notifications),
    notification_curfew_lifted = COALESCE(
      (_controls ->> 'notification_curfew_lifted')::boolean, notification_curfew_lifted),
    updated_by = me
  WHERE child_user_id = _child;

  IF (_controls ->> 'media_visibility') = 'private' THEN
    UPDATE public.highlight_reels SET hidden_at = COALESCE(hidden_at, now()) WHERE user_id = _child;
  END IF;
END $function$;

CREATE TABLE IF NOT EXISTS public.scheduled_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  url text,
  channel text NOT NULL DEFAULT 'push',
  reason text NOT NULL DEFAULT 'minor_notification_curfew',
  deliver_after timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.scheduled_notifications TO authenticated;
GRANT ALL ON public.scheduled_notifications TO service_role;
ALTER TABLE public.scheduled_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own queued notifications"
ON public.scheduled_notifications FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_moderator(auth.uid()));

CREATE INDEX IF NOT EXISTS scheduled_notifications_pending_idx
  ON public.scheduled_notifications (status, deliver_after);

CREATE TRIGGER scheduled_notifications_updated_at
BEFORE UPDATE ON public.scheduled_notifications
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================
-- 3. TIME ON PLATFORM (reporting only — never a compliance claim)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.session_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  timezone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.session_activity TO authenticated;
GRANT ALL ON public.session_activity TO service_role;
ALTER TABLE public.session_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own session activity"
ON public.session_activity FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_moderator(auth.uid()));

CREATE INDEX IF NOT EXISTS session_activity_user_idx
  ON public.session_activity (user_id, last_heartbeat_at DESC);

CREATE TRIGGER session_activity_updated_at
BEFORE UPDATE ON public.session_activity
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Heartbeat: extends the member's current session, or opens a new one after a
-- 5 minute gap. Duration only — no page, no content, nothing behavioural.
CREATE OR REPLACE FUNCTION public.record_session_heartbeat(_timezone text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); _id uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;

  IF _timezone IS NOT NULL AND length(_timezone) BETWEEN 1 AND 64 THEN
    UPDATE public.profiles SET timezone = _timezone
    WHERE id = me AND COALESCE(timezone, '') <> _timezone;
  END IF;

  SELECT id INTO _id FROM public.session_activity
  WHERE user_id = me AND last_heartbeat_at > now() - interval '5 minutes'
  ORDER BY last_heartbeat_at DESC LIMIT 1;

  IF _id IS NULL THEN
    INSERT INTO public.session_activity (user_id, timezone)
    VALUES (me, _timezone) RETURNING id INTO _id;
  ELSE
    UPDATE public.session_activity
    SET last_heartbeat_at = now(), timezone = COALESCE(_timezone, timezone)
    WHERE id = _id;
  END IF;
  RETURN _id;
END $function$;

REVOKE ALL ON FUNCTION public.record_session_heartbeat(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_session_heartbeat(text) TO authenticated, service_role;

-- Aggregate report: average daily minutes per minor cohort and time of day.
CREATE OR REPLACE FUNCTION public.minor_time_on_platform(_days integer DEFAULT 30)
RETURNS TABLE(cohort text, day_part text, members bigint, avg_daily_minutes numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_moderator(auth.uid()) OR public.is_superadmin(auth.uid())) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  RETURN QUERY
  WITH sessions AS (
    SELECT p.age_cohort AS cohort,
           s.user_id,
           (s.started_at AT TIME ZONE COALESCE(s.timezone, p.timezone, 'UTC')) AS local_start,
           GREATEST(
             EXTRACT(EPOCH FROM (s.last_heartbeat_at - s.started_at)) / 60.0,
             1
           ) AS minutes
    FROM public.session_activity s
    JOIN public.profiles p ON p.id = s.user_id
    WHERE s.started_at > now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1))
      AND p.age_cohort IN ('child_under_13', 'teen_13_15', 'teen_16_17')
  ), bucketed AS (
    SELECT cohort,
           CASE
             WHEN EXTRACT(HOUR FROM local_start) < 6 THEN 'overnight_00_06'
             WHEN EXTRACT(HOUR FROM local_start) < 12 THEN 'morning_06_12'
             WHEN EXTRACT(HOUR FROM local_start) < 18 THEN 'afternoon_12_18'
             ELSE 'evening_18_24'
           END AS day_part,
           user_id,
           local_start::date AS local_day,
           minutes
    FROM sessions
  ), per_day AS (
    SELECT cohort, day_part, user_id, local_day, SUM(minutes) AS day_minutes
    FROM bucketed GROUP BY 1, 2, 3, 4
  )
  SELECT per_day.cohort,
         per_day.day_part,
         COUNT(DISTINCT per_day.user_id)::bigint,
         ROUND(AVG(per_day.day_minutes)::numeric, 1)
  FROM per_day GROUP BY 1, 2 ORDER BY 1, 2;
END $function$;

REVOKE ALL ON FUNCTION public.minor_time_on_platform(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minor_time_on_platform(integer) TO authenticated, service_role;