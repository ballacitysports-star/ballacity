-- Audit F13 (appeal separation): the moderator who decided a report must not be able to rewrite who decided it, and so
-- review the appeal of their own decision. Appeal separation (moderator_review_appeal, 20261106130000) trusts
-- user_reports.reviewed_by; before 20261031120000 a moderator could set it to anyone with a direct UPDATE.
BEGIN;
SELECT t.person('author', 35), t.person('rep1', 30), t.person('modone', 39), t.person('modtwo', 40), t.person('mgr', 38);
SELECT t.team('squad', 'mgr');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('modtwo'), 'moderator');
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_members (team_id, user_id) VALUES ('squad', t.id('author'));
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status) VALUES
  ('00000000-0000-0000-0000-0000000aa001', 'squad', t.id('author'), 'announcement', 'Post', 'Practice Saturday', 'approved');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id, status)
VALUES (t.id('rep1'), t.id('author'), 'team_post', 'spam', '00000000-0000-0000-0000-0000000aa001', 'new');
CREATE FUNCTION t.report_id() RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-0000000aa001' $f$;
GRANT EXECUTE ON FUNCTION t.report_id() TO authenticated;
CREATE FUNCTION t.reviewer() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT reviewed_by FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-0000000aa001' $f$;
CREATE FUNCTION t.appeal_id() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT id FROM public.moderation_appeals WHERE content_id = '00000000-0000-0000-0000-0000000aa001' $f$;
GRANT EXECUTE ON FUNCTION t.reviewer() TO authenticated;
GRANT EXECUTE ON FUNCTION t.appeal_id() TO authenticated;

-- modone decides, the author appeals
SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$SELECT public.moderator_decide_content_report(t.report_id(), 'hide', 'confirmed')$q$, 'modone hides the post');
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-0000000aa001', 'It was a normal practice notice')$q$,
  'the author appeals');
SELECT t.reset();
SELECT t.eq(t.reviewer(), t.id('modone'), 'the report records modone as the reviewer');

-- modone tries to launder the decision onto someone else, alone
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$UPDATE public.user_reports SET reviewed_by = %L WHERE id = t.report_id()$q$, t.id('modtwo')),
  'a direct UPDATE naming another reviewer runs');
SELECT t.eq(t.reviewer(), t.id('modone'), 'F13: ... but the reviewer stays the moderator who made the change (no impersonation)');
SELECT t.lives($q$UPDATE public.user_reports SET reviewed_by = NULL WHERE id = t.report_id()$q$, 'clearing the reviewer runs');
SELECT t.eq(t.reviewer(), t.id('modone'), 'F13: ... and the reviewer is still modone');
SELECT t.lives(format($q$UPDATE public.user_reports SET status = 'resolved', reviewed_by = %L WHERE id = t.report_id()$q$, t.id('modtwo')),
  'changing the status while naming another reviewer runs');
SELECT t.eq(t.reviewer(), t.id('modone'), 'F13: ... and still records modone');
SELECT t.throws(format($q$UPDATE public.user_reports SET reported_id = %L WHERE id = t.report_id()$q$, t.id('rep1')),
  'REPORT_FIELDS_FIXED', 'F13: the reported person cannot be changed');
SELECT t.throws(format($q$UPDATE public.user_reports SET reporter_id = %L WHERE id = t.report_id()$q$, t.id('modtwo')),
  'REPORT_FIELDS_FIXED', 'F13: nor the reporter');
SELECT t.throws($q$UPDATE public.user_reports SET reason = 'harassment' WHERE id = t.report_id()$q$,
  'REPORT_FIELDS_FIXED', 'F13: nor the reported reason (evidence)');
-- the appeal itself is written only through the RPCs
SELECT t.eq(t.changed(format($q$UPDATE public.moderation_appeals SET reviewed_by = %L, status = 'reversed' WHERE id = t.appeal_id()$q$, t.id('modtwo'))), 0,
  'F13: a moderator cannot decide an appeal by writing it directly');
SELECT t.throws(format($q$INSERT INTO public.moderation_appeals (content_type, content_id, appellant_id, note, status, reviewed_by)
                          VALUES ('team_post', '00000000-0000-0000-0000-0000000aa001', %L, 'x', 'upheld', %L)$q$, t.id('author'), t.id('modtwo')),
  'permission denied', 'nor insert a decided appeal');
-- appeal separation still holds
SELECT t.throws($q$SELECT public.moderator_review_appeal(t.appeal_id(), false, 'keep')$q$, 'different moderator',
  'F13: modone still cannot review the appeal of their own decision');
SELECT t.reset();
SELECT t.ok((SELECT count(*) >= 3 FROM public.admin_audit_log WHERE actor_id = t.id('modone') AND action = 'report_updated_directly'
               AND target_id = t.report_id()::text), 'F13: every direct change is audited under the moderator who made it');
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives($q$SELECT public.moderator_review_appeal(t.appeal_id(), true, 'restored')$q$, 'a different moderator reviews it');
SELECT t.reset();
SELECT t.eq((SELECT reviewed_by FROM public.moderation_appeals WHERE id = t.appeal_id()), t.id('modtwo'), 'the appeal records modtwo');
ROLLBACK;
