-- MOD-1: reporting team posts, comments and attached media on the existing moderation queue.
BEGIN;
SELECT t.person('mgr', 38), t.person('author', 35), t.person('teenauthor', 17), t.person('guardian', 41), t.person('rep1', 30),
       t.person('rep2', 31), t.person('rep3', 32), t.person('rep4', 33), t.person('stranger', 34), t.person('modone', 39),
       t.person('modtwo', 40), t.person('adminone', 45), t.person('member', 29), t.person('blocked', 28);
SELECT t.guardian('guardian', 'teenauthor');
SELECT t.team('squad', 'mgr');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('modtwo'), 'moderator'), (t.id('adminone'), 'admin');
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_members (team_id, user_id) VALUES ('squad', t.id('author')), ('squad', t.id('teenauthor')), ('squad', t.id('member'));
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status, image_url) VALUES
  ('00000000-0000-0000-0000-00000000f001', 'squad', t.id('author'), 'announcement', 'Adult post', 'Practice Saturday', 'approved', 'https://x.supabase.co/storage/v1/object/public/team-covers/' || t.id('author') || '/pic.jpg'),
  ('00000000-0000-0000-0000-00000000f002', 'squad', t.id('teenauthor'), 'announcement', 'Teen post', 'Good game', 'approved', NULL),
  ('00000000-0000-0000-0000-00000000f003', 'squad', t.id('author'), 'announcement', 'Already held', 'x', 'held', NULL),
  ('00000000-0000-0000-0000-00000000f004', 'squad', t.id('author'), 'announcement', 'Third', 'x', 'approved', NULL);
INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body, moderation_status) VALUES
  ('00000000-0000-0000-0000-00000000c001', 'team_post', '00000000-0000-0000-0000-00000000f001', t.id('member'), 'a comment', 'approved');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('author'), t.id('blocked'));
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.rep(who text, post text, reason text, spoof text DEFAULT NULL) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id, status)
  VALUES (t.id(who), COALESCE(t.id(spoof), t.id(who)), 'team_post', reason, ('00000000-0000-0000-0000-00000000f' || post)::uuid, 'new') $f$;
GRANT EXECUTE ON FUNCTION t.rep(text, text, text, text) TO anon, authenticated;
CREATE FUNCTION t.repc(who text, reason text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, comment_id)
  VALUES (t.id(who), t.id(who), 'comment', reason, '00000000-0000-0000-0000-00000000c001') $f$;
GRANT EXECUTE ON FUNCTION t.repc(text, text) TO anon, authenticated;
CREATE FUNCTION t.pstatus(post text) RETURNS text LANGUAGE sql AS $f$ SELECT moderation_status FROM public.team_posts WHERE id = ('00000000-0000-0000-0000-00000000f' || post)::uuid $f$;

