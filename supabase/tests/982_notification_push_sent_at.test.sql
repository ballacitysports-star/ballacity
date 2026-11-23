-- WP 5.4 (20261129100000_notification_push_sent_at): notifications.push_sent_at is the server's record that the 5-minute
-- sweep took an invite notification for its push. Members still insert and read their own notifications as before, and the
-- database's own invite functions still write theirs, but no member or visitor writes push_sent_at by any path (directly,
-- or through a SECURITY DEFINER function they call). The service role takes a row once: a second take finds nothing.
-- notifications.type has no CHECK constraint, so the swept types need no schema change.
-- Only the database's own invite rows reach the sweep: an invite-typed row written any other way (a member's own row, a
-- service-role insert, a member's later change to one) is stamped as it is stored, so it can neither crowd the sweep's read
-- nor be pushed. The sweep's read has a partial index of its own.
BEGIN;
SELECT t.person('host', 35), t.person('ana', 28), t.person('mal', 30);

-- ================= 1. the shape =================
SELECT t.eq((SELECT format_type(atttypid, atttypmod) || ':' || attnotnull::text || ':' || atthasdef::text
               FROM pg_attribute WHERE attrelid = 'public.notifications'::regclass AND attname = 'push_sent_at'),
            'timestamp with time zone:false:false', 'push_sent_at is a nullable timestamptz with no default');
SELECT t.eq((SELECT count(*)::int FROM pg_constraint WHERE conrelid = 'public.notifications'::regclass AND contype = 'c'), 0,
            'notifications.type has no CHECK constraint: any notification type is stored as it is');
SELECT t.ok((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
               FROM pg_proc p WHERE p.oid = 'private_sec.guard_notification_push_sent_at()'::regprocedure),
            'the guard is SECURITY DEFINER with an empty search_path');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.guard_notification_push_sent_at()', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'private_sec.guard_notification_push_sent_at()', 'EXECUTE'),
            'no API role calls the guard');
SELECT t.eq((SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'notifications_push_sent_at_server_only'),
            'CREATE TRIGGER notifications_push_sent_at_server_only BEFORE INSERT OR UPDATE OF push_sent_at, type, created_at, '
              || 'title, body, link, user_id ON public.notifications '
              || 'FOR EACH ROW EXECUTE FUNCTION private_sec.guard_notification_push_sent_at()',
            'it runs before every insert, and every update that names the column or what a push would say');
SELECT t.eq(pg_get_indexdef('public.notifications_invite_push_due_idx'::regclass),
            'CREATE INDEX notifications_invite_push_due_idx ON public.notifications USING btree (created_at) '
              || 'WHERE ((push_sent_at IS NULL) AND (type = ANY (ARRAY[''game_invite''::text, ''game_invite_accepted''::text])))',
            'the sweep''s read has a partial index: invite rows not yet taken, by created_at');
CREATE FUNCTION t.sweep_plan() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE _l text; _plan text := '';
BEGIN
  -- The read as PostgREST sends it: the type list and the time are parameters.
  EXECUTE 'PREPARE t_sweep(text[], timestamptz) AS SELECT id FROM public.notifications '
       || 'WHERE type = ANY ($1) AND push_sent_at IS NULL AND created_at > $2 ORDER BY created_at, id LIMIT 50';
  FOR _l IN EXECUTE 'EXPLAIN (COSTS OFF) EXECUTE t_sweep(''{game_invite,game_invite_accepted}'', now() - interval ''1 hour'')' LOOP
    _plan := _plan || _l || E'\n';
  END LOOP;
  DEALLOCATE t_sweep;
  RETURN _plan;
END $f$;
SET LOCAL enable_seqscan = off;
SELECT t.ok(t.sweep_plan() LIKE '%Index Scan using notifications_invite_push_due_idx%',
            'and the sweep''s read uses it (no scan of the whole table)');
RESET enable_seqscan;

-- ================= 2. the database's own invite notifications are written as before, unswept =================
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, timezone) VALUES
  ('gopen', t.id('host'), 'basketball', 'Open run', now() + interval '3 days', 10, 'America/New_York');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('gopen', t.id('host'), 0, true);
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, timezone, last_confirmed_at)
VALUES (md5('post:ana')::uuid, t.id('ana'), ARRAY['Basketball'], 'All Levels', 'open',
        '[{"weekday":2,"start":"18:00","end":"20:00"}]'::jsonb, 'America/New_York', now());
