-- ============ AI jobs ============
CREATE TABLE public.ai_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_type text NOT NULL DEFAULT 'user' CHECK (owner_type IN ('user','team','gym')),
  owner_id uuid,
  feature text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','succeeded','failed','cancelled','blocked')),
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  user_message text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  provider text,
  model text,
  est_cost_cents numeric(12,4) NOT NULL DEFAULT 0,
  heartbeat_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  related_reel_id uuid REFERENCES public.highlight_reels(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_generation_jobs TO authenticated;
GRANT ALL ON public.ai_generation_jobs TO service_role;

ALTER TABLE public.ai_generation_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own AI jobs are readable"
  ON public.ai_generation_jobs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_superadmin(auth.uid()));

CREATE INDEX ai_generation_jobs_user_created_idx
  ON public.ai_generation_jobs (user_id, created_at DESC);
CREATE INDEX ai_generation_jobs_active_idx
  ON public.ai_generation_jobs (status, heartbeat_at)
  WHERE status IN ('queued','running');
CREATE INDEX ai_generation_jobs_reel_idx
  ON public.ai_generation_jobs (related_reel_id)
  WHERE related_reel_id IS NOT NULL;

CREATE TRIGGER ai_generation_jobs_updated_at
  BEFORE UPDATE ON public.ai_generation_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ AI usage ============
CREATE TABLE public.ai_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.ai_generation_jobs(id) ON DELETE SET NULL,
  feature text NOT NULL,
  units integer NOT NULL DEFAULT 1,
  provider text,
  model text,
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  est_cost_cents numeric(12,4) NOT NULL DEFAULT 0,
  outcome text NOT NULL CHECK (outcome IN ('ok','error','blocked','quota_denied')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT ALL ON public.ai_usage_events TO service_role;

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own AI usage is readable"
  ON public.ai_usage_events FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_superadmin(auth.uid()));

CREATE INDEX ai_usage_events_user_created_idx
  ON public.ai_usage_events (user_id, created_at DESC);
CREATE INDEX ai_usage_events_feature_created_idx
  ON public.ai_usage_events (feature, created_at DESC);

-- ============ AI text moderation ============
CREATE TABLE public.ai_text_moderation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.ai_generation_jobs(id) ON DELETE SET NULL,
  target_table text NOT NULL,
  target_id text,
  target_field text NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('allow','review','block')),
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.ai_text_moderation TO authenticated;
GRANT ALL ON public.ai_text_moderation TO service_role;

ALTER TABLE public.ai_text_moderation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own AI text verdicts are readable"
  ON public.ai_text_moderation FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_superadmin(auth.uid()));

CREATE INDEX ai_text_moderation_user_created_idx
  ON public.ai_text_moderation (user_id, created_at DESC);
CREATE INDEX ai_text_moderation_target_idx
  ON public.ai_text_moderation (target_table, target_id);

