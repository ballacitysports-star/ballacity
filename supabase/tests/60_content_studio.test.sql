-- Content Studio: only a superadmin approves or publishes, an approval is bound
-- to the exact text and destination Page, editing withdraws it, a publish goes
-- out at most once per approval, and Page tokens are not readable through the API.
BEGIN;

SELECT t.person('studiosuper', 40), t.person('studiomod', 35), t.person('studioplayer', 25);
INSERT INTO public.user_roles (user_id, role) VALUES
  (t.id('studiosuper'), 'superadmin'), (t.id('studiomod'), 'moderator');

-- Setup as the server would do it.
INSERT INTO public.content_sources (id, url, normalized_url, url_host, platform, source_kind, submitted_by)
VALUES (t.id('src-one'), 'https://m.facebook.com/x/posts/1', 'https://facebook.com/x/posts/1',
        'facebook.com', 'facebook', 'post', t.id('studiomod'));
INSERT INTO public.content_drafts (id, source_id, message, link_url, hashtags, created_by)
VALUES (t.id('draft-one'), t.id('src-one'), 'Pickup run Saturday', 'https://ballacity.com/games/g1',
        '{BallaCity}', t.id('studiomod'));
INSERT INTO public.social_page_connections (id, page_id, page_name, connected_by)
VALUES (t.id('page-main'), '1234567890', 'BallaCity', t.id('studiosuper'));
INSERT INTO public.social_page_tokens (connection_id, token_ciphertext)
VALUES (t.id('page-main'), 'v1.sealed.token');

-- ---- who can read what ----------------------------------------------------
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.content_sources'), 0, 'a visitor sees no sources');
SELECT t.as_user(t.id('studioplayer'));
SELECT t.eq(t.count('SELECT 1 FROM public.content_sources'), 0, 'an ordinary member sees no sources');
SELECT t.eq(t.count('SELECT 1 FROM public.content_drafts'), 0, 'an ordinary member sees no drafts');
SELECT t.as_user(t.id('studiomod'));
SELECT t.eq(t.count('SELECT 1 FROM public.content_sources'), 1, 'staff see sources');
SELECT t.eq(t.count('SELECT 1 FROM public.social_page_connections'), 1, 'staff see which Page is connected');
SELECT t.eq(t.count('SELECT 1 FROM public.social_page_tokens'), 0, 'staff cannot read a Page token');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.eq(t.count('SELECT 1 FROM public.social_page_tokens'), 0, 'not even a superadmin reads a token through the API');
SELECT t.eq(t.count('SELECT 1 FROM public.social_oauth_states'), 0, 'OAuth states are server-only');

-- ---- direct writes ---------------------------------------------------------
SELECT t.as_user(t.id('studioplayer'));
SELECT t.throws($q$INSERT INTO public.content_drafts (message) VALUES ('x')$q$, 'permission denied',
  'a member cannot write a draft');
SELECT t.as_user(t.id('studiomod'));
SELECT t.throws($q$UPDATE public.content_drafts SET message = 'y'$q$, 'permission denied',
  'staff write drafts only through the server');
SELECT t.as_service();
SELECT t.throws(format($q$UPDATE public.content_drafts SET status = 'approved' WHERE id = %L$q$, t.id('draft-one')),
  'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY', 'not even the server can mark a draft approved directly');
SELECT t.throws($q$INSERT INTO public.content_drafts (message, status) VALUES ('x', 'published')$q$,
  'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY', 'a draft cannot be born published');

-- ---- approval --------------------------------------------------------------
SELECT t.as_user(t.id('studiosuper'));
SELECT t.throws(format('SELECT public.approve_content_draft(%L, 1)', t.id('draft-one')),
  'NO_DESTINATION_PAGE', 'nothing is approvable before a destination Page is chosen');
SELECT t.as_user(t.id('studiomod'));
SELECT t.throws(format('SELECT public.set_content_destination_page(%L)', t.id('page-main')),
  'NOT_SUPERADMIN', 'a moderator cannot choose the destination Page');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.lives(format('SELECT public.set_content_destination_page(%L)', t.id('page-main')),
  'a superadmin chooses the destination Page');
SELECT t.as_user(t.id('studiomod'));
SELECT t.throws(format('SELECT public.approve_content_draft(%L, 1)', t.id('draft-one')),
  'NOT_SUPERADMIN', 'a moderator cannot approve');
SELECT t.as_anon();
SELECT t.throws(format('SELECT public.approve_content_draft(%L, 1)', t.id('draft-one')),
  'permission denied', 'a visitor cannot even call approval');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.throws(format('SELECT public.approve_content_draft(%L, 2)', t.id('draft-one')),
  'DRAFT_CHANGED', 'approving a version other than the one on screen is refused');
SELECT t.lives(format('SELECT public.approve_content_draft(%L, 1)', t.id('draft-one')),
  'a superadmin approves the version they saw');
SELECT t.reset();
SELECT t.eq((SELECT payload_hash FROM public.content_approvals WHERE draft_id = t.id('draft-one')),
  public.content_payload_hash(public.content_draft_payload(
    (SELECT d FROM public.content_drafts d WHERE id = t.id('draft-one')), '1234567890')),
  'the approval records the hash of exactly what was approved');
SELECT t.as_service();
SELECT t.throws($q$UPDATE public.content_approvals SET payload = '{}'$q$, 'APPROVAL_IMMUTABLE',
  'an approval cannot be edited afterwards');