-- ---- who can report, and what the database records
SELECT t.as_user(t.id('rep1'));
SELECT t.lives($q$SELECT t.rep('rep1', '001', 'spam', 'mgr')$q$, 'a signed-in account can report a post it can read');
SELECT t.reset();
SELECT t.eq((SELECT reported_id FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-00000000f001'), t.id('author'), 'the reported account comes from the post, not from the client');
SELECT t.as_user(t.id('rep1'));
SELECT t.throws($q$SELECT t.rep('rep1', '001', 'spam')$q$, 'duplicate key', 'a second open report of the same post by the same person is refused');
SELECT t.throws($q$SELECT t.rep('rep1', '003', 'spam')$q$, 'CONTENT_NOT_FOUND', 'a post the reporter cannot read gives the same answer as one that does not exist');
SELECT t.throws($q$SELECT t.rep('rep1', '999', 'spam')$q$, 'CONTENT_NOT_FOUND', 'an unknown id');
SELECT t.as_user(t.id('author'));
SELECT t.throws($q$SELECT t.rep('author', '001', 'spam')$q$, 'user_reports_check', 'nobody can report their own post');
SELECT t.as_anon();
SELECT t.throws($q$SELECT t.rep('rep1', '001', 'spam')$q$, 'permission denied', 'anonymous cannot report');
SELECT t.as_user(t.id('blocked'));
SELECT t.lives($q$SELECT t.rep('blocked', '001', 'harassment')$q$, 'someone the author blocked can still report');
SELECT t.reset();

-- ---- reports are private
SELECT t.as_user(t.id('author'));
SELECT t.eq(t.count($$SELECT 1 FROM public.user_reports WHERE team_post_id IS NOT NULL$$), 0, 'the author cannot read reports about their post');
SELECT t.as_user(t.id('rep2'));
SELECT t.eq(t.count($$SELECT 1 FROM public.user_reports WHERE team_post_id IS NOT NULL$$), 0, 'nor can another person');
SELECT t.as_user(t.id('rep1'));
SELECT t.eq(t.count($$SELECT 1 FROM public.user_reports WHERE team_post_id IS NOT NULL$$), 1, 'a reporter reads their own');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.count($$SELECT 1 FROM public.user_reports WHERE team_post_id IS NOT NULL$$), 2, 'moderators read all');
SELECT t.reset();

-- ---- escalation and the automatic hold
SELECT t.eq(t.pstatus('001'), 'approved', 'two reports of an adult''s post do not hold it');
SELECT t.as_user(t.id('rep3'));
SELECT t.lives($q$SELECT t.rep('rep3', '001', 'inappropriate')$q$, 'a third distinct reporter');
SELECT t.reset();
SELECT t.eq(t.pstatus('001'), 'held', 'holds an adult''s post');
SELECT t.eq((SELECT count(*)::int FROM public.content_report_holds WHERE content_id = '00000000-0000-0000-0000-00000000f001' AND released_at IS NULL), 1, 'with one open ledger entry');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('author') AND title = 'Your post is under review'), 1, 'the author is told');
SELECT t.ok((SELECT body !~* '(rep[1-4]|stranger|blocked)' AND body NOT LIKE '%' || t.id('rep1')::text || '%' AND body NOT LIKE '%' || t.id('rep2')::text || '%' FROM public.notifications WHERE user_id = t.id('author') AND title = 'Your post is under review'), 'without saying who reported');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count($$SELECT 1 FROM public.team_posts WHERE id = '00000000-0000-0000-0000-00000000f001'$$), 0, 'a held post is hidden from other people');
SELECT t.as_user(t.id('author'));
SELECT t.eq(t.count($$SELECT 1 FROM public.team_posts WHERE id = '00000000-0000-0000-0000-00000000f001'$$), 1, 'but stays visible to its author');
SELECT t.as_user(t.id('mgr'));
SELECT t.eq(t.count($$SELECT 1 FROM public.team_posts WHERE id = '00000000-0000-0000-0000-00000000f001'$$), 1, 'and to the team''s manager');
SELECT t.reset();

SELECT t.as_user(t.id('rep1'));
SELECT t.lives($q$SELECT t.rep('rep1', '002', 'inappropriate')$q$, 'a teen author''s post: first report');
SELECT t.reset();
SELECT t.eq(t.pstatus('002'), 'approved', 'one report does not hold it');
SELECT t.as_user(t.id('rep2'));
SELECT t.lives($q$SELECT t.rep('rep2', '002', 'inappropriate')$q$, 'second reporter');
SELECT t.reset();
SELECT t.eq(t.pstatus('002'), 'held', 'two reporters hold a post by someone under 18');
SELECT t.as_user(t.id('rep4'));
SELECT t.lives($q$SELECT t.rep('rep4', '004', 'minor_safety')$q$, 'a child-safety report');
SELECT t.reset();
SELECT t.eq(t.pstatus('004'), 'held', 'holds the post on the first report');
SELECT t.eq((SELECT status FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-00000000f004'), 'escalated', 'and is escalated');

-- ---- comments
SELECT t.as_user(t.id('rep1'));
SELECT t.lives($q$SELECT t.repc('rep1', 'harassment')$q$, 'a comment can be reported');
SELECT t.as_user(t.id('rep2'));
SELECT t.lives($q$SELECT t.repc('rep2', 'harassment')$q$, 'by a second person');
SELECT t.as_user(t.id('rep3'));
SELECT t.lives($q$SELECT t.repc('rep3', 'harassment')$q$, 'and a third');
SELECT t.reset();
SELECT t.eq((SELECT moderation_status FROM public.post_comments WHERE id = '00000000-0000-0000-0000-00000000c001'), 'held', 'three reporters hold the comment');

-- ---- moderator decisions
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT public.moderator_decide_content_report((SELECT id FROM public.user_reports LIMIT 1), 'dismiss')$q$, 'Moderators only', 'a non-moderator cannot decide');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.throws(format($q$SELECT public.moderator_decide_content_report(%L, 'dismiss')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep1') AND team_post_id = '00000000-0000-0000-0000-00000000f001')), 'Moderators only', 'a member is refused');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.moderator_decide_content_report(%L, 'hide', 'confirmed')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep1') AND team_post_id = '00000000-0000-0000-0000-00000000f001')), 'a moderator can uphold');
SELECT t.reset();
SELECT t.ok((SELECT moderator_hidden_at IS NOT NULL AND hidden_at IS NOT NULL FROM public.team_posts WHERE id = '00000000-0000-0000-0000-00000000f001'), 'the post is hidden');
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-00000000f001' AND status = 'actioned'), 3, 'every open report about it is closed as actioned');
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'content_report_hide' AND actor_id = t.id('modone')), 1, 'the decision is audited with the moderator');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.moderator_decide_content_report(%L, 'remove_media')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep1') AND team_post_id = '00000000-0000-0000-0000-00000000f001')), 'a moderator can remove the attached image');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.image_moderation WHERE bucket = 'team-covers' AND path = t.id('author') || '/pic.jpg'), 'quarantined', 'the image is quarantined so it is hidden app-wide');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.moderator_decide_content_report(%L, 'remove_media')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep1') AND comment_id IS NOT NULL)), 'Only a team post has media', 'a comment has no media to remove');
SELECT t.throws(format($q$SELECT public.moderator_decide_content_report(%L, 'delete')$q$, (SELECT id FROM public.user_reports LIMIT 1)), 'Unknown decision', 'unknown decisions are refused');

