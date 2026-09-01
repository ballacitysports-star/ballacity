CREATE TABLE public.data_export_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested','processing','ready','expired','failed')),
  categories text[] NOT NULL DEFAULT '{}',
  storage_path text,
  file_bytes bigint,
  row_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  ready_at timestamp with time zone,
  expires_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX data_export_requests_user_idx
  ON public.data_export_requests (user_id, requested_at DESC);

GRANT SELECT, INSERT ON public.data_export_requests TO authenticated;
GRANT ALL ON public.data_export_requests TO service_role;

ALTER TABLE public.data_export_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read their own export requests"
  ON public.data_export_requests FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Members request their own exports"
  ON public.data_export_requests FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'requested'
    AND storage_path IS NULL
  );

CREATE TRIGGER data_export_requests_touch
  BEFORE UPDATE ON public.data_export_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Rate limit: at most 3 export requests per rolling 24 hours per member.
CREATE OR REPLACE FUNCTION public.enforce_data_export_rate_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  recent integer;
BEGIN
  SELECT count(*) INTO recent
  FROM public.data_export_requests
  WHERE user_id = NEW.user_id
    AND requested_at > now() - interval '24 hours';

  IF recent >= 3 THEN
    RAISE EXCEPTION 'You have reached the limit of 3 data exports per day. Try again later.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER data_export_requests_rate_limit
  BEFORE INSERT ON public.data_export_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_data_export_rate_limit();

-- Marks ready exports whose signed download window has lapsed.
CREATE OR REPLACE FUNCTION public.expire_stale_data_exports()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  touched integer;
BEGIN
  UPDATE public.data_export_requests
  SET status = 'expired'
  WHERE status IN ('ready','processing','requested')
    AND expires_at IS NOT NULL
    AND expires_at < now();
  GET DIAGNOSTICS touched = ROW_COUNT;
  RETURN touched;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_data_exports() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_data_exports() TO service_role;
REVOKE ALL ON FUNCTION public.enforce_data_export_rate_limit() FROM PUBLIC, anon, authenticated;