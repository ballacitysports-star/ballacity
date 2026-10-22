-- A team post cannot be a pickup game: those are hosted as games and listed in the feed.
BEGIN;

SELECT t.person('coach', 35), t.person('member', 27);
SELECT t.team('pickup-squad', 'coach');
SELECT t.member('pickup-squad', 'member');

SELECT t.as_user(t.id('member'));
SELECT t.throws(
  format('INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body) VALUES (%L, ''pickup-squad'', %L, ''pickup'', ''Sunday run'', ''Come play'')',
    t.id('p-pickup'), t.id('member')),
  'team_posts_no_pickup', 'a member cannot post a pickup');
SELECT t.lives(
  format('INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body) VALUES (%L, ''pickup-squad'', %L, ''tryout'', ''Open tryouts'', ''Bring shoes'')',
    t.id('p-tryout'), t.id('member')),
  'but a tryout is fine');
SELECT t.lives(
  format('INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body) VALUES (%L, ''pickup-squad'', %L, ''recap'', ''Win'', ''We won'')',
    t.id('p-recap'), t.id('member')),
  'and so is a recap');
SELECT t.throws(
  format('UPDATE public.team_posts SET kind = ''pickup'' WHERE id = %L', t.id('p-recap')),
  'team_posts_no_pickup', 'an existing post cannot be turned into a pickup');
SELECT t.reset();

-- The service role is held to it too.
SELECT t.throws(
  format('INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body) VALUES (%L, ''pickup-squad'', %L, ''pickup'', ''x'', ''y'')',
    t.id('p-pickup2'), t.id('member')),
  'team_posts_no_pickup', 'server code cannot post one either');

ROLLBACK;
