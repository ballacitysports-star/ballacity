-- A report starts as "new" whatever its author sends. The author cannot file it
-- pre-resolved, name a reviewer, or write the moderators' notes; only a
-- moderator moves it on, and the author cannot touch it afterwards.
BEGIN;

SELECT t.person('reporter', 30), t.person('target', 30), t.person('modone', 35), t.person('other', 28);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'admin');

SELECT t.as_user(t.id('reporter'));
SELECT t.lives(format($q$INSERT INTO public.user_reports (id, reporter_id, reported_id, reason, status)
  VALUES (%L, %L, %L, 'harassment', 'new')$q$, t.id('plain'), t.id('reporter'), t.id('target')),
  'a member files an ordinary report');
SELECT t.lives(format($q$INSERT INTO public.user_reports (id, reporter_id, reported_id, reason, status, reviewed_by, reviewed_at, resolution_notes)
  VALUES (%L, %L, %L, 'spam', 'resolved', %L, now(), 'Reviewed and dismissed')$q$,
  t.id('forged'), t.id('reporter'), t.id('target'), t.id('modone')),
  'a report that tries to arrive pre-resolved is still accepted');
SELECT t.throws(format($q$INSERT INTO public.user_reports (reporter_id, reported_id, reason) VALUES (%L, %L, 'spam')$q$, t.id('other'), t.id('target')),
  'row-level security', 'but nobody files a report in someone else''s name');
SELECT t.reset();

SELECT t.eq((SELECT status FROM public.user_reports WHERE id = t.id('forged')), 'new',
  'the forged status is replaced with new');
SELECT t.ok((SELECT reviewed_by IS NULL AND reviewed_at IS NULL AND resolution_notes IS NULL FROM public.user_reports WHERE id = t.id('forged')),
  'and the reviewer and the moderators'' notes are cleared');

SELECT t.as_user(t.id('reporter'));
SELECT t.eq(t.changed(format($q$UPDATE public.user_reports SET status = 'dismissed' WHERE id = %L$q$, t.id('plain'))), 0,
  'the author cannot change a report afterwards');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.changed(format($q$UPDATE public.user_reports SET status = 'resolved', reviewed_by = %L, reviewed_at = now(), resolution_notes = 'Warned' WHERE id = %L$q$, t.id('modone'), t.id('plain'))), 1,
  'a moderator resolves it');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.user_reports WHERE id = t.id('plain')), 'resolved', 'and the resolution stands');

ROLLBACK;
