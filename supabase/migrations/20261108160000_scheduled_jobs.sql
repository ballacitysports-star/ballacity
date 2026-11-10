-- P2-7: scheduled jobs (owner decision R8, 2026-11-08: Supabase pg_cron).
-- Reminders and held pushes go out while the app is closed; old error reports are purged.
--
-- 1. private_sec.worker_post(_path): POSTs to an app worker endpoint with the shared worker secret
--    (Vault: reels_worker_secret), through pg_net. The app's address comes from app_settings
--    'worker_base_url' ({"url": "https://..."}) or, when that is empty, from the existing
--    process-highlight-reels job, so no environment's address is written into the repository.
--    With neither, it does nothing and returns NULL. Not callable by clients.
-- 2. Jobs, where pg_cron and pg_net are installed (otherwise skipped with a notice):
--      flush-held-notifications  every 5 minutes  /api/public/notifications/flush (minor curfew pushes)
--      send-game-reminders       every 5 minutes  /api/public/reminders/run
--      purge-app-error-events    daily 03:17 UTC  purge_app_error_events() (30 days)
--    cron.schedule with a job name replaces a job of that name, so re-running is safe.
-- 3. app_settings 'worker_base_url' = {"url": null}, not public.
--
-- Rollback: docs/rollbacks/20261108160000_scheduled_jobs.down.sql.

INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('worker_base_url', '{"url": null}'::jsonb,
        'Base URL the scheduled jobs call (P2-7). Empty: taken from the reels job.', false)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION private_sec.worker_base_url()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _url text;
BEGIN
  SELECT NULLIF(btrim(value->>'url'), '') INTO _url FROM public.app_settings WHERE key = 'worker_base_url';
  IF _url IS NULL AND to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$SELECT substring(command from 'https://[^/'']+') FROM cron.job
                WHERE jobname = 'process-highlight-reels' LIMIT 1$q$ INTO _url;
  END IF;
  IF _url IS NULL OR _url !~ '^https://[A-Za-z0-9.\-]+(:[0-9]+)?$' THEN
    RETURN NULL;
  END IF;
  RETURN _url;
END;
$$;
REVOKE ALL ON FUNCTION private_sec.worker_base_url() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.worker_post(_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _base text := private_sec.worker_base_url();
  _id bigint;
BEGIN
  IF _path IS NULL OR _path !~ '^/api/public/[a-z0-9/_\-]+$' THEN
    RAISE EXCEPTION 'INVALID_WORKER_PATH' USING ERRCODE = '22023';
  END IF;
  IF _base IS NULL THEN
    RAISE NOTICE 'worker_post: no worker base URL; skipped %', _path;
    RETURN NULL;
  END IF;
  EXECUTE $q$SELECT net.http_post(
      url := $1,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-worker-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'reels_worker_secret')),
      body := '{}'::jsonb)$q$
    INTO _id USING _base || _path;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION private_sec.worker_post(text) FROM PUBLIC, anon, authenticated;

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    PERFORM cron.schedule('flush-held-notifications', '*/5 * * * *',
      $j$SELECT private_sec.worker_post('/api/public/notifications/flush')$j$);
    PERFORM cron.schedule('send-game-reminders', '*/5 * * * *',
      $j$SELECT private_sec.worker_post('/api/public/reminders/run')$j$);
    PERFORM cron.schedule('purge-app-error-events', '17 3 * * *',
      $j$SELECT public.purge_app_error_events()$j$);
  ELSE
    RAISE NOTICE 'pg_cron or pg_net is not installed: scheduled jobs skipped';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'scheduled jobs skipped: %', SQLERRM;
END
$cron$;
