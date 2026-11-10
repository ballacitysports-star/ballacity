-- P0-8: app_error_events (supabase/migrations/20261108150000_app_error_events.sql).
-- Only the service role reads or writes error reports; clients cannot, signed in or not. The purge keeps the
-- window and refuses a window under a day. Rows hold no user id.
BEGIN;

SELECT t.person('someone', 30);

SELECT t.as_service();
INSERT INTO public.app_error_events (source, kind, message, route, fingerprint, release, signed_in, created_at)
VALUES ('client', 'boundary', 'TypeError: x is undefined', '/games/:id', 'abc123', 'r1', true, now()),
       ('server', 'ssr', 'Old failure', '/feed', 'def456', 'r1', false, now() - interval '40 days');
SELECT t.eq(t.count('SELECT 1 FROM public.app_error_events'), 2, 'the service role writes and reads error reports');
SELECT t.reset();

SELECT t.as_user(t.id('someone'));
SELECT t.throws($$SELECT count(*) FROM public.app_error_events$$, 'permission denied',
  'a signed-in member cannot read error reports');
SELECT t.throws($$INSERT INTO public.app_error_events (source, kind, message, fingerprint) VALUES ('client','window','x','a1')$$,
  'permission denied', 'or write one directly');
SELECT t.throws($$SELECT public.purge_app_error_events()$$, 'permission denied', 'or purge them');
SELECT t.reset();

SELECT t.as_anon();
SELECT t.throws($$SELECT count(*) FROM public.app_error_events$$, 'permission denied',
  'a signed-out visitor cannot read error reports');
SELECT t.throws($$INSERT INTO public.app_error_events (source, kind, message, fingerprint) VALUES ('client','window','x','a1')$$,
  'permission denied', 'or write one');
SELECT t.reset();

SELECT t.ok(NOT EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'app_error_events'
                           AND column_name IN ('user_id', 'ip', 'email', 'url')),
  'there is no column for a user id, IP, email or full URL');
SELECT t.throws($$INSERT INTO public.app_error_events (source, kind, message, fingerprint) VALUES ('client','window','x','NOT A HASH!')$$,
  'check constraint', 'a fingerprint must be a short lowercase hash');
SELECT t.throws($$INSERT INTO public.app_error_events (source, kind, message, fingerprint) VALUES ('client','window', repeat('x', 501), 'a1')$$,
  'check constraint', 'a message is at most 500 characters');

SELECT t.as_service();
SELECT t.throws($$SELECT public.purge_app_error_events(interval '1 hour')$$, 'INVALID_WINDOW',
  'the purge refuses a window under a day');
SELECT t.eq((SELECT public.purge_app_error_events()), 1, 'the purge removes rows older than 30 days');
SELECT t.eq(t.count('SELECT 1 FROM public.app_error_events'), 1, 'and keeps the recent ones');
SELECT t.reset();

ROLLBACK;
