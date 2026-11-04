-- MOD-1: reporting for team posts, comments and the media attached to a post, on the existing moderation queue.
--
-- REUSES: user_reports (the queue moderators already work from), the existing held/hidden moderation states of team_posts and
-- post_comments, image_moderation (quarantine of the attached image), notifications, admin_audit_log, user_blocks (the reporter can
-- still block the author; blocks are not changed here). NEW: two subject types, a hold ledger, appeals, and the moderator decisions.
--
-- REPORTING. A signed-in account can report a team post or a comment only if it can read it (checked under the reporter's own row
-- security, so a hidden or unknown id gives the same answer as one that does not exist: no oracle). The reported account is taken from
-- the content, never from the client. One open report per reporter per item; at most 20 content reports per reporter per day. Reports are
-- readable only by the reporter and moderators; the author is never told who reported.
-- ESCALATION. Reasons minor_safety, threats and illegal start as 'escalated'.
-- AUTOMATIC HOLD. When enough different people report the same item within 30 days, it is held (moderation_status = 'held': visible only
-- to its author and the team's managers, listed in the moderation queue) until a moderator decides: 2 reporters when the author is under 18
-- or not a confirmed adult, 3 otherwise. A hold is reversible, never deletes anything and is recorded in a ledger with the prior status.
-- DECISIONS (moderators only, audited): dismiss, hide (uphold), remove_media (quarantine the attached image and hide the post), restore.
-- APPEALS. The author, or a verified guardian of a minor author, may ask for a second look once a decision has been made; a different
-- moderator (or an administrator) must review it; reversing restores the content. Appeals and reports are retained 24 months after closure
-- (documented in src/lib/retention.ts; purge function provided, not scheduled); escalated items and open appeals are never purged.
-- Depends on 20261105130000 (reason list) and the existing moderation states. No data is rewritten.

-- Dependency guard: fail loudly, before changing anything, if a migration this one needs has not been applied (plpgsql bodies would otherwise fail only at user time).
DO $guard$ BEGIN
  IF to_regprocedure('public.is_moderator(uuid)') IS NULL OR to_regprocedure('public.age_cohort_of(uuid)') IS NULL OR to_regprocedure('private_sec.scrub_game_public_text(text)') IS NULL OR to_regclass('public.user_reports') IS NULL OR to_regclass('public.team_posts') IS NULL OR to_regclass('public.post_comments') IS NULL THEN
    RAISE EXCEPTION 'MOD-1: a required earlier release migration has not been applied (see docs/release/youth-privacy-release-runbook.md, sections 2 and 16)';
  END IF;
END $guard$;


ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS team_post_id uuid;
ALTER TABLE public.user_reports ADD COLUMN IF NOT EXISTS comment_id uuid;
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_subject_type_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_subject_type_check
  CHECK (subject_type = ANY (ARRAY['user', 'game', 'message', 'reel', 'payment', 'team_post', 'comment']));
ALTER TABLE public.user_reports DROP CONSTRAINT IF EXISTS user_reports_content_shape_check;
ALTER TABLE public.user_reports ADD CONSTRAINT user_reports_content_shape_check
  CHECK ((subject_type = 'team_post') = (team_post_id IS NOT NULL) AND (subject_type = 'comment') = (comment_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS user_reports_open_team_post_uidx ON public.user_reports (reporter_id, team_post_id)
  WHERE team_post_id IS NOT NULL AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing', 'escalated');
CREATE UNIQUE INDEX IF NOT EXISTS user_reports_open_comment_uidx ON public.user_reports (reporter_id, comment_id)
  WHERE comment_id IS NOT NULL AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing', 'escalated');
CREATE INDEX IF NOT EXISTS user_reports_team_post_idx ON public.user_reports (team_post_id) WHERE team_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS user_reports_comment_idx ON public.user_reports (comment_id) WHERE comment_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------------------------------- ledger
CREATE TABLE IF NOT EXISTS public.content_report_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('team_post', 'comment')),
  content_id uuid NOT NULL,
  level text NOT NULL CHECK (level IN ('held', 'hidden')),
  prior_status text,
  created_by uuid,                       -- NULL = automatic
  created_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  released_by uuid,
  release_note text
);
CREATE INDEX IF NOT EXISTS content_report_holds_open_idx ON public.content_report_holds (content_type, content_id) WHERE released_at IS NULL;
ALTER TABLE public.content_report_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Moderators read content holds" ON public.content_report_holds FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));
REVOKE ALL ON public.content_report_holds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.content_report_holds TO authenticated;
GRANT ALL ON public.content_report_holds TO service_role;

CREATE TABLE IF NOT EXISTS public.moderation_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type text NOT NULL CHECK (content_type IN ('team_post', 'comment')),
  content_id uuid NOT NULL,
  appellant_id uuid NOT NULL,
  note text NOT NULL CHECK (length(note) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'upheld', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text
);
CREATE UNIQUE INDEX IF NOT EXISTS moderation_appeals_one_open_uidx ON public.moderation_appeals (content_type, content_id, appellant_id) WHERE status = 'open';
ALTER TABLE public.moderation_appeals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Appellants and moderators read appeals" ON public.moderation_appeals FOR SELECT TO authenticated
  USING (appellant_id = auth.uid() OR public.is_moderator(auth.uid()));
REVOKE ALL ON public.moderation_appeals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.moderation_appeals TO authenticated;
GRANT ALL ON public.moderation_appeals TO service_role;

-- The only place content state changes for a hold: a nested write, which the existing text-moderation guard treats as a system write.
CREATE OR REPLACE FUNCTION private_sec.apply_content_hold()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _open integer; _prior text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.content_type = 'team_post' THEN
      SELECT moderation_status INTO _prior FROM public.team_posts WHERE id = NEW.content_id;
      UPDATE public.team_posts SET moderation_status = 'held',
             moderator_hidden_at = CASE WHEN NEW.level = 'hidden' THEN COALESCE(moderator_hidden_at, now()) ELSE moderator_hidden_at END
       WHERE id = NEW.content_id;
    ELSE
      SELECT moderation_status INTO _prior FROM public.post_comments WHERE id = NEW.content_id;
      UPDATE public.post_comments SET moderation_status = 'held',
             hidden_at = CASE WHEN NEW.level = 'hidden' THEN COALESCE(hidden_at, now()) ELSE hidden_at END
       WHERE id = NEW.content_id;
    END IF;
    UPDATE public.content_report_holds SET prior_status = COALESCE(_prior, 'approved') WHERE id = NEW.id AND prior_status IS NULL;
  ELSIF NEW.released_at IS NOT NULL AND OLD.released_at IS NULL THEN
    SELECT count(*) INTO _open FROM public.content_report_holds
     WHERE content_type = NEW.content_type AND content_id = NEW.content_id AND released_at IS NULL;
    IF _open = 0 THEN
      IF NEW.content_type = 'team_post' THEN
        UPDATE public.team_posts SET moderation_status = CASE WHEN moderation_status = 'held' THEN COALESCE(NEW.prior_status, 'approved') ELSE moderation_status END,
               moderator_hidden_at = NULL WHERE id = NEW.content_id;
      ELSE
        UPDATE public.post_comments SET moderation_status = CASE WHEN moderation_status = 'held' THEN COALESCE(NEW.prior_status, 'approved') ELSE moderation_status END,
               hidden_at = NULL WHERE id = NEW.content_id;
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.apply_content_hold() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.apply_content_hold() TO service_role;
DROP TRIGGER IF EXISTS apply_content_hold_trg ON public.content_report_holds;
CREATE TRIGGER apply_content_hold_trg AFTER INSERT OR UPDATE ON public.content_report_holds
  FOR EACH ROW EXECUTE FUNCTION private_sec.apply_content_hold();

CREATE OR REPLACE FUNCTION private_sec.content_author(_type text, _id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE WHEN _type = 'team_post' THEN (SELECT author_id FROM public.team_posts WHERE id = _id)
              ELSE (SELECT author_id FROM public.post_comments WHERE id = _id) END
$$;
REVOKE ALL ON FUNCTION private_sec.content_author(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.content_author(text, uuid) TO service_role;

-- ------------------------------------------------------------------------------------------------------ report validation
-- SECURITY INVOKER on purpose: the lookups below run under the reporter's own row security.
CREATE OR REPLACE FUNCTION public.validate_content_report()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO '' AS $$
DECLARE _author uuid; _recent integer;
BEGIN
  IF NEW.subject_type NOT IN ('team_post', 'comment') THEN RETURN NEW; END IF;
  IF NEW.subject_type = 'team_post' THEN
    SELECT p.author_id INTO _author FROM public.team_posts p WHERE p.id = NEW.team_post_id;
  ELSE
    SELECT c.author_id INTO _author FROM public.post_comments c WHERE c.id = NEW.comment_id AND c.deleted_at IS NULL;
  END IF;
  IF _author IS NULL THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: this item is not available to report.' USING ERRCODE = 'no_data_found';
  END IF;
  SELECT count(*) INTO _recent FROM public.user_reports r
   WHERE r.reporter_id = NEW.reporter_id AND r.subject_type IN ('team_post', 'comment') AND r.created_at > now() - interval '24 hours';
  IF _recent >= 20 THEN
    RAISE EXCEPTION 'REPORT_RATE_LIMIT: too many reports today. A moderator will review the ones you already sent.' USING ERRCODE = 'check_violation';
  END IF;
  NEW.reported_id := _author;               -- never trust the client for who is being reported
  NEW.game_id := NULL; NEW.conversation_id := NULL; NEW.message_id := NULL; NEW.reel_id := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.validate_content_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_content_report() TO authenticated, service_role;
DROP TRIGGER IF EXISTS a1_validate_content_report_trg ON public.user_reports;
CREATE TRIGGER a1_validate_content_report_trg BEFORE INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.validate_content_report();

-- --------------------------------------------------------------------------------------------- escalation and automatic hold
CREATE OR REPLACE FUNCTION public.handle_content_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _type text; _id uuid; _author uuid; _reporters integer; _need integer; _link text; _team text;
BEGIN
  IF NEW.subject_type NOT IN ('team_post', 'comment') THEN RETURN NULL; END IF;
  _type := NEW.subject_type;
  _id := CASE WHEN _type = 'team_post' THEN NEW.team_post_id ELSE NEW.comment_id END;
  _author := private_sec.content_author(_type, _id);
  IF NEW.reason IN ('minor_safety', 'threats', 'illegal') THEN
    UPDATE public.user_reports SET status = 'escalated' WHERE id = NEW.id;
  END IF;
  SELECT count(DISTINCT r.reporter_id) INTO _reporters FROM public.user_reports r
   WHERE r.subject_type = _type AND COALESCE(r.team_post_id, r.comment_id) = _id AND r.created_at > now() - interval '30 days'
     AND r.status IN ('new', 'open', 'pending', 'investigating', 'reviewing', 'escalated');
  _need := CASE WHEN COALESCE(public.age_cohort_of(_author), 'unknown') <> 'adult' THEN 2 ELSE 3 END;
  IF NEW.reason IN ('minor_safety', 'illegal') THEN _need := 1; END IF;   -- child-safety and illegal content is held on the first report
  IF _reporters >= _need AND NOT EXISTS (SELECT 1 FROM public.content_report_holds h WHERE h.content_type = _type AND h.content_id = _id AND h.released_at IS NULL) THEN
    INSERT INTO public.content_report_holds (content_type, content_id, level) VALUES (_type, _id, 'held');
    IF _type = 'team_post' THEN
      SELECT team_id INTO _team FROM public.team_posts WHERE id = _id;
      _link := '/teams/' || _team;
    ELSE
      _link := '/notifications';
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_author, 'moderation_notice', 'Your post is under review',
            'Your ' || CASE WHEN _type = 'team_post' THEN 'team post' ELSE 'comment' END || ' was reported and is hidden from other people while a moderator reviews it. If you think this is a mistake, you can ask for a review.',
            _link);
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.handle_content_report() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_content_report() TO service_role;
DROP TRIGGER IF EXISTS zz_handle_content_report_trg ON public.user_reports;
CREATE TRIGGER zz_handle_content_report_trg AFTER INSERT ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.handle_content_report();

-- ------------------------------------------------------------------------------------------------------- moderator decisions
CREATE OR REPLACE FUNCTION public.moderator_decide_content_report(_report uuid, _decision text, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r record; _type text; _id uuid; _author uuid; _img text; _bucket text; _path text; _status text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF _decision NOT IN ('dismiss', 'hide', 'remove_media', 'restore') THEN RAISE EXCEPTION 'Unknown decision %', _decision; END IF;
  IF _notes IS NOT NULL AND length(_notes) > 1000 THEN RAISE EXCEPTION 'Notes too long'; END IF;
  SELECT * INTO _r FROM public.user_reports WHERE id = _report AND subject_type IN ('team_post', 'comment');
  IF NOT FOUND THEN RAISE EXCEPTION 'Report not found'; END IF;
  _type := _r.subject_type; _id := COALESCE(_r.team_post_id, _r.comment_id);
  _author := private_sec.content_author(_type, _id);

  IF _decision = 'hide' THEN
    INSERT INTO public.content_report_holds (content_type, content_id, level, created_by) VALUES (_type, _id, 'hidden', auth.uid());
  ELSIF _decision = 'remove_media' THEN
    IF _type <> 'team_post' THEN RAISE EXCEPTION 'Only a team post has media'; END IF;
    SELECT image_url INTO _img FROM public.team_posts WHERE id = _id;
    IF _img IS NOT NULL THEN
      _bucket := substring(_img from '/storage/v1/object/(?:public|sign)/([^/]+)/');
      _path := split_part(substring(_img from '/storage/v1/object/(?:public|sign)/[^/]+/(.+)$'), '?', 1);
      IF _bucket IS NOT NULL AND _path IS NOT NULL THEN
        INSERT INTO public.image_moderation (bucket, path, owner_id, status, reason, quarantined_at, scan)
        VALUES (_bucket, _path, _author, 'quarantined', 'Removed after a report', now(), jsonb_build_object('stage', 'content_report'))
        ON CONFLICT (bucket, path) DO UPDATE SET status = 'quarantined', reason = 'Removed after a report', quarantined_at = now();
      END IF;
    END IF;
    INSERT INTO public.content_report_holds (content_type, content_id, level, created_by) VALUES (_type, _id, 'hidden', auth.uid());
  ELSIF _decision IN ('dismiss', 'restore') THEN
    IF _decision = 'restore' OR NOT EXISTS (
         SELECT 1 FROM public.user_reports r WHERE r.id <> _report AND r.subject_type = _type AND COALESCE(r.team_post_id, r.comment_id) = _id
            AND r.status IN ('new', 'open', 'pending', 'investigating', 'reviewing', 'escalated')) THEN
      UPDATE public.content_report_holds SET released_at = now(), released_by = auth.uid(), release_note = _decision
       WHERE content_type = _type AND content_id = _id AND released_at IS NULL;
    END IF;
  END IF;

  _status := CASE _decision WHEN 'dismiss' THEN 'dismissed' WHEN 'restore' THEN 'resolved' ELSE 'actioned' END;
  UPDATE public.user_reports SET status = _status, reviewed_by = auth.uid(), reviewed_at = now(), resolution_notes = _notes
   WHERE subject_type = _type AND COALESCE(team_post_id, comment_id) = _id
     AND (id = _report OR (_decision IN ('hide', 'remove_media', 'restore') AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing', 'escalated')));
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), 'content_report_' || _decision, _type, _id::text, _notes, jsonb_build_object('report_id', _report));
  IF _decision IN ('hide', 'remove_media') AND _author IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_author, 'moderation_notice', 'A moderator reviewed your post',
            'A moderator removed your ' || CASE WHEN _type = 'team_post' THEN 'team post' ELSE 'comment' END || ' after a report. If you think this is a mistake, you can ask for a review.', '/notifications');
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.moderator_decide_content_report(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_decide_content_report(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------- appeals
CREATE OR REPLACE FUNCTION public.appeal_content_decision(_type text, _id uuid, _note text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _author uuid; _appeal uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF _type NOT IN ('team_post', 'comment') THEN RAISE EXCEPTION 'Unknown content type'; END IF;
  IF _note IS NULL OR length(btrim(_note)) = 0 OR length(_note) > 500 THEN RAISE EXCEPTION 'Add a short note (up to 500 characters)'; END IF;
  _author := private_sec.content_author(_type, _id);
  IF _author IS NULL OR NOT (_author = auth.uid() OR public.is_guardian_of(auth.uid(), _author)) THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: nothing to appeal.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.content_report_holds h WHERE h.content_type = _type AND h.content_id = _id AND h.released_at IS NULL) THEN
    RAISE EXCEPTION 'CONTENT_NOT_FOUND: nothing to appeal.' USING ERRCODE = 'no_data_found';
  END IF;
  INSERT INTO public.moderation_appeals (content_type, content_id, appellant_id, note) VALUES (_type, _id, auth.uid(), btrim(_note))
  RETURNING id INTO _appeal;
  RETURN _appeal;
END $$;
REVOKE ALL ON FUNCTION public.appeal_content_decision(text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.appeal_content_decision(text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.moderator_review_appeal(_appeal uuid, _reverse boolean, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _a record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _a FROM public.moderation_appeals WHERE id = _appeal AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Appeal not found or already reviewed'; END IF;
  IF EXISTS (SELECT 1 FROM public.user_reports r WHERE r.subject_type = _a.content_type AND COALESCE(r.team_post_id, r.comment_id) = _a.content_id
               AND r.reviewed_by = auth.uid())
     AND NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RAISE EXCEPTION 'A different moderator must review this appeal' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _reverse THEN
    UPDATE public.content_report_holds SET released_at = now(), released_by = auth.uid(), release_note = 'appeal reversed'
     WHERE content_type = _a.content_type AND content_id = _a.content_id AND released_at IS NULL;
    UPDATE public.user_reports SET status = 'resolved', reviewed_by = COALESCE(reviewed_by, auth.uid()), reviewed_at = COALESCE(reviewed_at, now())
     WHERE subject_type = _a.content_type AND COALESCE(team_post_id, comment_id) = _a.content_id AND status = 'actioned';
  END IF;
  UPDATE public.moderation_appeals SET status = CASE WHEN _reverse THEN 'reversed' ELSE 'upheld' END, reviewed_by = auth.uid(), reviewed_at = now(), review_notes = _notes
   WHERE id = _appeal;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
  VALUES (auth.uid(), CASE WHEN _reverse THEN 'content_appeal_reversed' ELSE 'content_appeal_upheld' END, _a.content_type, _a.content_id::text, _notes,
          jsonb_build_object('appeal_id', _appeal));
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_a.appellant_id, 'moderation_notice', 'Your review request was answered',
          CASE WHEN _reverse THEN 'A moderator looked again and restored your content.' ELSE 'A moderator looked again and kept the earlier decision.' END, '/notifications');
END $$;
REVOKE ALL ON FUNCTION public.moderator_review_appeal(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_review_appeal(uuid, boolean, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------- retention
-- Closed reports and decided appeals older than the window (24 months by default). Never touches an escalated item or an open appeal.
-- Service role only, not scheduled: running it is a separate approved operation.
CREATE OR REPLACE FUNCTION private_sec.purge_closed_content_reports(_older_than interval DEFAULT interval '24 months')
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  IF _older_than < interval '12 months' THEN RAISE EXCEPTION 'Retention cannot be shorter than 12 months'; END IF;
  DELETE FROM public.moderation_appeals WHERE status <> 'open' AND reviewed_at < now() - _older_than;
  DELETE FROM public.content_report_holds WHERE released_at < now() - _older_than;
  DELETE FROM public.user_reports r
   WHERE r.subject_type IN ('team_post', 'comment') AND r.status IN ('dismissed', 'resolved', 'actioned')
     AND COALESCE(r.reviewed_at, r.updated_at) < now() - _older_than
     AND NOT EXISTS (SELECT 1 FROM public.moderation_appeals a WHERE a.content_type = r.subject_type AND a.content_id = COALESCE(r.team_post_id, r.comment_id) AND a.status = 'open');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION private_sec.purge_closed_content_reports(interval) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.purge_closed_content_reports(interval) TO service_role;

-- ------------------------------------------------------------------------------------------- escalations are never silently discarded
-- An escalated report (child safety, threats, illegal content, or escalated by a moderator) can be closed as dismissed or resolved only by an
-- administrator, with a written note of at least 10 characters, and the closure is audited. This holds for every route that writes the status:
-- the moderator RPC above, the existing Moderation tab (service role; the acting moderator is taken from reviewed_by) and direct updates.
-- A moderator can still take protective action (hide, remove media), which closes the report as 'actioned' without discarding it.
CREATE OR REPLACE FUNCTION public.guard_escalated_report_closure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _actor uuid;
BEGIN
  IF OLD.status = 'escalated' AND NEW.status IN ('dismissed', 'resolved') THEN
    _actor := COALESCE(auth.uid(), NEW.reviewed_by);
    IF _actor IS NULL OR NOT (public.has_role(_actor, 'admin') OR public.has_role(_actor, 'superadmin')) THEN
      RAISE EXCEPTION 'ESCALATION_ADMIN_REQUIRED: an escalated report can only be dismissed or resolved by an administrator. Hide the content or ask an administrator.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF length(btrim(COALESCE(NEW.resolution_notes, ''))) < 10 THEN
      RAISE EXCEPTION 'ESCALATION_NOTE_REQUIRED: closing an escalated report needs a written note (at least 10 characters).'
        USING ERRCODE = 'check_violation';
    END IF;
    INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    VALUES (_actor, 'escalated_report_closed', 'report', NEW.id::text, NEW.resolution_notes,
            jsonb_build_object('status', NEW.status, 'reason', NEW.reason, 'subject_type', NEW.subject_type));
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_escalated_report_closure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_escalated_report_closure() TO service_role;
DROP TRIGGER IF EXISTS a1_guard_escalated_report_closure_trg ON public.user_reports;
CREATE TRIGGER a1_guard_escalated_report_closure_trg BEFORE UPDATE OF status ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_escalated_report_closure();

-- ------------------------------------------------------------------------------------------------------ guardian entry point for appeals
CREATE OR REPLACE FUNCTION public.guardian_content_holds()
RETURNS TABLE (content_type text, content_id uuid, child_user_id uuid, label text, level text, held_at timestamptz, has_open_appeal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT h.content_type, h.content_id, private_sec.content_author(h.content_type, h.content_id),
         CASE WHEN h.content_type = 'team_post'
              THEN left((SELECT p.title FROM public.team_posts p WHERE p.id = h.content_id), 80)
              ELSE left((SELECT c.body FROM public.post_comments c WHERE c.id = h.content_id), 80) END,
         h.level, h.created_at,
         EXISTS (SELECT 1 FROM public.moderation_appeals a WHERE a.content_type = h.content_type AND a.content_id = h.content_id AND a.status = 'open')
    FROM public.content_report_holds h
   WHERE auth.uid() IS NOT NULL AND h.released_at IS NULL
     AND public.is_guardian_of(auth.uid(), private_sec.content_author(h.content_type, h.content_id))
$$;
REVOKE ALL ON FUNCTION public.guardian_content_holds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardian_content_holds() TO authenticated, service_role;

-- The author's own entry point: what of theirs is under review and whether they already asked for a second look.
CREATE OR REPLACE FUNCTION public.my_content_holds()
RETURNS TABLE (content_type text, content_id uuid, label text, level text, held_at timestamptz, has_open_appeal boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT h.content_type, h.content_id,
         CASE WHEN h.content_type = 'team_post'
              THEN left((SELECT p.title FROM public.team_posts p WHERE p.id = h.content_id), 80)
              ELSE left((SELECT c.body FROM public.post_comments c WHERE c.id = h.content_id), 80) END,
         h.level, h.created_at,
         EXISTS (SELECT 1 FROM public.moderation_appeals a WHERE a.content_type = h.content_type AND a.content_id = h.content_id AND a.status = 'open')
    FROM public.content_report_holds h
   WHERE auth.uid() IS NOT NULL AND h.released_at IS NULL
     AND private_sec.content_author(h.content_type, h.content_id) = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_content_holds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_content_holds() TO authenticated, service_role;
