-- SEC-7 item 2: after coarsening activation a blank save on a youth game never wipes the only exact location; removing it is explicit.
BEGIN;
SELECT t.person('host', 36), t.person('stranger', 33);
SET LOCAL session_replication_role = replica;
INSERT INTO public.app_settings (key, value) VALUES ('youth_location_privacy', '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
  ('yb', t.id('host'), 'basketball', 'U14 run', now() + interval '3 days', 10, 14, 'Lincoln Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812),
  ('ym', t.id('host'), 'basketball', 'U14 run 2', now() + interval '3 days', 10, 14, 'Lincoln Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812),
  ('yc', t.id('host'), 'basketball', 'U14 run 3', now() + interval '3 days', 10, 14, 'Lincoln Gym, 12 Oak St', 'Midtown', 33.77712, -84.38812);
SELECT t.reset();
SELECT t.ok((SELECT location = 'Lincoln Gym, 12 Oak St' AND lat = 33.77712 FROM public.hosted_game_private WHERE game_id = 'yb'), 'setup: the exact copy is private');
SELECT t.ok((SELECT location = 'Midtown' AND lat = 33.78 FROM public.hosted_games WHERE id = 'yb'), 'setup: the public columns are coarse');

-- an older client blanks the location
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET location = '', title = 'U14 run!' WHERE id = 'yb'$q$, 'an older client saves a blank location');
SELECT t.reset();
SELECT t.eq((SELECT location FROM public.hosted_game_private WHERE game_id = 'yb'), 'Lincoln Gym, 12 Oak St', 'which does not wipe the exact copy');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'yb'), 'Midtown', 'and the public location stays the coarse label');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET location = '   ', lat = NULL, lng = NULL WHERE id = 'yb'$q$, 'blank text and no coordinates');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Lincoln Gym, 12 Oak St' AND lat = 33.77712 AND lng = -84.38812 FROM public.hosted_game_private WHERE game_id = 'yb'),
  'keep the exact location and point');
SELECT t.ok((SELECT lat = 33.78 AND lng = -84.39 FROM public.hosted_games WHERE id = 'yb'), 'and the coarse public point');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET location = 'Midtown', lat = 33.78, lng = -84.39 WHERE id = 'yb'$q$, 'a client sends the coarse values back');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Lincoln Gym, 12 Oak St' AND lat = 33.77712 FROM public.hosted_game_private WHERE game_id = 'yb'), 'which changes nothing');

-- genuine changes are still stored
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET location = 'Oak Hall, 3 Elm St', lat = NULL, lng = NULL WHERE id = 'ym'$q$,
  'the host moves the game to an address that could not be geocoded');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Oak Hall, 3 Elm St' AND lat IS NULL AND lng IS NULL FROM public.hosted_game_private WHERE game_id = 'ym'),
  'the new address is stored and the old point is not kept');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET lat = 33.70, lng = -84.40 WHERE id = 'ym'$q$, 'the host drops a pin with two decimals');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Oak Hall, 3 Elm St' AND lat = 33.70 AND lng = -84.40 FROM public.hosted_game_private WHERE game_id = 'ym'),
  'the pin is stored and the address kept');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'ym'), 'Midtown', 'the public location is still coarse');

-- explicit removal
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT public.clear_hosted_game_location('yc')$q$, 'Only the game''s host', 'a stranger cannot clear a game''s location');
SELECT t.as_user(t.id('host'));
SELECT t.throws($q$SELECT public.clear_hosted_game_location('yc', ARRAY['title'])$q$, 'Unknown location field', 'only location fields can be cleared');
SELECT t.lives($q$SELECT public.clear_hosted_game_location('yc', ARRAY['lat', 'lng'])$q$, 'the host removes the map point');
SELECT t.reset();
SELECT t.ok((SELECT location = 'Lincoln Gym, 12 Oak St' AND lat IS NULL AND lng IS NULL FROM public.hosted_game_private WHERE game_id = 'yc'),
  'only the point is removed from the exact copy');
SELECT t.ok((SELECT lat IS NULL AND lng IS NULL AND location = 'Midtown' FROM public.hosted_games WHERE id = 'yc'), 'and from the public columns');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$SELECT public.clear_hosted_game_location('yc')$q$, 'the host removes the location');
SELECT t.reset();
SELECT t.ok((SELECT location IS NULL AND lat IS NULL AND lng IS NULL FROM public.hosted_game_private WHERE game_id = 'yc'), 'the exact copy is cleared');
SELECT t.eq((SELECT location FROM public.hosted_games WHERE id = 'yc'), 'TBD', 'and the public location reads TBD');
SELECT t.eq(current_setting('app.coarsening_existing', true), '', 'the bypass flag is not left on');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.clear_hosted_game_location('yc')$q$, 'permission denied', 'visitors cannot call it');
SELECT t.reset();

ROLLBACK;