SET LOCAL session_replication_role = origin;

SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT public.game_invite_player(%L, %L::uuid)', 'gopen', t.id('ana')),
               'the host invites: game_invite_player writes the invitee''s notification as the host');
SELECT t.reset();
SELECT t.as_user(t.id('ana'));
SELECT t.lives(format('SELECT public.game_respond_invite(%L::uuid, true)',
                      (SELECT id FROM public.game_invites WHERE invitee_id = t.id('ana'))),
               'the invitee accepts: game_respond_invite writes the host''s notification as the invitee');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(type || ':' || (push_sent_at IS NULL)::text, ',' ORDER BY type) FROM public.notifications
              WHERE type IN ('game_invite', 'game_invite_accepted')),
            'game_invite:true,game_invite_accepted:true', 'both wait for the sweep: push_sent_at is NULL');

-- ================= 3. members cannot write push_sent_at =================
SELECT t.as_user(t.id('ana'));
SELECT t.lives($$INSERT INTO public.notifications (user_id, type, title) VALUES (auth.uid(), 'general', 'A note to myself')$$,
               'a member still inserts their own notification');
SELECT t.throws($$INSERT INTO public.notifications (user_id, type, title, push_sent_at) VALUES (auth.uid(), 'game_invite', 'x', now())$$,
                'PUSH_SENT_AT_SERVER_ONLY', 'but not one already marked as pushed');
SELECT t.throws($$UPDATE public.notifications SET push_sent_at = now() WHERE user_id = auth.uid() AND type = 'game_invite'$$,
                'PUSH_SENT_AT_SERVER_ONLY', 'nor mark their own invite as pushed (which would silence its push)');
SELECT t.eq(t.changed($$UPDATE public.notifications SET read_at = now() WHERE user_id = auth.uid() AND type = 'game_invite'$$), 1,
            'marking it read still works');
SELECT t.reset();

-- The service role takes ana's invite; ana then tries to clear the stamp to have it pushed again.
SELECT t.as_service();
SELECT t.eq(t.changed($$UPDATE public.notifications SET push_sent_at = now()
                         WHERE type IN ('game_invite', 'game_invite_accepted') AND push_sent_at IS NULL$$), 2,
            'the service role takes both rows');
SELECT t.eq(t.changed($$UPDATE public.notifications SET push_sent_at = now()
                         WHERE type IN ('game_invite', 'game_invite_accepted') AND push_sent_at IS NULL$$), 0,
            'a second take (another run) finds nothing: each row is pushed once');
SELECT t.reset();
SELECT t.as_user(t.id('ana'));
SELECT t.throws($$UPDATE public.notifications SET push_sent_at = NULL WHERE user_id = auth.uid() AND type = 'game_invite'$$,
                'PUSH_SENT_AT_SERVER_ONLY', 'a member cannot clear the stamp to have the push sent again');
SELECT t.lives($$UPDATE public.notifications SET push_sent_at = push_sent_at, read_at = NULL WHERE user_id = auth.uid() AND type = 'game_invite'$$,
               'a write that keeps the stamp as it is (a whole-row save) still works');
SELECT t.reset();
SELECT t.as_user(t.id('mal'));
SELECT t.eq(t.changed($$UPDATE public.notifications SET push_sent_at = NULL WHERE type = 'game_invite'$$), 0,
            'nobody reaches anyone else''s notification (row security, unchanged)');
SELECT t.reset();

