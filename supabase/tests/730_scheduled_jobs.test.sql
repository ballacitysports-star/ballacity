-- P2-7: scheduled jobs (supabase/migrations/20261108160000_scheduled_jobs.sql).
-- The worker helpers are not callable by clients; the base URL setting is private; worker_post refuses any
-- path outside /api/public/ and does nothing without a base URL; the base URL must be a plain https origin.
BEGIN;

SELECT t.person('someone', 30);

SELECT t.ok(EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'worker_base_url' AND NOT is_public),
  'the worker base URL setting exists and is not public');

SELECT t.as_user(t.id('someone'));
SELECT t.throws($$SELECT private_sec.worker_post('/api/public/reminders/run')$$, 'permission denied',
  'a signed-in member cannot call worker_post');
SELECT t.throws($$SELECT private_sec.worker_base_url()$$, 'permission denied', 'or read the base URL');
SELECT t.eq(t.count($$SELECT 1 FROM public.app_settings WHERE key = 'worker_base_url'$$), 0,
  'nor see the setting');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT private_sec.worker_post('/api/public/reminders/run')$$, 'permission denied',
  'a signed-out visitor cannot call worker_post');
SELECT t.reset();

SELECT t.throws($$SELECT private_sec.worker_post('https://evil.example/x')$$, 'INVALID_WORKER_PATH',
  'worker_post refuses anything but an /api/public/ path');
SELECT t.throws($$SELECT private_sec.worker_post('/api/public/../admin')$$, 'INVALID_WORKER_PATH',
  'including a path that climbs out');
SELECT t.ok((SELECT private_sec.worker_post('/api/public/reminders/run')) IS NULL,
  'with no base URL it does nothing');

UPDATE public.app_settings SET value = '{"url": "http://plain.example"}' WHERE key = 'worker_base_url';
SELECT t.ok(private_sec.worker_base_url() IS NULL, 'a non-https base URL is ignored');
UPDATE public.app_settings SET value = '{"url": "https://app.example/path?x=1"}' WHERE key = 'worker_base_url';
SELECT t.ok(private_sec.worker_base_url() IS NULL, 'so is one with a path or query');
UPDATE public.app_settings SET value = '{"url": "https://app.example"}' WHERE key = 'worker_base_url';
SELECT t.eq(private_sec.worker_base_url(), 'https://app.example', 'a plain https origin is used');

ROLLBACK;
