-- Behaviour checks for 20261021120000_content_studio.sql. Run against a database where the
-- full migration chain has been replayed on top of supabase-stubs.sql (see docs/content-studio.md).
-- Prints one PASS/FAIL row per check and a final count.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
-- ---------- harness ----------
CREATE OR REPLACE FUNCTION pg_temp.act(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), false);
  PERFORM set_config('request.jwt.claim.role', CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END, false);
END $$;
CREATE TABLE pg_temp.results (n serial, name text, ok boolean, detail text);
GRANT ALL ON pg_temp.results TO PUBLIC;
-- run _sql as _role/_uid; expect an error containing _want (or success if _want is null)
CREATE OR REPLACE FUNCTION pg_temp.check(_name text, _role text, _uid uuid, _sql text, _want text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE _err text := NULL;
BEGIN
  PERFORM pg_temp.act(_uid);
  BEGIN
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    _err := SQLERRM; RESET ROLE;
  END;
  INSERT INTO pg_temp.results(name, ok, detail) VALUES (_name,
    CASE WHEN _want IS NULL THEN _err IS NULL ELSE COALESCE(_err, '') LIKE '%' || _want || '%' END,
    COALESCE(_err, 'ok'));
END $$;

-- ---------- cast ----------
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES
 ('00000000-0000-0000-0000-00000000000a', 'super@test.local', now(), '{"display_name":"Super"}'),
 ('00000000-0000-0000-0000-00000000000b', 'mod@test.local',   now(), '{"display_name":"Mod"}'),
 ('00000000-0000-0000-0000-00000000000c', 'player@test.local', now(), '{"display_name":"Player"}');
INSERT INTO public.user_roles (user_id, role) VALUES
 ('00000000-0000-0000-0000-00000000000a', 'superadmin'),
 ('00000000-0000-0000-0000-00000000000b', 'moderator');
\set S '''00000000-0000-0000-0000-00000000000a'''
\set M '''00000000-0000-0000-0000-00000000000b'''
\set P '''00000000-0000-0000-0000-00000000000c'''

-- server (service_role) creates a source, a draft and the destination Page
INSERT INTO public.content_sources (id, url, normalized_url, url_host, platform, source_kind, submitted_by)
VALUES ('10000000-0000-0000-0000-000000000001', 'https://www.facebook.com/x/posts/1', 'https://facebook.com/x/posts/1', 'facebook.com', 'facebook', 'post', :M);
INSERT INTO public.content_drafts (id, source_id, message, link_url, hashtags, created_by)
VALUES ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Pickup run Saturday', 'https://ballacity.com/games/g1', '{BallaCity}', :M);
INSERT INTO public.social_page_connections (id, page_id, page_name, connected_by)
VALUES ('30000000-0000-0000-0000-000000000001', '1234567890', 'BallaCity', :S);

\set D '''20000000-0000-0000-0000-000000000001'''

-- ---------- reads ----------
SELECT pg_temp.check('anon cannot read sources', 'anon', NULL, 'SELECT 1 FROM public.content_sources', 'permission denied');
SELECT pg_temp.check('player reads no sources', 'authenticated', :P,
  'DO $x$ BEGIN IF (SELECT count(*) FROM public.content_sources) <> 0 THEN RAISE EXCEPTION ''LEAK''; END IF; END $x$', NULL);
SELECT pg_temp.check('moderator reads sources', 'authenticated', :M,
  'DO $x$ BEGIN IF (SELECT count(*) FROM public.content_sources) <> 1 THEN RAISE EXCEPTION ''MISSING''; END IF; END $x$', NULL);
SELECT pg_temp.check('nobody but service_role reads tokens', 'authenticated', :S, 'SELECT 1 FROM public.social_page_tokens', 'permission denied');
SELECT pg_temp.check('player cannot insert a draft', 'authenticated', :P,
  $q$INSERT INTO public.content_drafts (message) VALUES ('x')$q$, 'permission denied');
SELECT pg_temp.check('moderator cannot write drafts directly', 'authenticated', :M,
  $q$UPDATE public.content_drafts SET message = 'y'$q$, 'permission denied');

-- ---------- approval ----------
SELECT pg_temp.check('no destination page -> refused', 'authenticated', :S,
  format('SELECT public.approve_content_draft(%L, 1)', :D), 'NO_DESTINATION_PAGE');
SELECT pg_temp.check('moderator cannot pick the destination', 'authenticated', :M,
  $q$SELECT public.set_content_destination_page('30000000-0000-0000-0000-000000000001')$q$, 'NOT_SUPERADMIN');
SELECT pg_temp.check('superadmin picks the destination', 'authenticated', :S,
  $q$SELECT public.set_content_destination_page('30000000-0000-0000-0000-000000000001')$q$, NULL);
SELECT pg_temp.check('moderator cannot approve', 'authenticated', :M,
  format('SELECT public.approve_content_draft(%L, 1)', :D), 'NOT_SUPERADMIN');
SELECT pg_temp.check('anon cannot approve', 'anon', NULL,
  format('SELECT public.approve_content_draft(%L, 1)', :D), 'permission denied');
SELECT pg_temp.check('approving an outdated version -> refused', 'authenticated', :S,
  format('SELECT public.approve_content_draft(%L, 2)', :D), 'DRAFT_CHANGED');
SELECT pg_temp.check('server cannot mark approved directly', 'service_role', NULL,
  format($q$UPDATE public.content_drafts SET status = 'approved' WHERE id = %L$q$, :D), 'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY');
SELECT pg_temp.check('server cannot insert an approved draft', 'service_role', NULL,
  $q$INSERT INTO public.content_drafts (message, status) VALUES ('x', 'published')$q$, 'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY');
SELECT pg_temp.check('superadmin approves v1', 'authenticated', :S,
  format('SELECT public.approve_content_draft(%L, 1)', :D), NULL);
SELECT pg_temp.check('approval is immutable', 'service_role', NULL,
  $q$UPDATE public.content_approvals SET payload = '{}'$q$, 'APPROVAL_IMMUTABLE');

-- ---------- edit after approval ----------
SELECT pg_temp.check('server edits the approved message', 'service_role', NULL,
  format($q$UPDATE public.content_drafts SET message = 'Pickup run SUNDAY' WHERE id = %L$q$, :D), NULL);
SELECT pg_temp.check('edit voided approval and bumped version', 'service_role', NULL,
  format($q$DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.content_drafts WHERE id = %L AND status = 'draft' AND approval_id IS NULL AND version = 2) THEN RAISE EXCEPTION 'NOT_VOIDED'; END IF; END $x$$q$, :D), NULL);