-- Through a SECURITY DEFINER function a member calls: still refused, the request carries the member's identity.
CREATE FUNCTION t.forge_push_sent(_id uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$
  UPDATE public.notifications SET push_sent_at = now() - interval '1 day' WHERE id = _id $f$;
GRANT EXECUTE ON FUNCTION t.forge_push_sent(uuid) TO authenticated, anon;
SELECT t.as_user(t.id('ana'));
SELECT t.throws(format('SELECT t.forge_push_sent(%L::uuid)', (SELECT id FROM public.notifications WHERE type = 'general')),
                'PUSH_SENT_AT_SERVER_ONLY', 'nor through a SECURITY DEFINER function running as its owner');
SELECT t.reset();
SELECT set_config('t.general_id', (SELECT id::text FROM public.notifications WHERE type = 'general'), true);
SELECT t.as_anon();
SELECT t.throws(format('SELECT t.forge_push_sent(%L::uuid)', current_setting('t.general_id')),
                'PUSH_SENT_AT_SERVER_ONLY', 'nor a signed-out visitor through one');
SELECT t.eq(t.changed($$UPDATE public.notifications SET push_sent_at = NULL$$), 0, 'a visitor updates no notification');
SELECT t.reset();
SELECT t.ok((SELECT push_sent_at IS NULL FROM public.notifications WHERE type = 'general'), 'the forged stamps never landed');

-- ================= 4. only the database's own invite rows reach the sweep =================
-- The sweep's read: invite rows of the last hour that no run took.
CREATE FUNCTION t.sweepable(_user uuid) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.notifications
   WHERE user_id = _user AND type IN ('game_invite', 'game_invite_accepted') AND push_sent_at IS NULL
     AND created_at > now() - interval '1 hour' $f$;
SELECT t.as_user(t.id('mal'));
SELECT t.lives($$INSERT INTO public.notifications (user_id, type, title, link, created_at)
                 SELECT auth.uid(), 'game_invite', 'Planted', 'https://evil.example/x', now() - interval '59 minutes'
                   FROM generate_series(1, 50)$$,
               'a member may still write invite-typed rows of their own, backdated (their in-app list is theirs)');
SELECT t.lives($$INSERT INTO public.notifications (user_id, type, title) VALUES (auth.uid(), 'game_invite_accepted', 'Planted too')$$,
               'and an acceptance-typed one');
SELECT t.lives($$INSERT INTO public.notifications (user_id, type, title) VALUES (auth.uid(), 'general', 'Plain')$$,
               'and a plain one');
SELECT t.lives($$UPDATE public.notifications SET type = 'game_invite', created_at = now() WHERE user_id = auth.uid() AND type = 'general'$$,
               'and turn a plain one into an invite');
SELECT t.reset();
SELECT t.eq(t.sweepable(t.id('mal')), 0, 'but each is stamped as it is stored or changed: the sweep never reads or pushes them');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('mal') AND push_sent_at IS NOT NULL), 52,
            'all 52 rows, which stay in the member''s list');

-- A row a member asks the server for (createNotificationForUser: the service role inserts it, and pushes at once).
SELECT t.as_service();
SELECT t.lives(format($$INSERT INTO public.notifications (user_id, type, title) VALUES (%L, 'game_invite', 'Via the server')$$, t.id('ana')),
               'the service role writes an invite-typed row');
SELECT t.reset();
SELECT t.eq(t.sweepable(t.id('ana')), 0, 'stamped too: only a database invite function''s row is swept (no second push)');

