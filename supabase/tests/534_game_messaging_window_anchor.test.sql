-- SEC-7 item 4: the host-to-participant messaging context ends 30 days after a server-kept anchor. The host can no longer extend it by editing
-- the date of a game that has already ended; postponing an upcoming game still moves it.
BEGIN;
SELECT t.person('host', 37), t.person('kid', 15), t.person('gp', 42);
SELECT t.guardian('gp', 'kid');
SELECT t.as_user(t.id('host'));
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood) VALUES
  ('past', t.id('host'), 'basketball', 'Teen run', now() + interval '2 days', 12, 17, 'Gym', 'North');
SELECT t.reset();
CREATE FUNCTION pg_temp.join_kid(_game text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.join_requests (game_id, player_id, host_id, status, idempotency_key, guardian_approved_at, guardian_approved_by)
  VALUES (_game, t.id('kid'), t.id('host'), 'approved', 'k-' || _game, now(), t.id('gp'));
  INSERT INTO public.game_participants (game_id, user_id) VALUES (_game, t.id('kid'));
  SET LOCAL session_replication_role = origin;
END $$;
SELECT pg_temp.join_kid('past');
SELECT t.ok(private_sec.messaging_connection(t.id('host'), t.id('kid')), 'setup: an upcoming game with a guardian-approved participant is a context');

-- the game ends (time passing is simulated by moving the dates while the game is still upcoming, which the anchor follows)
UPDATE public.hosted_games SET date = now() - interval '45 days', ends_at = now() - interval '44 days' WHERE id = 'past';
SELECT t.ok(NOT private_sec.messaging_connection(t.id('host'), t.id('kid')), 'more than 30 days after the game there is no context');

-- the host moves the ended game into the future
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed($q$UPDATE public.hosted_games SET date = now() + interval '5 days', ends_at = NULL WHERE id = 'past'$q$), 1,
  'the host can still edit the date of an ended game');
SELECT t.reset();
SELECT t.ok(NOT private_sec.messaging_connection(t.id('host'), t.id('kid')), 'but that does not bring the messaging context back');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET date = now() + interval '9 days' WHERE id = 'past'$q$, 'a second edit, now that the date looks upcoming');
SELECT t.reset();
SELECT t.ok(NOT private_sec.messaging_connection(t.id('host'), t.id('kid')), 'does not bring it back either');

-- a legitimate postponement of an upcoming game keeps the context
SELECT t.as_user(t.id('host'));
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood) VALUES
  ('soon', t.id('host'), 'basketball', 'Teen run 2', now() + interval '2 days', 12, 17, 'Gym', 'North'),
  ('done', t.id('host'), 'basketball', 'Teen run 3', now() + interval '2 days', 12, 17, 'Gym', 'North');
SELECT t.reset();
SELECT pg_temp.join_kid('soon');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET date = now() + interval '20 days' WHERE id = 'soon'$q$, 'the host postpones an upcoming game');
SELECT t.reset();
SELECT t.ok(private_sec.messaging_connection(t.id('host'), t.id('kid')), 'the context holds for the upcoming game');

-- a completed game
SET LOCAL session_replication_role = replica;
UPDATE public.hosted_games SET status = 'completed' WHERE id = 'done';
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.hosted_games SET date = now() + interval '200 days' WHERE id = 'done'$q$, 'the host edits a completed game''s date');
SELECT t.reset();

-- the anchors
SELECT t.ok((SELECT anchor_at < now() - interval '40 days' FROM public.game_contact_windows WHERE game_id = 'past'), 'the ended game''s anchor did not move');
SELECT t.ok((SELECT anchor_at > now() + interval '19 days' FROM public.game_contact_windows WHERE game_id = 'soon'), 'the upcoming game''s anchor followed the postponement');
SELECT t.ok((SELECT anchor_at < now() + interval '3 days' FROM public.game_contact_windows WHERE game_id = 'done'), 'a completed game''s anchor does not move');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_contact_windows'), 0, 'clients cannot read the anchors');
SELECT t.eq(t.changed($q$UPDATE public.game_contact_windows SET anchor_at = now() + interval '1 year'$q$), 0, 'or write them');
SELECT t.reset();

ROLLBACK;
