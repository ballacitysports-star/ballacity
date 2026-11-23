-- WP 5.6 (20261129110000_attendance_prompt): hosted_games.attendance_prompted_at is the server's record that the 5-minute
-- sweep sent the host the "mark attendance" prompt. No member or visitor writes it, on insert or update, directly or
-- through a SECURITY DEFINER function they call, so a host can neither silence nor replay their prompt; everything else a
-- host does with their game (editing it, marking attendance) is unchanged. The service role claims each game once,
-- including an ended game (the hosted_games guards let server writes through), each game of a series on its own. The
-- prompt's notification type needs no schema change: notifications.type has no CHECK constraint.
BEGIN;
SELECT t.person('host', 35), t.person('alex', 28), t.person('mal', 30), t.person('mod', 40);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('mod'), 'moderator');

-- ================= 1. the shape =================
SELECT t.eq((SELECT format_type(atttypid, atttypmod) || ':' || attnotnull::text || ':' || atthasdef::text
               FROM pg_attribute WHERE attrelid = 'public.hosted_games'::regclass AND attname = 'attendance_prompted_at'),
            'timestamp with time zone:false:false', 'attendance_prompted_at is a nullable timestamptz with no default');
SELECT t.ok((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
               FROM pg_proc p WHERE p.oid = 'private_sec.guard_hosted_game_attendance_prompted_at()'::regprocedure),
            'the guard is SECURITY DEFINER with an empty search_path');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.guard_hosted_game_attendance_prompted_at()', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'private_sec.guard_hosted_game_attendance_prompted_at()', 'EXECUTE'),
            'no API role calls the guard');
SELECT t.eq((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'hosted_games_attendance_prompted_at_server_only'),
            'CREATE TRIGGER hosted_games_attendance_prompted_at_server_only BEFORE INSERT OR UPDATE OF attendance_prompted_at '
              || 'ON public.hosted_games FOR EACH ROW EXECUTE FUNCTION private_sec.guard_hosted_game_attendance_prompted_at()',
            'it runs before every insert, and every update that names the column');
SELECT t.eq((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND contype = 'c'), 0,
            'notifications.type has no CHECK constraint');

-- An ended game with a player, the next date of the same series, and an upcoming game.
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, duration, max_players, series_id) VALUES
  ('gdone', t.id('host'), 'basketball', 'Tuesday run', now() - interval '5 hours', '90 min', 10, t.id('series')),
  ('gnext', t.id('host'), 'basketball', 'Tuesday run', now() - interval '4 hours', '90 min', 10, t.id('series')),
  ('gsoon', t.id('host'), 'basketball', 'Friday run',  now() + interval '3 days',  '90 min', 10, NULL);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gdone', t.id('alex')), ('gnext', t.id('alex'));
SET LOCAL session_replication_role = origin;

-- ================= 2. members cannot write it =================
SELECT t.as_user(t.id('host'));
SELECT t.throws($$UPDATE public.hosted_games SET attendance_prompted_at = now() WHERE id = 'gdone'$$,
                'ATTENDANCE_PROMPT_SERVER_ONLY', 'the host cannot mark their own game as prompted (silencing the prompt)');
SELECT t.throws($$UPDATE public.hosted_games SET attendance_prompted_at = now(), title = 'Renamed' WHERE id = 'gsoon'$$,
                'ATTENDANCE_PROMPT_SERVER_ONLY', 'not even alongside an ordinary edit');
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET title = 'Friday night run' WHERE id = 'gsoon'$$), 1,
            'an ordinary edit of their game still works');
SELECT t.throws($$INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, attendance_prompted_at)
                  VALUES ('gnew', auth.uid(), 'basketball', 'New run', now() + interval '2 days', 10, now())$$,
                'ATTENDANCE_PROMPT_SERVER_ONLY', 'nor create a game already marked as prompted');
SELECT t.lives($$INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players)
                 VALUES ('gnew', auth.uid(), 'basketball', 'New run', now() + interval '2 days', 10)$$,
               'creating a game still works');