-- Written inside a member's request by a SECURITY DEFINER function, as notify_guardians writes a guardian's copy.
CREATE FUNCTION t.write_invite_for(_user uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$
  INSERT INTO public.notifications (user_id, type, title, link) VALUES (_user, 'game_invite', 'Game invitation for your player', '/parent') $f$;
GRANT EXECUTE ON FUNCTION t.write_invite_for(uuid) TO authenticated;
SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT t.write_invite_for(%L::uuid)', t.id('mal')), 'a function writes a row for another member');
SELECT t.lives(format('SELECT t.write_invite_for(%L::uuid)', t.id('host')),
               'and one for the caller (a host inviting their own child): nothing is refused, the invite goes through');
SELECT t.reset();
SELECT t.eq(t.sweepable(t.id('mal')), 1, 'the row for another member waits for the sweep');
SELECT t.eq(t.sweepable(t.id('host')), 0, 'the caller''s own copy is stamped: no push, the in-app row stays');
SELECT t.as_user(t.id('mal'));
SELECT t.lives($$UPDATE public.notifications SET title = 'Rewritten', link = 'https://evil.example/y'
                  WHERE user_id = auth.uid() AND push_sent_at IS NULL$$,
               'the recipient may rewrite their own row');
SELECT t.reset();
SELECT t.eq(t.sweepable(t.id('mal')), 0, 'but then it is stamped: a push only ever says what the database wrote');

-- The database itself (migrations, an operator) is the server too.
SELECT t.lives($$UPDATE public.notifications SET push_sent_at = NULL WHERE type = 'game_invite'$$, 'the server may clear a stamp');

-- ================= 5. an invitation the app would no longer allow gets no push =================
-- public.invite_pushes_allowed: the sweep asks again what game_invite_player asked when it wrote the row. Every invitation
-- below is made through game_invite_player itself, then changed through the path a real change takes.
SELECT t.ok((SELECT p.prosecdef AND p.proconfig = ARRAY['search_path=""']
               FROM pg_proc p WHERE p.oid = 'public.invite_pushes_allowed(uuid[])'::regprocedure),
            'the invitation check is SECURITY DEFINER with an empty search_path');
SELECT t.ok(has_function_privilege('service_role', 'public.invite_pushes_allowed(uuid[])', 'EXECUTE')
            AND NOT has_function_privilege('authenticated', 'public.invite_pushes_allowed(uuid[])', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.invite_pushes_allowed(uuid[])', 'EXECUTE'),
            'only the service role may call it');

SELECT t.person('ben', 30), t.person('cal', 31), t.person('dee', 32), t.person('eve', 33), t.person('fay', 34),
       t.person('gus', 29), t.person('hob', 45), t.person('mom', 42), t.person('kidm', 16), t.person('kidg', 16);
SELECT t.guardian('mom', 'kidm'), t.guardian('mom', 'kidg');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players, timezone) VALUES
  ('gok',  t.id('host'), 'basketball', 'Still on',       now() + interval '3 days', 20, 'America/New_York'),
  ('gcan', t.id('host'), 'basketball', 'Called off',     now() + interval '3 days', 10, 'America/New_York'),
  ('ghid', t.id('host'), 'basketball', 'Reported run',   now() + interval '3 days', 10, 'America/New_York'),
  ('gban', t.id('hob'),  'basketball', 'Banned host',    now() + interval '3 days', 10, 'America/New_York'),
  ('gfam', t.id('mom'),  'basketball', 'Family shootaround', now() + interval '3 days', 10, 'America/New_York');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
SELECT id, host_id, 0, true FROM public.hosted_games WHERE id IN ('gok', 'gcan', 'ghid', 'gban', 'gfam');
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, timezone, last_confirmed_at)
SELECT md5('post:' || h)::uuid, t.id(h), ARRAY['Basketball'], 'All Levels', 'open',
       '[{"weekday":2,"start":"18:00","end":"20:00"}]'::jsonb, 'America/New_York', now()
  FROM unnest(ARRAY['ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'kidm', 'kidg']) h;
SET LOCAL session_replication_role = origin;

SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT public.game_invite_player(%L, %L::uuid), public.game_invite_player(%L, %L::uuid), '
                      'public.game_invite_player(%L, %L::uuid), public.game_invite_player(%L, %L::uuid), '
                      'public.game_invite_player(%L, %L::uuid)',
                      'gok', t.id('ben'), 'gcan', t.id('cal'), 'ghid', t.id('dee'), 'gok', t.id('fay'), 'gok', t.id('gus')),
               'the host invites ben, cal, dee, fay and gus');
SELECT t.reset();
SELECT t.as_user(t.id('hob'));
SELECT t.lives(format('SELECT public.game_invite_player(%L, %L::uuid)', 'gban', t.id('eve')), 'another host invites eve');
SELECT t.reset();
SELECT t.as_user(t.id('mom'));
SELECT t.lives(format('SELECT public.game_invite_player(%L, %L::uuid), public.game_invite_player(%L, %L::uuid)',
                      'gfam', t.id('kidm'), 'gfam', t.id('kidg')),
               'a guardian hosting a game invites her two 16-year-olds');
SELECT t.reset();

