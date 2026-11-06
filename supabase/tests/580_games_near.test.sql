-- games_near: server-side, paged, distance-filtered game discovery that keeps the
-- hosted_games visibility rules (it runs as the caller).
BEGIN;

SELECT t.person('host', 35), t.person('player', 30);

SELECT t.as_service();
-- Downtown reference point: 40.0, -75.0. About 0.7 mi, 6.9 mi and 69 mi away, plus no location.
INSERT INTO public.hosted_games (id, host_id, sport, title, date, lat, lng, min_age) VALUES
  ('gn-close',  t.id('host'), 'basketball', 'Close',  now() + interval '3 days', 40.01, -75.0, 18),
  ('gn-mid',    t.id('host'), 'soccer',     'Mid',    now() + interval '1 day',  40.10, -75.0, 18),
  ('gn-far',    t.id('host'), 'basketball', 'Far',    now() + interval '2 days', 41.00, -75.0, 18),
  ('gn-noloc',  t.id('host'), 'basketball', 'No loc', now() + interval '4 days', NULL,  NULL,  18),
  ('gn-past',   t.id('host'), 'basketball', 'Past',   now() - interval '1 day',  40.01, -75.0, 18),
  ('gn-youth',  t.id('host'), 'basketball', 'Youth',  now() + interval '5 days', 40.02, -75.0, NULL);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, lat, lng, min_age, is_private) VALUES
  ('gn-private', t.id('host'), 'basketball', 'Private', now() + interval '1 day', 40.01, -75.0, 18, true);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, lat, lng, min_age, hidden_at) VALUES
  ('gn-hidden',  t.id('host'), 'basketball', 'Hidden', now() + interval '1 day', 40.01, -75.0, 18, now());
INSERT INTO public.hosted_games (id, host_id, sport, title, date, lat, lng, min_age, cancelled_at) VALUES
  ('gn-cancel',  t.id('host'), 'basketball', 'Cancelled', now() + interval '1 day', 40.01, -75.0, 18, now());
SELECT t.reset();

CREATE FUNCTION pg_temp.ids(_q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT string_agg(id, '','' ORDER BY ord) FROM (SELECT id, row_number() OVER () AS ord FROM (%s) q) x', _q) INTO r;
  RETURN coalesce(r, '');
END $$;

SELECT t.as_user(t.id('player'));
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near(40.0, -75.0, 10)$$), 'gn-mid,gn-close,gn-youth',
  'within 10 miles, soonest first: no far, past, private, hidden, cancelled or unlocated games');
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near(40.0, -75.0, 10, NULL, now(), 'nearest')$$), 'gn-close,gn-youth,gn-mid',
  'nearest first orders by distance');
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near(40.0, -75.0, 100, ARRAY['soccer'])$$), 'gn-mid', 'sport filter');
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near(40.0, -75.0, 100)$$), 'gn-mid,gn-far,gn-close,gn-youth',
  'a wider radius reaches the far game');
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near()$$), 'gn-mid,gn-far,gn-close,gn-noloc,gn-youth',
  'without a location: every upcoming listable game, unlocated ones included');
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near(40.0, -75.0, 100, NULL, now(), 'soonest', 2, 2)$$), 'gn-close,gn-youth',
  'limit and offset page the results');
SELECT t.eq((SELECT round(distance_mi::numeric, 1) FROM public.games_near(40.0, -75.0, 10) WHERE id = 'gn-close'), 0.7,
  'distance is in miles');

-- A signed-out visitor keeps the table's rule: adult-only games only.
SELECT t.as_anon();
SELECT t.eq(pg_temp.ids($$SELECT id FROM public.games_near(40.0, -75.0, 10)$$), 'gn-mid,gn-close',
  'a signed-out visitor does not see the youth game');
SELECT t.reset();

-- The host still sees their own hidden or private game on its page, but discovery lists neither.
SELECT t.as_user(t.id('host'));
SELECT t.eq((SELECT count(*)::int FROM public.games_near(40.0, -75.0, 10) WHERE id IN ('gn-private', 'gn-hidden')), 0,
  'discovery never lists private or hidden games, even to their host');
SELECT t.reset();

ROLLBACK;
