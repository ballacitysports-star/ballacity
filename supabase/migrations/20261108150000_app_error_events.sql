-- P0-8: error reporting to our own table (owner decision 2026-11-08: no outside vendor).
-- Design: docs/phase0-audit-and-implementation-plan.md (P0-8).
--
-- 1. app_error_events: one row per reported error, from the browser (error boundary, window errors, unhandled
--    rejections) or the server entry. It holds no personal data: no user id, no IP, no full URL (path only, with
--    ids masked), and a message the app scrubs of emails, tokens, ids and long numbers before sending. Only whether
--    the person was signed in is kept.
--    Row level security is on with no policies, and clients have no grants: only the service role (the app's
--    server functions and the superadmin view) reads or writes it.
-- 2. purge_app_error_events(_older_than): deletes rows older than the window (default 30 days). Service role only;
--    the scheduled jobs (P2-7) call it daily.
--
-- Rollback: docs/rollbacks/20261108150000_app_error_events.down.sql.

CREATE TABLE IF NOT EXISTS public.app_error_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('client', 'server')),
  kind text NOT NULL CHECK (kind IN ('boundary', 'window', 'rejection', 'ssr', 'server_fn')),
  message text NOT NULL CHECK (char_length(message) BETWEEN 1 AND 500),
  route text CHECK (route IS NULL OR char_length(route) <= 200),
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[a-z0-9]{1,32}$'),
  release text CHECK (release IS NULL OR char_length(release) <= 64),
  signed_in boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS app_error_events_created_idx ON public.app_error_events (created_at DESC);
CREATE INDEX IF NOT EXISTS app_error_events_fingerprint_idx ON public.app_error_events (fingerprint, created_at DESC);

ALTER TABLE public.app_error_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_error_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.app_error_events TO service_role;

CREATE OR REPLACE FUNCTION public.purge_app_error_events(_older_than interval DEFAULT interval '30 days')
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _n integer;
BEGIN
  IF _older_than IS NULL OR _older_than < interval '1 day' THEN
    RAISE EXCEPTION 'INVALID_WINDOW' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.app_error_events WHERE created_at < now() - _older_than;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_app_error_events(interval) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_app_error_events(interval) TO service_role;
