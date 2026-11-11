-- Team announcements notify the team once moderation approves them: every member except
-- the author and anyone with a block either way, once per announcement. Other post kinds,
-- pending and held posts, and people outside the team get nothing.
BEGIN;

SELECT t.person('coach', 40), t.person('member', 30), t.person('member2', 33),
       t.person('blockedmember', 31), t.person('outsider', 29);

SELECT t.as_service();
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES ('ann-team', t.id('coach'), 'team', 'Harbor FC', 'harbor-fc');
INSERT INTO public.team_members (team_id, user_id, role) VALUES
  ('ann-team', t.id('member'), 'player'),
  ('ann-team', t.id('member2'), 'player'),
  ('ann-team', t.id('blockedmember'), 'player')
ON CONFLICT (team_id, user_id) DO NOTHING;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blockedmember'), t.id('coach'));
SELECT t.reset();

CREATE TEMP VIEW ann AS
  SELECT user_id FROM public.notifications WHERE type = 'team_announcement' AND link = '/teams/ann-team';
GRANT SELECT ON ann TO PUBLIC;

-- A manager posts an announcement: it starts pending, so nobody is told yet.
SELECT t.as_user(t.id('coach'));
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'ann-team', t.id('coach'), 'announcement', 'Practice moved', 'Thursday at 6pm, north gym.');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM ann), 0, 'a pending announcement notifies nobody');

-- Moderation approves it (server code runs as the service role).
SELECT t.as_service();
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = '00000000-0000-4000-8000-0000000000a1';
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM ann), 2, 'approval notifies the two members without a block');
SELECT t.eq((SELECT count(*)::int FROM ann WHERE user_id = t.id('member')), 1, 'a member is notified');
SELECT t.eq((SELECT count(*)::int FROM ann WHERE user_id = t.id('coach')), 0, 'the author is not notified');
SELECT t.eq((SELECT count(*)::int FROM ann WHERE user_id = t.id('blockedmember')), 0, 'a member who blocked the author is not notified');
SELECT t.eq((SELECT count(*)::int FROM ann WHERE user_id = t.id('outsider')), 0, 'someone outside the team is not notified');
SELECT t.eq(
  (SELECT title FROM public.notifications WHERE user_id = t.id('member') AND type = 'team_announcement'),
  'Harbor FC: Practice moved', 'the notification names the team and the announcement');

-- The member reads it as their own notification.
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.count($$SELECT 1 FROM public.notifications WHERE type = 'team_announcement'$$), 1, 'the member sees it in their notifications');
SELECT t.reset();

-- Held, then approved again: nobody is told twice.
SELECT t.as_service();
UPDATE public.team_posts SET moderation_status = 'held' WHERE id = '00000000-0000-4000-8000-0000000000a1';
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = '00000000-0000-4000-8000-0000000000a1';
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM ann), 2, 're-approval does not notify again');

-- Other kinds, and a hidden announcement, notify nobody.
SELECT t.as_service();
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status)
VALUES ('00000000-0000-4000-8000-0000000000a2', 'ann-team', t.id('coach'), 'recap', 'We won', 'Great game.', 'approved');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status, hidden_at)
VALUES ('00000000-0000-4000-8000-0000000000a3', 'ann-team', t.id('coach'), 'announcement', 'Hidden one', '', 'approved', now());
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'team_announcement'), 2, 'a recap or a hidden announcement notifies nobody');

-- Approved on insert (server code) notifies too.
SELECT t.as_service();
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status)
VALUES ('00000000-0000-4000-8000-0000000000a4', 'ann-team', t.id('coach'), 'announcement', 'Jerseys are in', '', 'approved');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM ann WHERE user_id = t.id('member2')), 2, 'an announcement approved on insert notifies members');
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('member2') AND title = 'Harbor FC: Jerseys are in'), NULL::text,
  'an empty body is stored as no body');

-- Nobody can call the trigger function.
SELECT t.as_user(t.id('member'));
SELECT t.throws($$SELECT public.notify_team_on_announcement()$$, '', 'the trigger function is not callable');
SELECT t.reset();

ROLLBACK;
