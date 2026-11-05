-- Independent pre-review (2026-11-05), audit F13: no party to a moderation decision reviews its appeal, however the
-- report was touched afterwards (20261108190000).
BEGIN;
SELECT t.person('author', 35), t.person('rep1', 30), t.person('modone', 39), t.person('modtwo', 40), t.person('modthree', 41),
       t.person('mgr', 38), t.person('modfour', 42), t.person('modfive', 43);
SELECT t.team('squad', 'mgr');
INSERT INTO public.user_roles (user_id, role) VALUES
  (t.id('modone'), 'moderator'), (t.id('modtwo'), 'moderator'), (t.id('modthree'), 'moderator'),
  (t.id('modfour'), 'moderator'), (t.id('modfive'), 'moderator');
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_members (team_id, user_id) VALUES ('squad', t.id('author'));
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status) VALUES
  ('00000000-0000-0000-0000-0000000cc001', 'squad', t.id('author'), 'announcement', 'Post', 'Practice Saturday', 'approved'),
  ('00000000-0000-0000-0000-0000000cc002', 'squad', t.id('author'), 'announcement', 'Post 2', 'Game day info', 'approved'),
  ('00000000-0000-0000-0000-0000000cc003', 'squad', t.id('author'), 'announcement', 'Post 3', 'Uniform pickup', 'approved');
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id, status)
VALUES (t.id('rep1'), t.id('author'), 'team_post', 'spam', '00000000-0000-0000-0000-0000000cc001', 'new');
CREATE FUNCTION t.s_report() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT id FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-0000000cc001' $f$;
CREATE FUNCTION t.s_appeal(_post text) RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT id FROM public.moderation_appeals WHERE content_id = _post::uuid $f$;
GRANT EXECUTE ON FUNCTION t.s_report() TO authenticated;
GRANT EXECUTE ON FUNCTION t.s_appeal(text) TO authenticated;

-- 1. the decider stays a party after another moderator changes the report's status
SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$SELECT public.moderator_decide_content_report(t.s_report(), 'hide', 'confirmed spam')$q$, 'setup: modone hides the post');
SELECT t.reset();
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-0000000cc001', 'Normal practice notice')$q$,
  'setup: the author appeals');
SELECT t.reset();
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives($q$UPDATE public.user_reports SET status = 'resolved' WHERE id = t.s_report()$q$, 'setup: modtwo marks the report resolved');
SELECT t.reset();
SELECT t.eq((SELECT reviewed_by FROM public.user_reports WHERE id = t.s_report()), t.id('modtwo'), 'setup: the report now names modtwo');
SELECT t.as_user(t.id('modone'));
SELECT t.throws($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc001'), false, 'I stand by it')$q$,
  'different moderator', 'F13: the moderator who decided still cannot review the appeal of their decision');
SELECT t.reset();
SELECT t.as_user(t.id('modtwo'));
SELECT t.throws($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc001'), false, 'keep')$q$,
  'different moderator', 'F13: nor the moderator who changed the report afterwards');
SELECT t.reset();
SELECT t.as_user(t.id('modthree'));
SELECT t.lives($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc001'), true, 'restored')$q$,
  'F13: an uninvolved moderator reviews it');
SELECT t.reset();
SELECT t.eq((SELECT reviewed_by FROM public.moderation_appeals WHERE id = t.s_appeal('00000000-0000-0000-0000-0000000cc001')),
  t.id('modthree'), 'F13: and the appeal records them');

-- 2. a moderator who reported the content (it is held automatically) does not review the appeal against it
SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id)
                 VALUES (auth.uid(), t.id('author'), 'team_post', 'illegal', '00000000-0000-0000-0000-0000000cc002')$q$,
  'setup: modone reports the second post as illegal');
SELECT t.reset();
SELECT t.ok(EXISTS (SELECT 1 FROM public.content_report_holds WHERE content_id = '00000000-0000-0000-0000-0000000cc002' AND released_at IS NULL),
  'setup: the post is held');
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-0000000cc002', 'Just game info')$q$,
  'setup: the author appeals');
SELECT t.reset();
SELECT t.as_user(t.id('modone'));
SELECT t.throws($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc002'), false, 'keep it hidden')$q$,
  'different moderator', 'F13: the reporting moderator cannot review the appeal against what they reported');
SELECT t.reset();
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc002'), true, 'restored')$q$,
  'F13: another moderator can');
SELECT t.reset();

-- 3. independent review of d604958c: an earlier change to a report outlives reviewed_by (direct API edits are audited by
--    #287's guard as 'report_updated_directly'; the app's status screen audits with target type 'report')
INSERT INTO public.user_reports (reporter_id, reported_id, subject_type, reason, team_post_id, status)
VALUES (t.id('rep1'), t.id('author'), 'team_post', 'spam', '00000000-0000-0000-0000-0000000cc003', 'new');
CREATE FUNCTION t.s_report3() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $f$
  SELECT id FROM public.user_reports WHERE team_post_id = '00000000-0000-0000-0000-0000000cc003' $f$;
GRANT EXECUTE ON FUNCTION t.s_report3() TO authenticated;
SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$SELECT public.moderator_decide_content_report(t.s_report3(), 'hide', 'spam')$q$, 'setup: modone hides the third post');
SELECT t.reset();
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$SELECT public.appeal_content_decision('team_post', '00000000-0000-0000-0000-0000000cc003', 'Just uniforms')$q$,
  'setup: the author appeals');
SELECT t.reset();
SELECT t.as_user(t.id('modthree'));
SELECT t.lives($q$UPDATE public.user_reports SET resolution_notes = 'looked at it' WHERE id = t.s_report3()$q$,
  'setup: modthree changes the report directly');
SELECT t.reset();
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives($q$UPDATE public.user_reports SET resolution_notes = 'and again' WHERE id = t.s_report3()$q$,
  'setup: modtwo changes it after them');
SELECT t.reset();
SELECT t.eq((SELECT reviewed_by FROM public.user_reports WHERE id = t.s_report3()), t.id('modtwo'),
  'setup: the report now names only modtwo');
-- the app's status screen (service role) audits with target type 'report'
INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id)
VALUES (t.id('modfour'), 'report.resolved', 'report', t.s_report3()::text);
SELECT t.as_user(t.id('modthree'));
SELECT t.throws($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc003'), true, 'restore')$q$,
  'different moderator', 'F13: a moderator who changed the report earlier stays a party after another one changes it');
SELECT t.reset();
SELECT t.as_user(t.id('modfour'));
SELECT t.throws($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc003'), true, 'restore')$q$,
  'different moderator', 'F13: so does one who changed it through the app');
SELECT t.reset();
SELECT t.as_user(t.id('modfive'));
SELECT t.lives($q$SELECT public.moderator_review_appeal(t.s_appeal('00000000-0000-0000-0000-0000000cc003'), true, 'restored')$q$,
  'F13: an uninvolved moderator reviews it');
SELECT t.reset();
ROLLBACK;
