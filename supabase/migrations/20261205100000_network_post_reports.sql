-- Network posts: a member reports a post they can read (backlog P1-2a).
--
-- WHY. network_posts is on in production and nobody can report a post: user_reports_subject_type_check
-- (20261109100000_team_chat) has no 'post', and the app offers no Report action on a post. A member who sees abuse in a
-- post can only report the whole account.
--
-- WHAT.
-- 1. public.user_reports gains post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL, as team_chat_message_id does
--    for a chat message: if the post is deleted for good (by its author, by a manager of its team, or with its team,
--    venue or author), the report stays, without the link. A partial index (post_id, reporter_id) WHERE post_id IS NOT
--    NULL serves the duplicate check and the ON DELETE SET NULL. It also gains post_body_md5 text: md5 of the post's text
--    when the report was filed. The author can edit a post after it is reported, so the moderation queue compares it with
--    the text now and says when the two differ. Only the fingerprint is kept, never a copy of the text, so a report keeps
--    nothing of the post once the post is gone.
-- 2. user_reports_subject_type_check is recreated with every value it allows today ('user', 'game', 'message', 'reel',
--    'payment', 'team_chat_message', the 20261109100000 list) plus 'post'. It refuses, changing nothing, unless the
--    constraint is the one 20261109100000 created (or already this migration's), so a value added elsewhere since is
--    never dropped by accident.
-- 3. public.report_post(_post uuid, _reason text, _details text DEFAULT NULL) -> jsonb {"report_id": uuid, "filed":
--    boolean}. SECURITY DEFINER, empty search_path, modelled on report_team_chat_message. EXECUTE for authenticated only
--    (revoked from PUBLIC, anon and service_role: a service-role call has no auth.uid() and could only be refused).
--    - AUTH_REQUIRED (42501) without a signed-in caller.
--    - INVALID_REASON (22023) unless _reason is one of the reasons user_reports_reason_check allows, the same list every
--      other report is held to. Checked before the post is looked up, so it says nothing about the post.
--    - POST_NOT_FOUND (P0002), the same answer, for a post that does not exist and for one the caller cannot read under
--      the posts SELECT rules: posts_read_by_audience (private_sec.can_view_post: the audience, a block in either
--      direction, a hidden team or facility, the author's age cap) and the restrictive posts_moderated_read (approved,
--      not hidden, not deleted, unless it is the caller's own). So a pending, held, hidden or deleted post, or one across
--      a block, cannot be reported by anyone but its author, who is refused next. No oracle: whether a post exists is
--      never told apart from whether the caller may see it.
--    - CANNOT_REPORT_SELF (22023, "you cannot report your own post") for the caller's own post.
--    - A repeat that adds nothing files nothing: when the caller already has an open report of this post (any status but
--      resolved, actioned or dismissed, so the legacy 'pending', 'open' and 'reviewing' count as open) for the same
--      reason, about the same text of the post (post_body_md5), and the new details are none or the ones that report has,
--      the call answers {"report_id": that report, "filed": false} and writes nothing. That stops a double tap. Any
--      other repeat is a new row and answers "filed": true: a new reason (a follow-up that raises the stakes, such as
--      minor_safety), a new note, or a post edited since. So the member is never told a report was filed when it was
--      not, and nothing they add is dropped. Concurrent calls by the same reporter for the same post are serialised by a
--      transaction advisory lock (released at commit, so a pooled connection never keeps it). Other report paths have
--      no rate limit, and this adds none.
--    - The row: reporter_id the caller, reported_id the post's author_id (for a post made as a team or facility, the
--      person who wrote it, the one guard_post_write checked is its manager, owner or admin, not the team's or
--      facility's owner), subject_type 'post', post_id, post_body_md5 md5 of the post's text, status 'new', the reason,
--      details trimmed (empty means none) and cut to 1000 characters.
--    The author never reads the report: user_reports is readable only by its reporter and by moderators (unchanged).
-- 4. private_sec.user_reports_post_via_rpc(), a BEFORE INSERT trigger on user_reports (SECURITY INVOKER, empty
--    search_path): an insert made directly by an API role (anon, authenticated) with subject_type 'post', a post_id or a
--    post_body_md5 is refused with REPORT_POST_VIA_RPC (42501). Without it the "Users create their own reports" policy
--    would let a member write a post report straight into the table: about a post they cannot see, naming anyone as the
--    reported user, and the post_id foreign key would answer whether a post id exists. report_post (which runs as its owner) and server code
--    (service_role) are unaffected, and so is every other kind of report. It runs before the foreign key check, so a
--    direct insert is refused the same way whether the post exists or not.
--
-- Nothing else changes: no existing row, policy or grant on user_reports or posts. The existing report guard
-- (guard_report_moderation_update, REPORT_FIELDS_FIXED) already keeps post_id and post_body_md5 fixed through the API.
-- The moderation queue (src/lib/moderation.functions.ts, /admin/moderation) shows a post report with the post as it is
-- now, says when its text differs from the reported text, and lets a moderator hide it with the existing Remove content
-- action, as it does for a reported game or reel. The app reads user_reports.post_id only when it exists, so it works
-- before this migration is applied and after a rollback. Docs: docs/design/home-feed.md ("Post reports"). Test:
-- supabase/tests/565_network_post_reports.test.sql; race in scripts/db-test.mjs.
--
-- Rollback: docs/rollbacks/20261205100000_network_post_reports.down.sql.

SET lock_timeout = '5s';

-- 0. Refuse unless the subject check is the one this migration expects to replace ------------------------------------------------
DO $pre$
DECLARE
  _was  CONSTANT text := 'CHECK ((subject_type = ANY (ARRAY[''user''::text, ''game''::text, ''message''::text, ''reel''::text, ''payment''::text, ''team_chat_message''::text])))';
  _will CONSTANT text := 'CHECK ((subject_type = ANY (ARRAY[''user''::text, ''game''::text, ''message''::text, ''reel''::text, ''payment''::text, ''team_chat_message''::text, ''post''::text])))';
  _got  text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO _got
    FROM pg_constraint c
   WHERE c.conrelid = 'public.user_reports'::regclass AND c.conname = 'user_reports_subject_type_check';
  IF _got IS DISTINCT FROM _was AND _got IS DISTINCT FROM _will THEN
    RAISE EXCEPTION 'Refusing to run: user_reports_subject_type_check is not the one 20261109100000 created (%). A later change needs a person to look first.', _got;
  END IF;
END
$pre$;

-- 1. The post a report is about ----------------------------------------------------------------------------------------------------
ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS post_id uuid
  REFERENCES public.posts(id) ON DELETE SET NULL;
ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS post_body_md5 text;
CREATE INDEX IF NOT EXISTS user_reports_post_idx ON public.user_reports (post_id, reporter_id) WHERE post_id IS NOT NULL;

-- 2. 'post' joins the subjects ---------------------------------------------------------------------------------------------------
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_subject_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type IN ('user', 'game', 'message', 'reel', 'payment', 'team_chat_message', 'post'));

-- 3. Reporting a post ----------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.report_post(_post uuid, _reason text, _details text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _p public.posts;
  _note text := left(NULLIF(btrim(_details), ''), 1000);
  _body_md5 text;
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  -- user_reports_reason_check's list: the reasons every other report may give.
  IF _reason IS NULL OR NOT (_reason = ANY (ARRAY[
       'spam', 'harassment', 'inappropriate', 'impersonation', 'safety', 'other', 'threats', 'fake_account', 'scam',
       'unsafe_behavior', 'minor_safety', 'fake_game', 'unsafe_location', 'misleading', 'illegal', 'payment_scam',
       'payment_not_received', 'payment_pressure', 'unsafe_conditions', 'injury_risk'])) THEN
    RAISE EXCEPTION 'INVALID_REASON' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _p FROM public.posts WHERE id = _post;
  -- One answer for a missing post and for one the caller cannot read: both posts SELECT policies, as for a read.
  IF _p.id IS NULL
     OR NOT private_sec.can_view_post(_p.author_id, _p.posted_as, _p.team_id, _p.org_id, _p.audience, _me)
     OR NOT ((_p.moderation_status = 'approved' AND _p.hidden_at IS NULL AND _p.deleted_at IS NULL)
             OR _p.author_id = _me) THEN
    RAISE EXCEPTION 'POST_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _p.author_id = _me THEN
    RAISE EXCEPTION 'CANNOT_REPORT_SELF: you cannot report your own post.' USING ERRCODE = '22023';
  END IF;

  -- A repeat that adds nothing (an open report of the same text for the same reason, and no new note) files nothing;
  -- anything else is a new report. The lock serialises one reporter's calls for one post until commit.
  _body_md5 := md5(_p.body);
  PERFORM pg_advisory_xact_lock(hashtextextended('public.report_post:' || _me::text || ':' || _p.id::text, 0));
  SELECT r.id INTO _id
    FROM public.user_reports r
   WHERE r.post_id = _p.id AND r.reporter_id = _me AND r.subject_type = 'post'
     AND r.status NOT IN ('resolved', 'actioned', 'dismissed')
     AND r.reason = _reason
     AND r.post_body_md5 IS NOT DISTINCT FROM _body_md5
     AND (_note IS NULL OR r.details IS NOT DISTINCT FROM _note)
   ORDER BY r.created_at
   LIMIT 1;
  IF _id IS NOT NULL THEN
    RETURN jsonb_build_object('report_id', _id, 'filed', false);
  END IF;

  INSERT INTO public.user_reports (reporter_id, reported_id, reason, details, subject_type, post_id, post_body_md5, status)
  VALUES (_me, _p.author_id, _reason, _note, 'post', _p.id, _body_md5, 'new')
  RETURNING id INTO _id;
  RETURN jsonb_build_object('report_id', _id, 'filed', true);
END;
$$;
REVOKE ALL ON FUNCTION public.report_post(uuid, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_post(uuid, text, text) TO authenticated;
COMMENT ON FUNCTION public.report_post(uuid, text, text) IS
  'A member reports a post they can read (POST_NOT_FOUND for a missing post and for one they cannot read alike; not their own). Answers {report_id, filed}: a repeat that adds nothing to an open report files nothing (filed false). Authenticated only.';

-- 4. Post reports only through report_post ------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.user_reports_post_via_rpc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.subject_type = 'post' OR NEW.post_id IS NOT NULL OR NEW.post_body_md5 IS NOT NULL) THEN
    RAISE EXCEPTION 'REPORT_POST_VIA_RPC: report a post with report_post.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private_sec.user_reports_post_via_rpc() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS user_reports_post_via_rpc ON public.user_reports;
CREATE TRIGGER user_reports_post_via_rpc
  BEFORE INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION private_sec.user_reports_post_via_rpc();

RESET lock_timeout;