SELECT pg_temp.check('server cannot forge the version', 'service_role', NULL,
  format($q$DO $x$ BEGIN UPDATE public.content_drafts SET version = 1 WHERE id = %L; IF (SELECT version FROM public.content_drafts WHERE id = %L) <> 2 THEN RAISE EXCEPTION 'FORGED'; END IF; END $x$$q$, :D, :D), NULL);
SELECT pg_temp.check('publish without approval -> refused', 'authenticated', :S,
  format($q$SELECT * FROM public.begin_content_publish(%L, 'key-unapproved-1')$q$, :D), 'DRAFT_NOT_APPROVED');
SELECT pg_temp.check('superadmin re-approves v2', 'authenticated', :S,
  format('SELECT public.approve_content_draft(%L, 2)', :D), NULL);

-- ---------- publishing ----------
SELECT pg_temp.check('moderator cannot start a publish', 'authenticated', :M,
  format($q$SELECT * FROM public.begin_content_publish(%L, 'key-mod-0001')$q$, :D), 'NOT_SUPERADMIN');
SELECT pg_temp.check('superadmin starts publish', 'authenticated', :S,
  format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-1')$q$, :D), NULL);
SELECT pg_temp.check('only the first call may publish', 'authenticated', :S,
  format($q$DO $x$ BEGIN IF (SELECT created FROM public.begin_content_publish(%L, 'key-attempt-1')) THEN RAISE EXCEPTION 'SECOND_CALL_CREATED'; END IF; END $x$$q$, :D), NULL);
SELECT pg_temp.check('same key returns the same attempt', 'authenticated', :S,
  format($q$DO $x$ BEGIN IF (SELECT count(*) FROM public.begin_content_publish(%L, 'key-attempt-1')) <> 1 OR (SELECT count(*) FROM public.content_publish_attempts) <> 1 THEN RAISE EXCEPTION 'DUPLICATE'; END IF; END $x$$q$, :D), NULL);
SELECT pg_temp.check('new key while publishing -> refused', 'authenticated', :S,
  format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-2')$q$, :D), 'DRAFT_NOT_APPROVED');
SELECT pg_temp.check('edit while publishing -> locked', 'service_role', NULL,
  format($q$UPDATE public.content_drafts SET message = 'late edit' WHERE id = %L$q$, :D), 'DRAFT_LOCKED');
SELECT pg_temp.check('superadmin cannot record a result', 'authenticated', :S,
  $q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts LIMIT 1), true, '1_2', NULL, NULL)$q$, 'permission denied');