-- ============ Atomic quota reservation ============
-- Counts recorded usage in the day/month window plus units already reserved by
-- non-terminal jobs, and (when within limits) inserts the reserving job row —
-- all inside one transaction under a per-user advisory lock, so two concurrent
-- requests can never both consume the same last unit.
CREATE OR REPLACE FUNCTION public.ai_reserve_quota(
  _user_id uuid,
  _feature text,
  _units integer,
  _daily_limit integer,
  _monthly_limit integer,
  _max_concurrent integer,
  _input_summary jsonb DEFAULT '{}'::jsonb,
  _related_reel_id uuid DEFAULT NULL,
  _provider text DEFAULT NULL,
  _model text DEFAULT NULL,
  _max_attempts integer DEFAULT 3
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  units integer := GREATEST(1, COALESCE(_units, 1));
  day_start timestamptz := date_trunc('day', now());
  month_start timestamptz := date_trunc('month', now());
  used_day integer := 0;
  used_month integer := 0;
  running integer := 0;
  new_job uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_user_id::text || ':' || _feature, 0));

  -- Jobs already in flight for this member (all features) drive the concurrency cap.
  SELECT COUNT(*) INTO running
    FROM public.ai_generation_jobs
   WHERE user_id = _user_id AND status IN ('queued','running');

  -- Recorded usage in each window.
  SELECT COALESCE(SUM(units), 0) INTO used_day
    FROM public.ai_usage_events
   WHERE user_id = _user_id AND feature = _feature
     AND outcome = 'ok' AND created_at >= day_start;

  SELECT COALESCE(SUM(units), 0) INTO used_month
    FROM public.ai_usage_events
   WHERE user_id = _user_id AND feature = _feature
     AND outcome = 'ok' AND created_at >= month_start;

  -- Plus units already reserved by in-flight jobs of this feature.
  used_day := used_day + COALESCE((
    SELECT SUM(GREATEST(1, COALESCE((input_summary->>'units')::int, 1)))
      FROM public.ai_generation_jobs
     WHERE user_id = _user_id AND feature = _feature
       AND status IN ('queued','running') AND created_at >= day_start
  ), 0);

  used_month := used_month + COALESCE((
    SELECT SUM(GREATEST(1, COALESCE((input_summary->>'units')::int, 1)))
      FROM public.ai_generation_jobs
     WHERE user_id = _user_id AND feature = _feature
       AND status IN ('queued','running') AND created_at >= month_start
  ), 0);

  IF _max_concurrent IS NOT NULL AND _max_concurrent >= 0 AND running >= _max_concurrent THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'CONCURRENCY_LIMIT',
      'used_day', used_day, 'used_month', used_month, 'running', running);
  END IF;

  IF _daily_limit IS NOT NULL AND _daily_limit >= 0 AND used_day + units > _daily_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'QUOTA_EXCEEDED',
      'used_day', used_day, 'used_month', used_month, 'running', running, 'window', 'day');
  END IF;

  IF _monthly_limit IS NOT NULL AND _monthly_limit >= 0 AND used_month + units > _monthly_limit THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'QUOTA_EXCEEDED',
      'used_day', used_day, 'used_month', used_month, 'running', running, 'window', 'month');
  END IF;

  INSERT INTO public.ai_generation_jobs
    (user_id, feature, status, input_summary, related_reel_id, provider, model, max_attempts, heartbeat_at, started_at)
  VALUES
    (_user_id, _feature, 'running',
     COALESCE(_input_summary, '{}'::jsonb) || jsonb_build_object('units', units),
     _related_reel_id, _provider, _model, GREATEST(1, COALESCE(_max_attempts, 3)), now(), now())
  RETURNING id INTO new_job;

  RETURN jsonb_build_object('allowed', true, 'job_id', new_job,
    'used_day', used_day, 'used_month', used_month, 'running', running);
END $$;

REVOKE ALL ON FUNCTION public.ai_reserve_quota(uuid, text, integer, integer, integer, integer, jsonb, uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_reserve_quota(uuid, text, integer, integer, integer, integer, jsonb, uuid, text, text, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_reserve_quota(uuid, text, integer, integer, integer, integer, jsonb, uuid, text, text, integer) TO service_role;

-- ============ Admin-editable AI configuration (non-secret only) ============
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES
  ('ai_features', '{}'::jsonb,
   'AI feature flags: global kill switch plus per-feature enable and per-cohort allowances. Empty means built-in defaults.', false),
  ('ai_limits', '{}'::jsonb,
   'AI limits per subscription tier: daily/monthly caps per feature, max concurrent jobs, media and processing ceilings. Empty means built-in defaults.', false),
  ('ai_provider', '{}'::jsonb,
   'AI provider and model names (non-secret configuration only — API keys live in server environment). Empty means built-in defaults.', false),
  ('ai_pricing', '{}'::jsonb,
   'Per-model price estimates used for cost estimates only. Empty means built-in defaults.', false)
ON CONFLICT (key) DO NOTHING;