SELECT t.lives(format('SELECT public.host_mark_attendance(%L, %L::uuid, true)', 'gdone', t.id('alex')),
               'the host still marks attendance');
SELECT t.reset();
SELECT t.ok((SELECT attended AND attendance_marked_by = t.id('host') FROM public.game_participants
              WHERE game_id = 'gdone' AND user_id = t.id('alex')), 'and the mark is recorded');
SELECT t.ok((SELECT bool_and(attendance_prompted_at IS NULL) FROM public.hosted_games), 'no member write reached the column');

SELECT t.as_user(t.id('mal'));
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET attendance_prompted_at = now() WHERE id = 'gdone'$$), 0,
            'a stranger reaches no one''s game (row security, unchanged)');
SELECT t.reset();
SELECT t.as_user(t.id('mod'));
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET attendance_prompted_at = now() WHERE id = 'gdone'$$), 0,
            'nor does a moderator (a member''s session: no row reached, and the guard would refuse one)');
SELECT t.reset();

-- Through a SECURITY DEFINER function a member calls: still refused.
CREATE FUNCTION t.forge_prompt(_game text, _at timestamptz) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$
  UPDATE public.hosted_games SET attendance_prompted_at = _at WHERE id = _game $f$;
GRANT EXECUTE ON FUNCTION t.forge_prompt(text, timestamptz) TO authenticated, anon;
SELECT t.as_user(t.id('host'));
SELECT t.throws($$SELECT t.forge_prompt('gdone', now())$$, 'ATTENDANCE_PROMPT_SERVER_ONLY',
                'nor through a SECURITY DEFINER function running as its owner');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT t.forge_prompt('gdone', now())$$, 'ATTENDANCE_PROMPT_SERVER_ONLY', 'nor a signed-out visitor through one');
SELECT t.reset();

-- ================= 3. the server claims each game once =================
SELECT t.as_service();
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET attendance_prompted_at = now()
                         WHERE id = 'gdone' AND attendance_prompted_at IS NULL$$), 1,
            'the service role claims an ended game (the closed-game and hosting guards let a server write through)');
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET attendance_prompted_at = now()
                         WHERE id = 'gdone' AND attendance_prompted_at IS NULL$$), 0,
            'a second claim (another run) finds nothing: one prompt per game');
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET attendance_prompted_at = now()
                         WHERE id = 'gnext' AND attendance_prompted_at IS NULL$$), 1,
            'the next game of the same series is claimed on its own');
SELECT t.lives($$INSERT INTO public.notifications (user_id, type, title, body, link)
                 SELECT host_id, 'game_attendance_prompt', 'Who showed up at ' || title || '?',
                        'Mark who showed up. It builds your host reliability score.', '/games/' || id || '?tab=overview#attendance'
                   FROM public.hosted_games WHERE id = 'gdone'$$,
               'the prompt''s notice is stored as it is (no type list to extend)');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(id || ':' || (attendance_prompted_at IS NOT NULL)::text, ',' ORDER BY id) FROM public.hosted_games),
            'gdone:true,gnew:false,gnext:true,gsoon:false', 'exactly the two claimed games carry the stamp');

SELECT t.as_user(t.id('host'));
SELECT t.throws($$UPDATE public.hosted_games SET attendance_prompted_at = NULL WHERE id = 'gdone'$$,
                'ATTENDANCE_PROMPT_SERVER_ONLY', 'the host cannot clear the stamp to have the prompt sent again');
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET title = 'Tuesday run (court 2)' WHERE id = 'gdone'$$), 1,
            'editing a prompted game still works and keeps the stamp');
SELECT t.reset();
SELECT t.ok((SELECT attendance_prompted_at IS NOT NULL FROM public.hosted_games WHERE id = 'gdone'), 'the stamp held');