-- ---- appeals
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-00000000f001', 'please')$q$, 'CONTENT_NOT_FOUND', 'a stranger cannot appeal someone else''s decision');
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-00000000f001', 'It was a normal practice notice')$q$, 'the author can ask for a review');
SELECT t.throws($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-00000000f001', 'again')$q$, 'duplicate key', 'one open appeal at a time');
SELECT t.eq(t.count($$SELECT 1 FROM public.moderation_appeals$$), 1, 'the author reads their own appeal');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-00000000f002', 'My child''s post is fine')$q$, 'a verified guardian can appeal for a minor author');
SELECT t.eq(t.count($$SELECT 1 FROM public.moderation_appeals$$), 1, 'and reads only that appeal');
SELECT t.as_user(t.id('member'));
SELECT t.throws($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-00000000f003', 'x')$q$, 'CONTENT_NOT_FOUND', 'content that is held for another reason has nothing to appeal');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.moderator_review_appeal(%L, true)$q$, (SELECT id FROM public.moderation_appeals WHERE content_id = '00000000-0000-0000-0000-00000000f001')), 'different moderator', 'the moderator who made the decision cannot review its appeal');
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives(format($q$SELECT public.moderator_review_appeal(%L, true, 'restored')$q$, (SELECT id FROM public.moderation_appeals WHERE content_id = '00000000-0000-0000-0000-00000000f001')), 'a different moderator can reverse it');
SELECT t.reset();
SELECT t.eq(t.pstatus('001'), 'approved', 'the post is restored to its earlier status');
SELECT t.ok((SELECT hidden_at IS NULL FROM public.team_posts WHERE id = '00000000-0000-0000-0000-00000000f001'), 'and visible again');
SELECT t.eq((SELECT status FROM public.moderation_appeals WHERE content_id = '00000000-0000-0000-0000-00000000f001'), 'reversed', 'the appeal is closed as reversed');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('author') AND title = 'Your review request was answered'), 1, 'the author is told');
SELECT t.as_user(t.id('adminone'));
SELECT t.lives(format($q$SELECT public.moderator_review_appeal(%L, false, 'kept')$q$, (SELECT id FROM public.moderation_appeals WHERE content_id = '00000000-0000-0000-0000-00000000f002')), 'an administrator can review any appeal');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.moderation_appeals WHERE content_id = '00000000-0000-0000-0000-00000000f002'), 'upheld', 'an upheld decision stays');

-- ---- dismissing a lone report releases an automatic hold (no permanent hold from brigading)
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.moderator_decide_content_report(%L, 'restore', 'fine')$q$, (SELECT id FROM public.user_reports WHERE comment_id IS NOT NULL LIMIT 1)), 'a moderator can restore a held comment');
SELECT t.reset();
SELECT t.eq((SELECT moderation_status FROM public.post_comments WHERE id = '00000000-0000-0000-0000-00000000c001'), 'approved', 'the comment is back');

-- ---- escalations are never silently discarded
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.moderator_decide_content_report(%L, 'dismiss', 'looks fine to me, no problem here')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep4') AND team_post_id = '00000000-0000-0000-0000-00000000f004')), 'ESCALATION_ADMIN_REQUIRED', 'a moderator cannot dismiss an escalated child-safety report');
SELECT t.as_user(t.id('adminone'));
SELECT t.throws(format($q$SELECT public.moderator_decide_content_report(%L, 'dismiss', 'ok')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep4') AND team_post_id = '00000000-0000-0000-0000-00000000f004')), 'ESCALATION_NOTE_REQUIRED', 'an administrator needs a written note');
SELECT t.lives(format($q$SELECT public.moderator_decide_content_report(%L, 'dismiss', 'Reviewed the post and its context; nothing unsafe.')$q$, (SELECT id FROM public.user_reports WHERE reporter_id = t.id('rep4') AND team_post_id = '00000000-0000-0000-0000-00000000f004')), 'an administrator with a note can close it');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'escalated_report_closed' AND actor_id = t.id('adminone')), 1, 'and the closure is audited');
-- the existing Moderation tab writes with the service role (no auth.uid()) and sets reviewed_by
INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, status) VALUES (t.id('rep1'), t.id('author'), 'user', 'minor_safety', 'escalated');
SELECT t.throws(format($q$UPDATE public.user_reports SET status = 'dismissed', reviewed_by = %L, resolution_notes = 'long enough note here' WHERE reporter_id = t.id('rep1') AND subject_type = 'user'$q$, t.id('modone')), 'ESCALATION_ADMIN_REQUIRED', 'the service-role path is covered too (moderator as reviewer)');
SELECT t.throws($q$UPDATE public.user_reports SET status = 'dismissed' WHERE reporter_id = t.id('rep1') AND subject_type = 'user'$q$, 'ESCALATION_ADMIN_REQUIRED', 'and an update with no reviewer at all');
SELECT t.lives(format($q$UPDATE public.user_reports SET status = 'actioned', reviewed_by = %L WHERE reporter_id = t.id('rep1') AND subject_type = 'user'$q$, t.id('modone')), 'a moderator can still take protective action on it');

