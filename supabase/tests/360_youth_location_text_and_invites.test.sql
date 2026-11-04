-- PRIV-2D: the location of a youth-inclusive game cannot leave through free text or through an invitation.
--   * title / description / neighborhood / rules / ... of such a game refuse an address, map link, coordinates, unit or the venue name;
--     ordinary descriptions of an area still pass; new games, edits, a re-pointed venue and a game that becomes youth-inclusive are all checked;
--     unrelated updates and cancellations are never blocked; moderators can list legacy offenders.
--   * an invitation (contact request + notification) to such a game stores only the coarse form, whatever the client sent;
--     the exact place stays behind hosted_game_private, which opens only for an approved, settled participation.
BEGIN;
SELECT t.person('host', 35), t.person('recip', 30), t.person('stranger', 28), t.person('modone', 38), t.person('other', 33);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');

ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;

-- ================= 1. the detector =================
SELECT t.eq(private_sec.text_discloses_location('12 Oak St', NULL), 'street_address', 'a house number and street is an address');
SELECT t.eq(private_sec.text_discloses_location('Meet at 1200 N Lake Shore Dr, east gate', NULL), 'street_address', 'a longer street name is an address');
SELECT t.eq(private_sec.text_discloses_location('5th Ave', NULL), 'street_address', 'an ordinal street is an address');
SELECT t.eq(private_sec.text_discloses_location('https://maps.google.com/?q=33.7,-84.3', NULL), 'map_link', 'a map link');
SELECT t.eq(private_sec.text_discloses_location('goo.gl/maps/abc123', NULL), 'map_link', 'a short map link');
SELECT t.eq(private_sec.text_discloses_location('///filled.count.soap', NULL), 'map_link', 'a what3words address');
SELECT t.eq(private_sec.text_discloses_location('33.77712, -84.38812', NULL), 'coordinates', 'coordinates');
SELECT t.eq(private_sec.text_discloses_location('Apt 4B', NULL), 'unit', 'an apartment');
SELECT t.eq(private_sec.text_discloses_location('Suite 200 on the left', NULL), 'unit', 'a suite');
SELECT t.eq(private_sec.text_discloses_location('Meet at Lincoln Elementary', 'Lincoln Elementary Gym, 12 Oak St'), 'venue_name', 'two consecutive words of the venue name');
SELECT t.eq(private_sec.text_discloses_location('behind oak st', 'Lincoln Elementary Gym, 12 Oak St'), 'venue_name', 'the street name from the exact address, without the number');
SELECT t.ok(private_sec.text_discloses_location(x, 'Lincoln Elementary Gym, 12 Oak St, Brooklyn, NY') IS NULL, 'ordinary text is accepted: ' || x)
  FROM unnest(ARRAY['Brooklyn', 'Park Slope, Brooklyn', 'Downtown Atlanta', 'North side', 'Near Midtown', 'U12 pickup Saturday 10am',
    'Bring water. 5v5 half court. Games to 11.', '3 on 3 half court', 'Meet 7 pm court 2', '10 players max', 'Come 15 minutes early',
    'Full court run, 2 games to 21', '1st place gets bragging rights', 'Brooklyn, NY']) AS x;
SELECT t.ok(private_sec.text_discloses_location('Brooklyn', 'Brooklyn') IS NULL, 'a location that is only a city does not block that city');
SELECT t.ok(private_sec.text_discloses_location('Gym', 'Gym, 5 Elm St') IS NULL, 'a single generic word is not a venue');