-- ================= 4. the prompt is one transaction: the stamp and the notice together, or neither =================
-- public.send_attendance_prompt: a run cut off part way can never leave a game stamped with no notice.
SELECT t.ok((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
               FROM pg_proc p WHERE p.oid = 'public.send_attendance_prompt(text,text,text,text)'::regprocedure),
            'the prompt function is SECURITY DEFINER with an empty search_path');
SELECT t.ok(has_function_privilege('service_role', 'public.send_attendance_prompt(text,text,text,text)', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.send_attendance_prompt(text,text,text,text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.send_attendance_prompt(text,text,text,text)', 'EXECUTE'),
            'only the service role may call it');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, duration, max_players, status, cancelled_at) VALUES
  ('pdue',  t.id('host'), 'basketball', 'Due run',       now() - interval '5 hours', '90 min', 10, NULL, NULL),
  ('pcanc', t.id('host'), 'basketball', 'Cancelled run', now() - interval '5 hours', '90 min', 10, 'cancelled', now() - interval '1 day'),
  ('pmark', t.id('host'), 'basketball', 'Marked run',    now() - interval '5 hours', '90 min', 10, NULL, NULL),
  ('palone', t.id('host'), 'basketball', 'Host alone',   now() - interval '5 hours', '90 min', 10, NULL, NULL),
  ('pfail', t.id('host'), 'basketball', 'Broken run',    now() - interval '5 hours', '90 min', 10, NULL, NULL);
INSERT INTO public.game_participants (game_id, user_id, attended) VALUES
  ('pdue', t.id('host'), NULL), ('pdue', t.id('alex'), NULL), ('pcanc', t.id('alex'), NULL),
  ('pmark', t.id('alex'), true), ('palone', t.id('host'), NULL), ('pfail', t.id('alex'), NULL);
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.prompt(_game text, _title text DEFAULT 'Who showed up?') RETURNS uuid LANGUAGE sql AS $f$
  SELECT public.send_attendance_prompt(_game, _title, 'Mark who showed up.', '/games/' || _game || '?tab=overview#attendance') $f$;
CREATE FUNCTION t.prompts(_game text) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.notifications
   WHERE type = 'game_attendance_prompt' AND link = '/games/' || _game || '?tab=overview#attendance' $f$;
SELECT t.as_service();
SELECT t.ok(t.prompt('pdue') IS NOT NULL, 'the service role sends a due game''s prompt (the guards let it through)');
SELECT t.ok(t.prompt('pdue') IS NULL, 'a second call sends nothing');
SELECT t.ok(t.prompt('pcanc') IS NULL, 'nothing for a cancelled game');
SELECT t.ok(t.prompt('pmark') IS NULL, 'nothing once anyone''s attendance is marked');
SELECT t.ok(t.prompt('palone') IS NULL, 'nothing without a participant other than the host');
SELECT t.throws($$SELECT t.prompt('pfail', NULL)$$, 'null value', 'a notice that cannot be written fails the call');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(user_id::text || ':' || title, ',') FROM public.notifications
              WHERE type = 'game_attendance_prompt' AND link LIKE '/games/pdue%'),
            t.id('host')::text || ':Who showed up?', 'one notice, to the game''s host, with the words the sweep gave');
SELECT t.eq((SELECT string_agg(id || ':' || (attendance_prompted_at IS NOT NULL)::text, ',' ORDER BY id)
               FROM public.hosted_games WHERE id LIKE 'p%'),
            'palone:false,pcanc:false,pdue:true,pfail:false,pmark:false',
            'only the prompted game is stamped: the failed one was not left stamped without its notice');
SELECT t.eq(t.prompts('pfail') + t.prompts('pcanc') + t.prompts('pmark') + t.prompts('palone'), 0, 'and no other notice exists');

SELECT t.as_user(t.id('host'));
SELECT t.throws($$SELECT t.prompt('pfail')$$, 'permission denied', 'a host cannot send (or replay) a prompt');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT t.prompt('pfail')$$, 'permission denied', 'nor a visitor');
SELECT t.reset();
ROLLBACK;
