-- Independent pre-review (2026-11-05), audit F13: appeal separation hinged on user_reports.reviewed_by, which records
-- whoever last changed the report (the app's status screen and a direct moderator update both rewrite it). After a second
-- moderator touched the report, the moderator who made the decision could decide the appeal of it; a moderator who
-- reported the content (and so had it held automatically) could decide the appeal against it.
--
-- moderator_review_appeal (20261106130000) now refuses anyone who is a party to the decision: named on the immutable
-- decision record (admin_audit_log 'content_report_*', append-only), named as reviewer on a report about the content,
-- the creator of a hold on it, or a reporter of it. Admins and superadmins keep their existing override. Otherwise
-- unchanged.

DO $$ BEGIN
  IF to_regprocedure('public.moderator_review_appeal(uuid,boolean,text)') IS NULL OR to_regclass('public.content_report_holds') IS NULL
     OR to_regclass('public.admin_audit_log') IS NULL THEN
    RAISE EXCEPTION 'appeal separation: needs MOD-1 (20261106130000)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.moderator_review_appeal(_appeal uuid, _reverse boolean, _notes text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _a record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege'; END IF;
  SELECT * INTO _a FROM public.moderation_appeals WHERE id = _appeal AND status = 'open';
  IF NOT FOUND THEN RAISE EXCEPTION 'Appeal not found or already reviewed'; END IF;
  -- A party to the decision never reviews its appeal: whoever decided (the immutable decision record in admin_audit_log,
  -- and any reviewer named on a report about the content), placed a hold on it, or reported it.
  IF (EXISTS (SELECT 1 FROM public.user_reports r
               WHERE r.subject_type = _a.content_type AND COALESCE(r.team_post_id, r.comment_id) = _a.content_id
                 AND (r.reviewed_by = auth.uid() OR r.reporter_id = auth.uid()))
      OR EXISTS (SELECT 1 FROM public.content_report_holds h
                  WHERE h.content_type = _a.content_type AND h.content_id = _a.content_id AND h.created_by = auth.uid())
      OR EXISTS (SELECT 1 FROM public.admin_audit_log l
                  WHERE l.actor_id = auth.uid() AND l.target_type = _a.content_type AND l.target_id = _a.content_id::text
                    AND l.action LIKE 'content\_report\_%'))
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