-- ================= 2. new games =================
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
  ('y1', t.id('host'), 'basketball', 'Youth pickup', now()+interval '3 days', 8, 12, 'Lincoln Elementary Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812);
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games WHERE id = 'y1'), 1, 'a youth game with an ordinary title and an area-level neighborhood is created');
SELECT t.throws($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood) VALUES ('y2', (SELECT id FROM auth.users LIMIT 1), 'basketball', 'Pickup at 12 Oak St', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', 'Midtown')$q$,
  'LOCATION_IN_PUBLIC_TEXT', 'a title with the street address is refused');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, description) VALUES ('y3', %L, 'basketball', 'Pickup', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', 'Midtown', 'Directions: https://maps.google.com/?q=33.7,-84.3')$q$, t.id('host')),
  'LOCATION_IN_PUBLIC_TEXT', 'a description with a map link is refused');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood) VALUES ('y4', %L, 'basketball', 'Pickup', now()+interval '3 days', 8, 12, 'Lincoln Elementary Gym, 12 Oak St', 'Lincoln Elementary')$q$, t.id('host')),
  'LOCATION_IN_PUBLIC_TEXT', 'a neighborhood that is the venue name is refused (the coarse label is built from it)');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood) VALUES ('y5', %L, 'basketball', 'Pickup', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', '33.77712, -84.38812')$q$, t.id('host')),
  'LOCATION_IN_PUBLIC_TEXT', 'a neighborhood that is a coordinate pair is refused');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood) VALUES ('y6', %L, 'basketball', 'Pickup', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', repeat('x', 81))$q$, t.id('host')),
  'short area name', 'a neighborhood longer than 80 characters is refused');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, game_rules) VALUES ('y7', %L, 'basketball', 'Pickup', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', 'Midtown', 'Park at 45 Elm Street behind the gym')$q$, t.id('host')),
  'LOCATION_IN_PUBLIC_TEXT', 'the rules text is checked too');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, equipment) VALUES ('y8', %L, 'basketball', 'Pickup', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', 'Midtown', ARRAY['ball', 'Meet at 45 Elm Street'])$q$, t.id('host')),
  'LOCATION_IN_PUBLIC_TEXT', 'and each equipment entry');
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, neighborhood, description) VALUES ('y9', %L, 'basketball', 'No age limit', now()+interval '3 days', 'Gym, 12 Oak St', 'Midtown', 'We play at 45 Elm Street')$q$, t.id('host')),
  'LOCATION_IN_PUBLIC_TEXT', 'a game with no age limit counts as youth-inclusive');
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, description) VALUES ('a1', %L, 'basketball', 'Adults at 12 Oak St', now()+interval '3 days', 21, 40, 'Gym, 12 Oak St', 'Midtown', 'Directions: https://maps.google.com/?q=33.7,-84.3')$q$, t.id('host')),
  'an enforced adult-only game is not restricted (its location is public anyway)');
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, description, game_rules) VALUES ('y10', %L, 'basketball', 'U12 5v5, Saturday 10am', now()+interval '3 days', 8, 12, 'Gym, 12 Oak St', 'Park Slope, Brooklyn', 'Bring water. Half court, games to 11. Parents welcome to watch.', 'Be kind. Rotate every game.')$q$, t.id('host')),
  'legitimate descriptions of the area, the format and the rules pass');

-- ================= 3. edits =================
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$UPDATE public.hosted_games SET title = 'Pickup at 12 Oak St' WHERE id = 'y1'$q$, 'LOCATION_IN_PUBLIC_TEXT', 'editing the title to include the address is refused');
SELECT t.throws($q$UPDATE public.hosted_games SET description = 'Gate code at Lincoln Elementary' WHERE id = 'y1'$q$, 'LOCATION_IN_PUBLIC_TEXT', 'editing the description to name the venue is refused');
SELECT t.throws($q$UPDATE public.hosted_games SET neighborhood = 'Lincoln Elementary' WHERE id = 'y1'$q$, 'LOCATION_IN_PUBLIC_TEXT', 'editing the neighborhood to the venue name is refused');
SELECT t.lives($q$UPDATE public.hosted_games SET description = 'Come ready to play. Water provided.' WHERE id = 'y1'$q$, 'an ordinary edit is accepted');
SELECT t.lives($q$UPDATE public.hosted_games SET neighborhood = 'Midtown Atlanta' WHERE id = 'y1'$q$, 'so is a broader area name');
SELECT t.reset();

-- a venue change re-checks text written earlier against the new venue
UPDATE public.hosted_games SET description = 'Meet near Riverside Middle School' WHERE id = 'y1';
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$UPDATE public.hosted_games SET location = 'Riverside Middle School Gym, 7 Pine Rd' WHERE id = 'y1'$q$, 'LOCATION_IN_PUBLIC_TEXT', 're-pointing the game at the venue the description already names is refused');
SELECT t.reset();

-- a game that becomes youth-inclusive is checked in full
SELECT t.throws(format($q$UPDATE public.hosted_games SET min_age = 8, max_age = 12 WHERE id = 'a1'$q$), 'LOCATION_IN_PUBLIC_TEXT', 'lowering an adult-only game''s age range runs the check over its existing text');

-- legacy offenders: a row that already holds an address is not blocked from unrelated updates
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, description) VALUES
  ('legacy', t.id('host'), 'basketball', 'Pickup at 99 Maple Ave', now()+interval '3 days', 8, 12, 'Court, 99 Maple Ave', 'Eastside', 'Directions: 99 Maple Ave');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET joined = 1 WHERE id = 'legacy'$q$, 'an unrelated update (join count) of a legacy row is not blocked');
