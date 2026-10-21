-- Team posts and comments are screened before anyone else sees them, and a
-- moderator's Hide holds. The author cannot set their own screening result or
-- undo a hide through the API; only server code (the service role) can.
BEGIN;

SELECT t.person('coachone', 35), t.person('authorone', 27), t.person('memberone', 26), t.person('stranger', 28);
SELECT t.team('squad', 'coachone');
SELECT t.member('squad', 'authorone'), t.member('squad', 'memberone');

-- ---- team posts -------------------------------------------------------------
SELECT t.as_user(t.id('authorone'));
SELECT t.lives(format('INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status) VALUES (%L, ''squad'', %L, ''recap'', ''Win'', ''We won'', ''approved'')',
  t.id('post-1'), t.id('authorone')), 'a member can write a post');
SELECT t.reset();
SELECT t.eq((SELECT moderation_status FROM public.team_posts WHERE id = t.id('post-1')), 'pending',
  'whatever status they send, a new post starts as pending');

SELECT t.as_user(t.id('authorone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 1, 'the author sees their pending post');
SELECT t.as_user(t.id('coachone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 1, 'a team manager sees a pending post');
SELECT t.as_user(t.id('memberone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 0, 'another member does not see it yet');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 0, 'a visitor does not see it yet');
SELECT t.reset();

-- The screening service approves it.
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = t.id('post-1');
SELECT t.as_user(t.id('memberone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 1, 'once approved, other members see it');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 1, 'and so does a visitor');

-- Editing the text sends it back for screening.
SELECT t.as_user(t.id('authorone'));
SELECT t.changed(format('UPDATE public.team_posts SET body = ''We won big'' WHERE id = %L', t.id('post-1')));
SELECT t.reset();
SELECT t.eq((SELECT moderation_status FROM public.team_posts WHERE id = t.id('post-1')), 'pending',
  'editing the text puts an approved post back to pending');
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = t.id('post-1');

-- A moderator hides it.
UPDATE public.team_posts SET hidden_at = now() WHERE id = t.id('post-1');
SELECT t.as_user(t.id('memberone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 0, 'a hidden post is gone for other members');
SELECT t.as_user(t.id('authorone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 1, 'but the author can still see it');
SELECT t.as_user(t.id('coachone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 1, 'and so can a team manager');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.team_posts WHERE id = %L', t.id('post-1'))), 0, 'a visitor sees nothing');

SELECT t.as_user(t.id('authorone'));
SELECT t.changed(format('UPDATE public.team_posts SET hidden_at = NULL, moderation_status = ''approved'' WHERE id = %L', t.id('post-1')));
SELECT t.reset();
SELECT t.ok((SELECT hidden_at IS NOT NULL FROM public.team_posts WHERE id = t.id('post-1')), 'the author cannot undo a hide');
SELECT t.as_user(t.id('coachone'));
SELECT t.changed(format('UPDATE public.team_posts SET hidden_at = NULL WHERE id = %L', t.id('post-1')));
SELECT t.reset();
SELECT t.ok((SELECT hidden_at IS NOT NULL FROM public.team_posts WHERE id = t.id('post-1')), 'and neither can a team manager');

-- ---- comments ---------------------------------------------------------------
UPDATE public.team_posts SET hidden_at = NULL WHERE id = t.id('post-1');
SELECT t.as_user(t.id('memberone'));
SELECT t.lives(format('INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body, moderation_status) VALUES (%L, ''team_post'', %L, %L, ''Nice'', ''approved'')',
  t.id('comment-1'), t.id('post-1')::text, t.id('memberone')), 'a member can comment');
SELECT t.reset();
SELECT t.eq((SELECT moderation_status FROM public.post_comments WHERE id = t.id('comment-1')), 'pending',
  'a new comment starts as pending whatever status was sent');

SELECT t.as_user(t.id('memberone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-1'))), 1, 'the commenter sees their pending comment');
SELECT t.as_user(t.id('authorone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-1'))), 0, 'the post''s author does not see it until it is approved');
SELECT t.reset();

UPDATE public.post_comments SET moderation_status = 'approved' WHERE id = t.id('comment-1');
SELECT t.as_user(t.id('authorone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-1'))), 1, 'once approved, others see it');
SELECT t.reset();

UPDATE public.post_comments SET hidden_at = now() WHERE id = t.id('comment-1');
SELECT t.as_user(t.id('authorone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-1'))), 0, 'a hidden comment is gone for others');
SELECT t.as_user(t.id('memberone'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE id = %L', t.id('comment-1'))), 1, 'the commenter still sees their own');
SELECT t.changed(format('UPDATE public.post_comments SET hidden_at = NULL WHERE id = %L', t.id('comment-1')));
SELECT t.reset();
SELECT t.ok((SELECT hidden_at IS NOT NULL FROM public.post_comments WHERE id = t.id('comment-1')), 'and cannot undo the hide');

ROLLBACK;