-- ---- editing after approval ------------------------------------------------
SELECT t.lives(format($q$UPDATE public.content_drafts SET message = 'Pickup run SUNDAY' WHERE id = %L$q$, t.id('draft-one')),
  'the server edits an approved draft');
SELECT t.reset();
SELECT t.ok((SELECT status = 'draft' AND approval_id IS NULL AND version = 2
             FROM public.content_drafts WHERE id = t.id('draft-one')),
  'editing withdraws the approval and bumps the version');
SELECT t.as_service();
SELECT t.changed(format('UPDATE public.content_drafts SET version = 1 WHERE id = %L', t.id('draft-one')));
SELECT t.reset();
SELECT t.eq((SELECT version FROM public.content_drafts WHERE id = t.id('draft-one')), 2,
  'the version cannot be forged back');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.throws(format($q$SELECT * FROM public.begin_content_publish(%L, 'key-unapproved')$q$, t.id('draft-one')),
  'DRAFT_NOT_APPROVED', 'an edited draft cannot be published on its old approval');
SELECT t.lives(format('SELECT public.approve_content_draft(%L, 2)', t.id('draft-one')),
  'the new version is approved again');

-- ---- publishing --------------------------------------------------------------
SELECT t.as_user(t.id('studiomod'));
SELECT t.throws(format($q$SELECT * FROM public.begin_content_publish(%L, 'key-moderator')$q$, t.id('draft-one')),
  'NOT_SUPERADMIN', 'a moderator cannot publish');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.eq((SELECT created FROM public.begin_content_publish(t.id('draft-one'), 'key-attempt-one')), true,
  'the first request creates the publish attempt');
SELECT t.eq((SELECT created FROM public.begin_content_publish(t.id('draft-one'), 'key-attempt-one')), false,
  'a repeat with the same key gets the same attempt and must not post');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.content_publish_attempts WHERE draft_id = t.id('draft-one')), 1,
  'a repeated request does not create a second attempt');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.throws(format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-two')$q$, t.id('draft-one')),
  'DRAFT_NOT_APPROVED', 'a second publish cannot start while one is running');
SELECT t.as_service();
SELECT t.throws(format($q$UPDATE public.content_drafts SET message = 'late' WHERE id = %L$q$, t.id('draft-one')),
  'DRAFT_LOCKED', 'a draft cannot be edited while it is publishing');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.throws($q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts LIMIT 1), true, '1_2', NULL, NULL)$q$,
  'permission denied', 'only the server records what Meta answered');
SELECT t.as_service();
SELECT t.throws($q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts LIMIT 1), true, '', NULL, NULL)$q$,
  'EXTERNAL_ID_REQUIRED', 'published is never recorded without the post id Meta returned');
SELECT t.lives($q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts LIMIT 1), false, NULL, 'TOKEN_EXPIRED', 'expired')$q$,
  'the server records a failure');
SELECT t.reset();
SELECT t.ok((SELECT status = 'failed' AND approval_id IS NOT NULL FROM public.content_drafts WHERE id = t.id('draft-one')),
  'a failed publish keeps its approval for a retry');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.lives(format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-three')$q$, t.id('draft-one')),
  'a failed publish can be retried with a new key');
SELECT t.as_service();
SELECT t.lives($q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts WHERE idempotency_key = 'key-attempt-three'), true, '1234567890_987', NULL, NULL)$q$,
  'the server records the success');
SELECT t.throws($q$SELECT public.finish_content_publish((SELECT id FROM public.content_publish_attempts WHERE idempotency_key = 'key-attempt-three'), false, NULL, 'X', 'Y')$q$,
  'ATTEMPT_FINISHED', 'a finished attempt cannot be rewritten');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.throws(format($q$SELECT * FROM public.begin_content_publish(%L, 'key-attempt-four')$q$, t.id('draft-one')),
  'DRAFT_NOT_APPROVED', 'a published draft cannot be published again');
SELECT t.as_service();
SELECT t.throws(format($q$UPDATE public.content_drafts SET message = 'z' WHERE id = %L$q$, t.id('draft-one')),
  'DRAFT_LOCKED', 'a published draft cannot be edited');
SELECT t.throws(format($q$UPDATE public.content_drafts SET status = 'draft' WHERE id = %L$q$, t.id('draft-one')),
  'DRAFT_STATUS_SET_BY_WORKFLOW_ONLY', 'a published draft cannot be reset to draft');

-- ---- moving the destination makes old approvals stale ------------------------
SELECT t.reset();
INSERT INTO public.content_drafts (id, message) VALUES (t.id('draft-two'), 'Second');
INSERT INTO public.social_page_connections (id, page_id, page_name)
VALUES (t.id('page-other'), '555', 'Another Page');
SELECT t.as_user(t.id('studiosuper'));
SELECT t.lives(format('SELECT public.approve_content_draft(%L, 1)', t.id('draft-two')), 'approve a second draft');
SELECT t.lives(format('SELECT public.set_content_destination_page(%L)', t.id('page-other')), 'move the destination');
SELECT t.throws(format($q$SELECT * FROM public.begin_content_publish(%L, 'key-other-page')$q$, t.id('draft-two')),
  'DESTINATION_CHANGED', 'an approval for the previous Page cannot be published to the new one');

SELECT t.reset();
SELECT t.ok((SELECT count(*) FROM public.admin_audit_log WHERE action LIKE 'content.%') >= 8,
  'approvals, publishes and destination changes are in the audit trail');

ROLLBACK;