-- ---- guardian entry point for appeals
SELECT t.as_user(t.id('guardian'));
SELECT t.eq((SELECT count(*)::int FROM public.guardian_content_holds() WHERE child_user_id = t.id('teenauthor')), 1, 'the guardian of a minor author sees the held post (held since two people reported it)');
SELECT t.ok((SELECT has_open_appeal IS FALSE FROM public.guardian_content_holds() LIMIT 1), 'and whether an appeal is already open');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.guardian_content_holds()), 0, 'a stranger sees nothing');
SELECT t.as_anon();
SELECT t.throws($q$SELECT * FROM public.guardian_content_holds()$q$, 'permission denied', 'anonymous cannot call it');
SELECT t.reset();

-- ---- the author's own entry point
SELECT t.as_user(t.id('teenauthor'));
SELECT t.eq((SELECT count(*)::int FROM public.my_content_holds()), 1, 'an author sees their own held post');
SELECT t.as_user(t.id('author'));
SELECT t.eq((SELECT count(*)::int FROM public.my_content_holds() WHERE content_id = '00000000-0000-0000-0000-00000000f002'), 0, 'and not anyone else''s');
SELECT t.as_anon();
SELECT t.throws($q$SELECT * FROM public.my_content_holds()$q$, 'permission denied', 'anonymous cannot call it');
SELECT t.reset();

-- ---- rate limit
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, moderation_status)
  SELECT ('00000000-0000-0000-0000-0000000a' || lpad(g::text, 4, '0'))::uuid, 'squad', t.id('author'), 'announcement', 'bulk', 'approved' FROM generate_series(1, 21) g;
SELECT t.as_user(t.id('stranger'));
DO $$ BEGIN
  FOR i IN 1..20 LOOP
    INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id)
    VALUES (t.id('stranger'), t.id('stranger'), 'team_post', 'spam', ('00000000-0000-0000-0000-0000000a' || lpad(i::text, 4, '0'))::uuid);
  END LOOP;
END $$;
SELECT t.throws($q$INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id) VALUES (t.id('stranger'), t.id('stranger'), 'team_post', 'spam', '00000000-0000-0000-0000-0000000a0021')$q$, 'REPORT_RATE_LIMIT', 'the 21st report in a day is refused');
SELECT t.reset();

-- ---- retention
SELECT t.throws($q$SELECT private_sec.purge_closed_content_reports(interval '1 month')$q$, 'shorter than 12 months', 'retention cannot be shortened below a year');
UPDATE public.user_reports SET reviewed_at = now() - interval '30 months' WHERE status IN ('actioned', 'resolved') AND team_post_id = '00000000-0000-0000-0000-00000000f001';
INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id, status, reviewed_at) VALUES (t.id('rep3'), t.id('author'), 'team_post', 'minor_safety', '00000000-0000-0000-0000-00000000f004', 'escalated', now() - interval '30 months');
SELECT t.ok(private_sec.purge_closed_content_reports() >= 3, 'closed reports older than 24 months are purged');
SELECT t.eq((SELECT count(*)::int FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-00000000f004' AND status = 'escalated'), 1, 'an escalated report is never purged');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.purge_closed_content_reports(interval)', 'EXECUTE'), false, 'clients cannot run the purge');
SELECT t.eq(has_function_privilege('authenticated', 'public.handle_content_report()', 'EXECUTE'), false, 'nor the hold trigger');
SELECT t.eq(has_table_privilege('authenticated', 'public.content_report_holds', 'INSERT'), false, 'the ledger cannot be written by clients');
SELECT t.eq(has_table_privilege('authenticated', 'public.moderation_appeals', 'INSERT'), false, 'appeals are created only through the function');
ROLLBACK;