SELECT pg_temp.check('success needs the Meta post id', 'service_role', NULL,
  $q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts LIMIT 1), true, '', NULL, NULL)$q$, 'EXTERNAL_ID_REQUIRED');
SELECT pg_temp.check('server records a failure', 'service_role', NULL,
  $q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts LIMIT 1), false, NULL, 'GRAPH_190', 'token expired')$q$, NULL);
SELECT pg_temp.check('failed draft keeps its approval', 'service_role', NULL,
  format($q$DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.content_drafts WHERE id = %L AND status = 'failed' AND approval_id IS NOT NULL) THEN RAISE EXCEPTION 'LOST'; END IF; END $x$$q$, :D), NULL);
SELECT pg_temp.check('retry with a new key', 'authenticated', :S,
  format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-3')$q$, :D), NULL);
SELECT pg_temp.check('server records success', 'service_role', NULL,
  $q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts WHERE idempotency_key = 'key-attempt-3'), true, '1234567890_987', NULL, NULL)$q$, NULL);
SELECT pg_temp.check('cannot finish twice', 'service_role', NULL,
  $q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts WHERE idempotency_key = 'key-attempt-3'), false, NULL, 'X', 'Y')$q$, 'ATTEMPT_FINISHED');
SELECT pg_temp.check('published draft cannot be published again', 'authenticated', :S,
  format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-4')$q$, :D), 'DRAFT_NOT_APPROVED');
SELECT pg_temp.check('published draft is locked', 'service_role', NULL,
  format($q$UPDATE public.content_drafts SET message = 'z' WHERE id = %L$q$, :D), 'DRAFT_LOCKED');
SELECT pg_temp.check('published draft status cannot be reset', 'service_role', NULL,
  format($q$UPDATE public.content_drafts SET status = 'draft' WHERE id = %L$q$, :D), 'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY');

-- ---------- stale approval via destination change ----------
INSERT INTO public.content_drafts (id, message) VALUES ('20000000-0000-0000-0000-000000000002', 'Second');
INSERT INTO public.social_page_connections (id, page_id, page_name) VALUES ('30000000-0000-0000-0000-000000000002', '555', 'Other page');
SELECT pg_temp.check('approve second draft', 'authenticated', :S,
  $q$SELECT public.approve_content_draft('20000000-0000-0000-0000-000000000002', 1)$q$, NULL);
SELECT pg_temp.check('move destination', 'authenticated', :S,
  $q$SELECT public.set_content_destination_page('30000000-0000-0000-0000-000000000002')$q$, NULL);
SELECT pg_temp.check('approval for the old Page is refused', 'authenticated', :S,
  $q$SELECT * FROM public.begin_content_publish('20000000-0000-0000-0000-000000000002', 'key-other-page-1')$q$, 'DESTINATION_CHANGED');
SELECT pg_temp.check('reject the second draft', 'authenticated', :S,
  $q$SELECT public.reject_content_draft('20000000-0000-0000-0000-000000000002', 'wrong page')$q$, NULL);

-- ---------- audit ----------
SELECT pg_temp.check('audit trail written', 'service_role', NULL,
  $q$DO $x$ BEGIN IF (SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'content.%') < 8 THEN RAISE EXCEPTION 'AUDIT_MISSING'; END IF; END $x$$q$, NULL);

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, detail FROM pg_temp.results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM pg_temp.results;
