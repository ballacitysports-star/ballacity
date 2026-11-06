-- D0: a youth team's event venue is readable only by its members, their guardians,
-- registrants and their guardians, and admins. Other teams' venues stay public.
BEGIN;

SELECT t.person('coachyouth', 35), t.person('kidmember', 11), t.person('kidparent', 40),
       t.person('stranger', 30), t.person('registrant', 15), t.person('regparent', 45),
       t.person('coachadult', 33), t.person('adultmember', 28), t.person('newcoach', 38),
       t.person('staffadmin', 50);
SELECT t.guardian('kidparent', 'kidmember');
SELECT t.guardian('regparent', 'registrant');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('staffadmin'), 'admin');

-- A youth team (a child on the roster), an adult team, and a new team with no members
-- yet but listed for youth.
SELECT t.team('ufalcons', 'coachyouth');
SELECT t.member('ufalcons', 'kidmember', 'player');
SELECT t.team('rec', 'coachadult');
SELECT t.member('rec', 'adultmember', 'player');
SELECT t.team('fresh', 'newcoach');
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'fresh';

CREATE FUNCTION pg_temp.post(_team text, _author text, _title text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _id uuid;
BEGIN
  INSERT INTO public.team_posts (team_id, author_id, kind, title, event_date, location,
                                 formatted_address, place_id, lat, lng, moderation_status)
  VALUES (_team, t.id(_author), 'tryout', _title, now() + interval '5 days', 'Field 4',
          '1 Main St', 'place-1', 40.712345, -74.006789, 'approved')
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE TEMP TABLE ids AS
SELECT pg_temp.post('ufalcons', 'coachyouth', 'U12 tryout') AS youth,
       pg_temp.post('rec', 'coachadult', 'Rec league tryout') AS adult,
       pg_temp.post('fresh', 'newcoach', 'New youth team tryout') AS fresh;
GRANT SELECT ON ids TO anon, authenticated;

-- A 15-year-old registered by their parent for the youth tryout.
INSERT INTO public.tryout_rsvps (post_id, team_id, user_id, registered_by, status)
SELECT youth, 'ufalcons', t.id('registrant'), t.id('regparent'), 'registered' FROM ids;

CREATE FUNCTION pg_temp.sees(_which text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE _n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM public.team_post_venues(ARRAY[(SELECT %I FROM ids)]) WHERE location = %L AND lat IS NOT NULL',
                 _which, 'Field 4') INTO _n;
  RETURN _n;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.sees(text) TO anon, authenticated;

-- Column privileges: no client reads the venue straight from the table.
SELECT t.as_anon();
SELECT t.throws('SELECT location FROM public.team_posts', 'permission denied', 'a signed-out visitor cannot select location');
SELECT t.throws('SELECT lat, lng FROM public.team_posts', 'permission denied', 'or coordinates');
SELECT t.throws('SELECT * FROM public.team_posts', 'permission denied', 'or select every column');
SELECT t.eq(t.count('SELECT id, title, event_date, price, spots_max FROM public.team_posts'), 3,
  'but still sees all three posts and their details');
SELECT t.eq(pg_temp.sees('youth'), 0, 'signed out: no venue for the youth team''s tryout');
SELECT t.eq(pg_temp.sees('fresh'), 0, 'signed out: no venue for a team listed for youth');
SELECT t.eq(pg_temp.sees('adult'), 1, 'signed out: the adult team''s venue stays public');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.throws('SELECT formatted_address FROM public.team_posts', 'permission denied', 'a signed-in stranger cannot select the address');
SELECT t.eq(pg_temp.sees('youth'), 0, 'a signed-in stranger gets no youth venue');
SELECT t.eq(pg_temp.sees('adult'), 1, 'but does get the adult team''s venue');
SELECT t.reset();

-- Allowed readers of the youth venue.
SELECT t.as_user(t.id('coachyouth'));
SELECT t.eq(pg_temp.sees('youth'), 1, 'the team''s coach sees it');
SELECT t.reset();
SELECT t.as_user(t.id('kidmember'));
SELECT t.eq(pg_temp.sees('youth'), 1, 'a team member sees it');
SELECT t.reset();
SELECT t.as_user(t.id('kidparent'));
SELECT t.eq(pg_temp.sees('youth'), 1, 'a member''s guardian sees it');
SELECT t.reset();
SELECT t.as_user(t.id('registrant'));
SELECT t.eq(pg_temp.sees('youth'), 1, 'a registrant sees it');
SELECT t.reset();
SELECT t.as_user(t.id('regparent'));
SELECT t.eq(pg_temp.sees('youth'), 1, 'the guardian who registered them sees it');
SELECT t.reset();
SELECT t.as_user(t.id('staffadmin'));
SELECT t.eq(pg_temp.sees('youth'), 1, 'an admin sees it');
SELECT t.reset();
SELECT t.as_user(t.id('newcoach'));
SELECT t.eq(pg_temp.sees('fresh'), 1, 'the new youth team''s own coach sees its venue');
SELECT t.reset();

-- A cancelled registration no longer unlocks it.
UPDATE public.tryout_rsvps SET status = 'cancelled' WHERE user_id = t.id('registrant');
SELECT t.as_user(t.id('registrant'));
SELECT t.eq(pg_temp.sees('youth'), 0, 'after cancelling, a non-member registrant loses the venue');
SELECT t.reset();

-- The adult team becomes a youth team the moment a minor joins.
SELECT t.member('rec', 'registrant', 'player');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(pg_temp.sees('adult'), 0, 'a minor joining an adult team makes its venue private');
SELECT t.reset();

-- A hidden post returns nothing, even to a would-be allowed reader of a public venue.
UPDATE public.team_posts SET hidden_at = now() WHERE id = (SELECT fresh FROM ids);
SELECT t.as_anon();
SELECT t.eq(pg_temp.sees('fresh'), 0, 'a hidden post has no venue to return');
SELECT t.reset();

-- Every other column is still readable by clients (a new column must be granted).
SELECT t.eq(
  (SELECT count(*)::int FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name = 'team_posts'
      AND c.column_name NOT IN ('location', 'formatted_address', 'place_id', 'lat', 'lng')
      AND NOT has_column_privilege('anon', 'public.team_posts', c.column_name, 'SELECT')),
  0, 'every non-venue column of team_posts is readable by clients');
SELECT t.ok(has_column_privilege('service_role', 'public.team_posts', 'lat', 'SELECT'),
  'the service role still reads the venue');

ROLLBACK;
