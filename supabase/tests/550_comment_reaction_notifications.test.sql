-- Comment and reaction notifications, and the reaction rule for minors' content.
--
-- The owner of a team post, game or highlight is told when a comment becomes visible
-- and when someone reacts. Never across a block, never for your own activity, never twice
-- for the same comment, and at most once a day per reactor per item. Reacting to a
-- minor's content follows the comment rule (the minor, their guardian, or a teammate).
BEGIN;

SELECT t.person('host', 35), t.person('stranger', 30), t.person('blockr', 32),
       t.person('teenposter', 16), t.person('mate', 29), t.person('parent', 44);
SELECT t.guardian('parent', 'teenposter');

SELECT t.as_service();
INSERT INTO public.hosted_games (id, host_id, sport, title, date)
VALUES ('ce-game', t.id('host'), 'basketball', 'Sunday run', now() + interval '2 days');
SELECT t.team('ce-team', 'mate');
SELECT t.member('ce-team', 'teenposter');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status)
VALUES (t.id('teen-post'), 'ce-team', t.id('teenposter'), 'recap', 'We won', 'Great game', 'approved');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blockr'), t.id('host'));
SELECT t.reset();

CREATE TEMP VIEW owner_notes AS
  SELECT user_id, type, title, body, link FROM public.notifications WHERE type IN ('comment', 'reaction');
GRANT SELECT ON owner_notes TO PUBLIC;

-- ---------------------------------------------------------------- comments
SELECT t.as_user(t.id('stranger'));
INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body)
VALUES (t.id('c1'), 'game', 'ce-game', t.id('stranger'), 'Count me in next week');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes), 0, 'a pending comment notifies nobody');

SELECT t.as_service();
UPDATE public.post_comments SET moderation_status = 'approved' WHERE id = t.id('c1');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes WHERE user_id = t.id('host') AND type = 'comment'), 1,
  'the host is told when a comment on their game is approved');
SELECT t.eq((SELECT title || ' | ' || body || ' | ' || link FROM owner_notes WHERE user_id = t.id('host') AND type = 'comment'),
  'Stranger commented on your game | Count me in next week | /games/ce-game', 'the notification names who, what and where');

SELECT t.as_service();
UPDATE public.post_comments SET moderation_status = 'held' WHERE id = t.id('c1');
UPDATE public.post_comments SET moderation_status = 'approved' WHERE id = t.id('c1');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes WHERE type = 'comment'), 1, 'held then approved again does not repeat it');

-- Your own comment, a commenter with a block, and a deleted comment notify nobody.
SELECT t.as_service();
INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body, moderation_status) VALUES
  (t.id('c2'), 'game', 'ce-game', t.id('host'), 'See you all there', 'approved'),
  (t.id('c3'), 'game', 'ce-game', t.id('blockr'), 'Hello', 'approved');
INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body, moderation_status, deleted_at)
VALUES (t.id('c4'), 'game', 'ce-game', t.id('stranger'), 'Gone', 'approved', now());
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes WHERE type = 'comment'), 1,
  'own, blocked and deleted comments notify nobody');

-- A teammate's comment on a teen's post reaches the teen, linked to the team.
SELECT t.as_user(t.id('mate'));
INSERT INTO public.post_comments (id, subject_type, subject_id, author_id, body)
VALUES (t.id('c5'), 'team_post', t.id('teen-post')::text, t.id('mate'), 'Well played');
SELECT t.reset();
SELECT t.as_service();
UPDATE public.post_comments SET moderation_status = 'approved' WHERE id = t.id('c5');
SELECT t.reset();
SELECT t.eq((SELECT link FROM owner_notes WHERE user_id = t.id('teenposter') AND type = 'comment'), '/teams/ce-team',
  'a teammate''s comment on a teen''s post notifies the teen');

-- ---------------------------------------------------------------- reactions
SELECT t.as_user(t.id('stranger'));
INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES ('game', 'ce-game', t.id('stranger'), '🔥');
INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES ('game', 'ce-game', t.id('stranger'), '👍');
DELETE FROM public.post_reactions WHERE user_id = t.id('stranger') AND emoji = '🔥';
INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES ('game', 'ce-game', t.id('stranger'), '🔥');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes WHERE user_id = t.id('host') AND type = 'reaction'), 1,
  'several reactions from one person in a day notify the host once');
SELECT t.eq((SELECT title FROM owner_notes WHERE user_id = t.id('host') AND type = 'reaction'), 'Stranger reacted to your game 🔥',
  'the reaction notification says who and which emoji');

-- Reactions on a minor's content follow the comment rule.
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES (''team_post'', %L, %L, ''❤️'')',
  t.id('teen-post'), t.id('stranger')), 'row-level security', 'a stranger cannot react to a teen''s post');
SELECT t.as_user(t.id('mate'));
SELECT t.lives(format('INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES (''team_post'', %L, %L, ''❤️'')',
  t.id('teen-post'), t.id('mate')), 'a teammate can react to a teen''s post');
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format('INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES (''team_post'', %L, %L, ''👏'')',
  t.id('teen-post'), t.id('parent')), 'a guardian can react to their child''s post');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes WHERE user_id = t.id('teenposter') AND type = 'reaction'), 2,
  'the teen is told about the teammate''s and the guardian''s reactions');

-- A game hosted by a teen follows the same rule (its owner used to be invisible).
SELECT t.as_service();
INSERT INTO public.hosted_games (id, host_id, sport, title, date)
VALUES ('teen-game', t.id('teenposter'), 'basketball', 'Teen run', now() + interval '3 days');
SELECT t.reset();
SELECT t.eq(private_sec.comment_subject_owner('game', 'teen-game'), t.id('teenposter'), 'a game''s owner is found by its text id');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('INSERT INTO public.post_comments (subject_type, subject_id, author_id, body) VALUES (''game'', ''teen-game'', %L, ''hi'')',
  t.id('stranger')), 'row-level security', 'a stranger cannot comment on a teen''s game');
SELECT t.throws(format('INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES (''game'', ''teen-game'', %L, ''👍'')',
  t.id('stranger')), 'row-level security', 'or react to it');
SELECT t.reset();

-- An adult's content stays open to reactions from anyone signed in.
SELECT t.as_user(t.id('mate'));
SELECT t.lives($$INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES ('game', 'ce-game', auth.uid(), '👍')$$,
  'anyone signed in can still react to an adult''s game');
SELECT t.reset();

-- A block stops reaction notifications too.
SELECT t.as_service();
INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji) VALUES ('game', 'ce-game', t.id('blockr'), '👍');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM owner_notes WHERE user_id = t.id('host') AND type = 'reaction' AND title LIKE 'Blockr%'), 0,
  'a reaction across a block notifies nobody');

-- The functions are not callable.
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($$SELECT public.notify_on_post_comment()$$, '', 'the comment trigger function is not callable');
SELECT t.throws($$SELECT private_sec.may_notify_engagement(auth.uid(), auth.uid())$$, '', 'the helper is not callable');
SELECT t.reset();

ROLLBACK;
