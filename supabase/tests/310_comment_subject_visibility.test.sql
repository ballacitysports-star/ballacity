-- A comment is readable only when the thing it is on is readable by the viewer. The comment
-- read rule used to check the subject's owner's age and nothing else, so a comment on a hidden
-- reel, a reel of a game that is not public, or a private game could be read by anyone who had
-- the subject's id.
BEGIN;

SELECT t.person('host', 40), t.person('reeler', 30), t.person('player', 25), t.person('stranger', 27);

-- A public game, a private game the player joins, and a reel linked to the private game.
-- A game is public to visitors only when its age range is adult-only (min_age 18 or more).
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, is_private, min_age)
VALUES ('open-run', t.id('host'), 'Open run', 'Basketball', now() + interval '3 days', 'Gym', 10, false, 18),
       ('private-run', t.id('host'), 'Private run', 'Basketball', now() + interval '3 days', 'Gym', 10, true, 18);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('open-run', t.id('host'), 0, false), ('private-run', t.id('host'), 0, false);
INSERT INTO public.game_participants (game_id, user_id)
VALUES ('private-run', t.id('player'));

SELECT t.reel('reeler', 'open');
SELECT t.reel('reeler', 'hidden');
SELECT t.reel('reeler', 'linked');
SELECT t.reel('reeler', 'draft');
UPDATE public.highlight_reels SET hidden_at = now() WHERE id = t.id('reel-hidden');
UPDATE public.highlight_reels SET game_id = 'private-run' WHERE id = t.id('reel-linked');
UPDATE public.highlight_reels SET is_draft = true WHERE id = t.id('reel-draft');

-- One comment on each subject, written by the owner or the host (as the service would have).
INSERT INTO public.post_comments (subject_type, subject_id, author_id, body, moderation_status)
VALUES ('highlight_reel', t.id('reel-open')::text,    t.id('stranger'), 'open reel comment', 'approved'),
       ('highlight_reel', t.id('reel-hidden')::text,  t.id('reeler'),   'hidden reel comment', 'approved'),
       ('highlight_reel', t.id('reel-linked')::text,  t.id('reeler'),   'private game reel comment', 'approved'),
       ('highlight_reel', t.id('reel-draft')::text,   t.id('reeler'),   'draft reel comment', 'approved'),
       ('game', 'open-run',    t.id('stranger'), 'open game comment', 'approved'),
       ('game', 'private-run', t.id('host'),     'private game comment', 'approved');

-- A public reel and a public game are still readable by everyone, as before.
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-open')::text)), 1,
  'a visitor reads comments on a public reel');
SELECT t.eq(t.count($q$SELECT 1 FROM public.post_comments WHERE subject_type = 'game' AND subject_id = 'open-run'$q$), 1,
  'a visitor reads comments on a public game');

-- A hidden reel, a draft and a reel linked to a private game keep their comments to their circle.
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-hidden')::text)), 0,
  'a visitor cannot read comments on a hidden reel');
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-draft')::text)), 0,
  'a visitor cannot read comments on a draft reel');
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-linked')::text)), 0,
  'a visitor cannot read comments on a reel linked to a private game');
SELECT t.eq(t.count($q$SELECT 1 FROM public.post_comments WHERE subject_type = 'game' AND subject_id = 'private-run'$q$), 0,
  'a visitor cannot read comments on a private game');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-hidden')::text)), 0,
  'a signed-in stranger cannot read comments on a hidden reel');
SELECT t.eq(t.count($q$SELECT 1 FROM public.post_comments WHERE subject_type = 'game' AND subject_id = 'private-run'$q$), 0,
  'a signed-in stranger cannot read comments on a private game');
SELECT t.throws(
  format($q$INSERT INTO public.post_comments (subject_type, subject_id, author_id, body)
            VALUES ('highlight_reel', %L, %L, 'sneaking in')$q$, t.id('reel-hidden')::text, t.id('stranger')),
  'row-level security',
  'a stranger cannot comment on a hidden reel');
SELECT t.reset();

-- The owner and the people in the circle still see what they could before.
SELECT t.as_user(t.id('reeler'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-hidden')::text)), 1,
  'the reel owner still reads comments on their hidden reel');
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-draft')::text)), 1,
  'the reel owner still reads comments on their draft');
SELECT t.reset();

SELECT t.as_user(t.id('player'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.post_comments WHERE subject_type = 'game' AND subject_id = 'private-run'$q$), 1,
  'a player in a private game still reads its comments');
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('reel-linked')::text)), 1,
  'a player in the linked private game still reads comments on that reel');
SELECT t.reset();

SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.post_comments WHERE subject_type = 'game' AND subject_id = 'private-run'$q$), 1,
  'the host still reads comments on their private game');
SELECT t.reset();

-- Team posts follow the same rule: comments on a hidden post stay with its author and managers.
SELECT t.team('squad', 'host');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, moderation_status, hidden_at)
VALUES (t.id('post-hidden'), 'squad', t.id('host'), 'recap', 'Win', 'We won', 'approved', now()),
       (t.id('post-open'), 'squad', t.id('host'), 'recap', 'Win', 'We won', 'approved', NULL);
INSERT INTO public.post_comments (subject_type, subject_id, author_id, body, moderation_status)
VALUES ('team_post', t.id('post-hidden')::text, t.id('host'), 'hidden post comment', 'approved'),
       ('team_post', t.id('post-open')::text,   t.id('host'), 'open post comment', 'approved');

SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('post-open')::text)), 1,
  'a visitor reads comments on an approved team post');
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('post-hidden')::text)), 0,
  'a visitor cannot read comments on a hidden team post');
SELECT t.reset();

SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.post_comments WHERE subject_id = %L', t.id('post-hidden')::text)), 1,
  'the team post author still reads comments on their hidden post');
SELECT t.reset();

ROLLBACK;