SELECT t.lives($q$UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'legacy'$q$, 'cancelling a legacy row is not blocked');
SELECT t.lives($q$UPDATE public.hosted_games SET cancellation_reason = 'other', cancellation_notes = 'Court at 99 Maple Ave is flooded' WHERE id = 'legacy'$q$, 'a cancellation note that names the address does not block the cancellation');
SELECT t.reset();
SELECT t.eq((SELECT cancellation_notes FROM public.hosted_games WHERE id = 'legacy'), 'Details were removed because they included a location.', 'but the note is replaced, never published');
SELECT t.throws(format($q$UPDATE public.hosted_games SET description = 'Now at 99 Maple Ave again' WHERE id = 'legacy'$q$), 'LOCATION_IN_PUBLIC_TEXT', 'editing the offending field again is refused');

-- ================= 4. moderation scan =================
SELECT t.as_user(t.id('modone'));
SELECT t.ok((SELECT count(*) FROM public.list_youth_games_with_location_text() WHERE game_id = 'legacy' AND field = 'title' AND reason = 'street_address') = 1, 'a moderator can list the legacy game and see which field and why');
SELECT t.ok((SELECT count(*) FROM public.list_youth_games_with_location_text() WHERE game_id IN ('y1', 'y10', 'a1')) = 0, 'and clean or adult-only games are not listed');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT * FROM public.list_youth_games_with_location_text()$q$, 'Moderators only', 'a member who is not a moderator is refused');
SELECT t.as_anon();
SELECT t.throws($q$SELECT * FROM public.list_youth_games_with_location_text()$q$, 'permission denied', 'an anonymous caller is refused');
SELECT t.reset();

-- ================= 5. invitations =================
INSERT INTO public.player_availabilities (user_id, sports, skill_level, recurring_days, travel_radius_km, status, time_slots, skill_levels, looking_for)
  VALUES (t.id('recip'), ARRAY['Basketball'], 'intermediate', ARRAY['Sat'], 10, 'open', '[]'::jsonb, '{}'::jsonb, ARRAY['guest']);
CREATE TEMP TABLE _av AS SELECT id FROM public.player_availabilities WHERE user_id = t.id('recip');
GRANT SELECT ON _av TO authenticated;

SELECT t.as_user(t.id('host'));
SELECT t.lives(format($q$INSERT INTO public.availability_contact_requests (id, availability_id, from_user_id, to_user_id, kind, game_id, game_title, game_sport, game_location, message)
  VALUES (%L, (SELECT id FROM _av), %L, %L, 'invite', 'y1', 'Forged title 12 Oak St', 'basketball', 'Lincoln Elementary Gym, 12 Oak St',
          'You''re invited to Youth pickup at Lincoln Elementary Gym, 12 Oak St. See you there!')$q$, t.id('inv1'), t.id('host'), t.id('recip')),
  'a host can invite a player to a youth game (an old client that sends the exact venue is not broken)');
SELECT t.throws(format($q$INSERT INTO public.availability_contact_requests (availability_id, from_user_id, to_user_id, kind, game_id, message)
  VALUES ((SELECT id FROM _av), %L, %L, 'invite', 'y1', 'Park behind 45 Elm Street and walk over')$q$, t.id('host'), t.id('recip')),
  'LOCATION_IN_PUBLIC_TEXT', 'but a message that gives another address is refused');
SELECT t.reset();
SELECT t.eq((SELECT game_location FROM public.availability_contact_requests WHERE id = t.id('inv1')), 'Midtown Atlanta', 'the stored location is the coarse form, not what the client sent');
SELECT t.eq((SELECT game_title FROM public.availability_contact_requests WHERE id = t.id('inv1')), 'Youth pickup'::text, 'the stored title is the game''s own title');
SELECT t.ok((SELECT message NOT ILIKE '%Lincoln%' AND message NOT ILIKE '%Oak St%' AND message ILIKE '%Midtown Atlanta%' FROM public.availability_contact_requests WHERE id = t.id('inv1')),
  'the exact venue is replaced by the coarse form inside the message');
SELECT t.as_user(t.id('recip'));
SELECT t.ok((SELECT game_location = 'Midtown Atlanta' FROM public.availability_contact_requests WHERE id = t.id('inv1')), 'the recipient reads only the coarse form');
SELECT t.reset();

-- adult-only game, unknown game, no game
SELECT t.as_user(t.id('host'));
INSERT INTO public.availability_contact_requests (availability_id, from_user_id, to_user_id, kind, game_id, game_title, game_sport, game_location)
  SELECT id, t.id('host'), t.id('recip'), 'invite', 'a1', 'Adults', 'basketball', 'Gym, 12 Oak St' FROM _av;