CREATE FUNCTION t.push_allowed() RETURNS text LANGUAGE plpgsql AS $f$
DECLARE _got text;
BEGIN
  PERFORM t.as_service();
  SELECT string_agg(p.handle, ',' ORDER BY p.handle) INTO _got
    FROM public.invite_pushes_allowed(ARRAY(SELECT id FROM public.game_invites)) a
    JOIN (SELECT t.id(h) AS uid, h AS handle
            FROM unnest(ARRAY['ben', 'cal', 'dee', 'eve', 'fay', 'gus', 'kidm', 'kidg', 'ana']) h) p ON p.uid = a.invitee_id;
  PERFORM t.reset();
  RETURN _got;
END $f$;
SELECT t.eq(t.push_allowed(), 'ben,cal,dee,eve,fay,gus,kidg,kidm',
            'as written, every pending invitation may be pushed (ana''s, already accepted, may not)');
SELECT t.ok((SELECT count(*) = 8 FROM public.notifications n
              WHERE n.type = 'game_invite' AND n.link LIKE '%inv=%' AND n.push_sent_at IS NULL
                AND n.user_id IN (t.id('ben'), t.id('cal'), t.id('dee'), t.id('eve'), t.id('fay'), t.id('gus'),
                                  t.id('kidm'), t.id('kidg'))),
            'and each invitee''s row waits for the sweep');

-- Now each changes the way it would in the app, and none of these changes the invitation's status.
SELECT t.as_user(t.id('host'));
SELECT t.lives($$SELECT public.host_cancel_game('gcan', 'Gym closed')$$, 'the host cancels a game (host_cancel_game)');
SELECT t.reset();
SELECT t.as_service();
SELECT t.lives($$UPDATE public.hosted_games SET hidden_at = now() WHERE id = 'ghid'$$,
               'a moderator removes a reported game (remove_content: hidden_at)');
SELECT t.lives(format($$UPDATE public.profiles SET suspended_at = now(), moderation_state = 'banned' WHERE id = %L$$, t.id('hob')),
               'a moderator bans a host (ban)');
SELECT t.reset();
SELECT t.as_user(t.id('fay'));
SELECT t.lives(format($$INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (auth.uid(), %L)$$, t.id('host')),
               'fay blocks the host');
SELECT t.reset();
SELECT t.as_user(t.id('gus'));
SELECT t.lives(format('SELECT public.game_respond_invite(%L::uuid, false)',
                      (SELECT id FROM public.game_invites WHERE invitee_id = t.id('gus'))), 'gus declines');
SELECT t.reset();
SELECT t.as_user(t.id('mom'));
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"messaging":"off"}'::jsonb)$q$, t.id('kidm')),
               'the guardian turns one child''s messaging off (set_child_controls)');
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"game_participation":false}'::jsonb)$q$, t.id('kidg')),
               'and the other child''s games off');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(status, ',' ORDER BY status) FROM public.game_invites
              WHERE invitee_id IN (t.id('cal'), t.id('dee'), t.id('eve'), t.id('fay'), t.id('kidm'), t.id('kidg'))),
            'pending,pending,pending,pending,pending,pending', 'every one of those invitations is still pending');
SELECT t.eq(t.push_allowed(), 'ben',
            'but only ben''s may still be pushed: not for a cancelled game, a hidden game, a banned host, a block, a declined '
              || 'invitation, a child whose messaging or games the guardian turned off');

-- The age range is asked again too.
SELECT t.lives($$UPDATE public.hosted_games SET min_age = 40 WHERE id = 'gok'$$, 'the game''s age range changes');
SELECT t.eq(t.push_allowed(), NULL, 'and ben''s no longer fits it');
SELECT t.lives($$UPDATE public.hosted_games SET min_age = NULL WHERE id = 'gok'$$, 'restored');

SELECT t.as_user(t.id('ben'));
SELECT t.throws(format('SELECT * FROM public.invite_pushes_allowed(ARRAY[%L::uuid])',
                       (SELECT id FROM public.game_invites WHERE invitee_id = t.id('ben'))),
                'permission denied', 'a member cannot ask it');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT * FROM public.invite_pushes_allowed(ARRAY[]::uuid[])$$, 'permission denied', 'nor a visitor');
SELECT t.reset();
ROLLBACK;