SELECT t.reset();
SELECT t.eq((SELECT game_location FROM public.availability_contact_requests WHERE game_id = 'a1'), 'Gym, 12 Oak St', 'an invitation to an adult-only game keeps its (public) location');
SELECT t.as_user(t.id('other'));
INSERT INTO public.availability_contact_requests (availability_id, from_user_id, to_user_id, kind, game_id, game_location)
  SELECT id, t.id('other'), t.id('recip'), 'invite', 'no-such-game', 'Secret Gym, 5 Elm St' FROM _av;
SELECT t.reset();
SELECT t.eq((SELECT game_location FROM public.availability_contact_requests WHERE game_id = 'no-such-game'), 'Location shared after you join', 'a game we cannot find fails closed to the generic label');
SELECT t.as_user(t.id('stranger'));
INSERT INTO public.availability_contact_requests (availability_id, from_user_id, to_user_id, kind, game_location)
  SELECT id, t.id('stranger'), t.id('recip'), 'contact', 'Secret Gym, 5 Elm St' FROM _av;
SELECT t.reset();
SELECT t.ok((SELECT game_location IS NULL FROM public.availability_contact_requests WHERE from_user_id = t.id('stranger')), 'a plain contact request cannot carry a location');

-- the invitation notification (written for the recipient by the server; a client can only write its own)
SELECT t.as_user(t.id('host'));
SELECT t.throws(format($q$INSERT INTO public.notifications (user_id, type, title, body, link) VALUES (%L, 'game_invite', 'Spoofed', 'x', '/games/y1')$q$, t.id('recip')),
  'row-level security', 'a client cannot write a notification into someone else''s inbox');
SELECT t.reset();
INSERT INTO public.notifications (user_id, type, title, body, link) VALUES
  (t.id('recip'), 'game_invite', 'You''re invited to Youth pickup', 'basketball · Lincoln Elementary Gym, 12 Oak St', '/games/y1?invite=1');
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('recip') AND type = 'game_invite'), 'basketball · Midtown Atlanta', 'the invitation notification carries the coarse form, whatever the sender built');
INSERT INTO public.notifications (user_id, type, title, body, link) VALUES
  (t.id('recip'), 'game_invite', 'Adults', 'basketball · Gym, 12 Oak St', '/games/a1?invite=1');
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('recip') AND link LIKE '/games/a1%'), 'basketball · Gym, 12 Oak St', 'an adult-only game''s invitation is left alone');

-- ================= 6. the exact place stays behind approved, settled participation =================
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng, price) VALUES
  ('p1', t.id('host'), 'basketball', 'Paid youth run', now()+interval '3 days', 8, 12, 'Roosevelt Rec Center, 3 Pine Rd', 'Eastside', 33.9, -84.1, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('p1', t.id('host'), 10);
CREATE FUNCTION t.vp3(g text) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.hosted_game_private WHERE game_id = g $f$;
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('y1'), 0, 'invited but not joined: the recipient cannot read the exact place');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('y1', t.id('recip'), t.id('host'), 'jr1', 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('y1'), 0, 'PENDING join request: no');
SELECT t.reset();
UPDATE public.join_requests SET status = 'rejected' WHERE game_id = 'y1' AND player_id = t.id('recip');
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('y1'), 0, 'REJECTED request: no');
SELECT t.reset();
UPDATE public.join_requests SET status = 'approved' WHERE game_id = 'y1' AND player_id = t.id('recip');
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('y1', t.id('recip')), ('p1', t.id('recip'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('y1'), 1, 'APPROVED and on the roster of a free game: yes');
SELECT t.eq(t.vp3('p1'), 0, 'on the roster of a paid game with no payment yet: no');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (t.id('recip'), 'p1', t.id('host'), 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('p1'), 0, 'payment PENDING: no');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
UPDATE public.payment_submissions SET status = 'verified' WHERE game_id = 'p1' AND player_id = t.id('recip');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('p1'), 1, 'payment VERIFIED: yes');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
UPDATE public.payment_submissions SET status = 'cancelled', refund_status = 'refunded', refund_reason = 'player_cancelled' WHERE game_id = 'p1' AND player_id = t.id('recip');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('p1'), 0, 'payment REFUNDED (spot given up): no, even if the roster row were still there');
SELECT t.reset();
DELETE FROM public.game_participants WHERE game_id = 'y1' AND user_id = t.id('recip');
UPDATE public.join_requests SET status = 'rejected' WHERE game_id = 'y1' AND player_id = t.id('recip');
SELECT t.as_user(t.id('recip'));
SELECT t.eq(t.vp3('y1'), 0, 'participation REVOKED (removed from the roster): no');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.vp3('y1') + t.vp3('p1'), 0, 'a stranger: no');
SELECT t.reset();
ROLLBACK;
