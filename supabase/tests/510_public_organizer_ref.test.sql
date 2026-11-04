-- SEC-5 (approval C, D-5): a minor host's account id is not reachable from a public game, and two of their games are not linkable.
-- Phase 1 (20261108110000) adds the masked read paths; phase 2 (supabase/phase2/sec5_phase2_close_host_id_columns.sql, applied here inside
-- this rolled-back transaction) closes the direct columns. The sweep (t.leaks) reads EVERY table and view in public and storage that the
-- current role can select, column by column, and names each one where some readable value contains the given text.
BEGIN;
-- the platform grants Storage tables to the API roles (the stub does not); as in 130 and 445
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, anon, service_role;
SELECT t.person('teen', 17), t.person('teentwo', 16), t.person('mom', 45), t.person('grown', 35), t.person('stranger', 33),
       t.person('asker', 28), t.person('pal', 30), t.person('mate', 31), t.person('modr', 39), t.person('payer', 27);
SELECT t.guardian('mom', 'teen');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modr'), 'moderator');
INSERT INTO public.privacy_preferences (user_id, profile_visibility) VALUES (t.id('teen'), 'private'), (t.id('teentwo'), 'private')
  ON CONFLICT (user_id) DO UPDATE SET profile_visibility = 'private';
SELECT t.team('sharedteam', 'grown'); SELECT t.member('sharedteam', 'teen'); SELECT t.member('sharedteam', 'mate');

-- Three youth-inclusive games with identical content: two by the same minor host, one by another minor host. Written as the platform
-- (replica role) so the hosting-approval rules, which other tests cover, do not need an approval fixture here.
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, neighborhood, min_age, max_age, image, host_snapshot, created_at, updated_at)
SELECT gid, t.id(host), 'basketball', 'Youth run', '2030-01-01 18:00+00', 'Gym', 'North', 13, NULL,
       'storage://game-covers/' || t.id(host) || '/cover.jpg', '{"name":"Youth host","neutral":true}'::jsonb, '2029-12-01 10:00+00', '2029-12-01 10:00+00'
  FROM (VALUES ('tg1', 'teen'), ('tg2', 'teen'), ('tg3', 'teentwo')) v(gid, host);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, min_age, max_age, price, image, host_snapshot) VALUES
  ('ag1', t.id('grown'), 'basketball', 'Adult run', now() + interval '3 days', 'Gym', 18, NULL, 10, 'storage://game-covers/' || t.id('grown') || '/a.jpg', '{"name":"Grown"}'),
  ('ag2', t.id('grown'), 'basketball', 'Family run', now() + interval '3 days', 'Gym', 10, NULL, 0, '', '{"name":"Grown"}');
INSERT INTO public.game_participants (game_id, user_id) VALUES ('tg1', t.id('pal')), ('ag2', t.id('pal'));
SET LOCAL session_replication_role = origin;
INSERT INTO storage.objects (bucket_id, name, owner) VALUES
  ('game-covers', t.id('teen') || '/cover.jpg', t.id('teen')), ('game-covers', t.id('grown') || '/a.jpg', t.id('grown'));
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('ag1', t.id('grown'), 10, false);

-- Every relation in public/storage the current role can read, with each readable column cast to text, searched for _needle.
CREATE FUNCTION t.leaks(_needle text) RETURNS text[] LANGUAGE plpgsql AS $$
DECLARE r record; _expr text; _hit boolean; _out text[] := '{}';
BEGIN
  FOR r IN SELECT c.oid, n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname IN ('public', 'storage') AND c.relkind IN ('r', 'v', 'm', 'p') ORDER BY 2, 3 LOOP
    SELECT string_agg(format('%I::text', a.attname), ', ') INTO _expr
      FROM pg_attribute a
     WHERE a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped AND has_column_privilege(r.oid, a.attnum, 'SELECT');
    CONTINUE WHEN _expr IS NULL;
    BEGIN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I.%I x WHERE concat_ws(''|'', %s) LIKE %L)', r.nspname, r.relname, _expr, '%' || _needle || '%')
        INTO _hit;
    EXCEPTION WHEN OTHERS THEN
      _out := _out || ('error reading ' || r.nspname || '.' || r.relname || ': ' || SQLERRM);
      CONTINUE;
    END;
    IF _hit THEN _out := _out || (r.nspname || '.' || r.relname); END IF;
  END LOOP;
  RETURN _out;
END $$;
GRANT EXECUTE ON FUNCTION t.leaks(text) TO PUBLIC;

-- A join request from a stranger, without naming the host (the database fills it in), and one naming the WRONG host.
SELECT t.as_user(t.id('asker'));
SELECT t.lives($q$INSERT INTO public.join_requests (game_id, player_id, idempotency_key) VALUES ('tg1', auth.uid(), 'k510a')$q$,
  'a player can ask to join without knowing who hosts the game');
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('tg2', auth.uid(), %L, 'k510b')$q$, t.id('grown')),
  'naming the wrong host is no longer refused (the insert is not a yes/no test of who the host is)');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.join_requests WHERE player_id = t.id('asker') AND host_id = t.id('teen')), 2,
  'both requests are stored with the real host (internal key kept)');

-- ===================================================================================================== phase 1: the public path
SELECT t.as_user(t.id('stranger'));
SELECT t.ok((SELECT host_id IS NULL AND image = '' AND organizer_hidden AND NOT viewer_is_host AND hosting_approval_id IS NULL AND organizer_ref IS NOT NULL
               FROM public.hosted_games_public WHERE id = 'tg1'),
  'a stranger gets no host id, no cover path and no approval id for a minor-hosted game, only the per-game organizer_ref');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games_public WHERE id IN ('tg1', 'tg2', 'tg3')), 3, 'the youth games themselves are still listed (discovery)');
SELECT t.eq((SELECT count(DISTINCT organizer_ref)::int FROM public.hosted_games_public WHERE id IN ('tg1', 'tg2', 'tg3')), 3, 'organizer_ref differs per game');
SELECT t.ok((SELECT count(DISTINCT to_jsonb(v) - 'id' - 'organizer_ref')::int = 1 FROM public.hosted_games_public v WHERE id IN ('tg1', 'tg2', 'tg3')),
  'two games by the same minor host look exactly like a game by another minor host: no public field links them');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games_public WHERE host_id = t.id('teen')), 0, 'filtering the view by the minor''s id finds nothing');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games_public WHERE image LIKE '%' || t.id('teen') || '%'), 0, 'nor does searching the cover path');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_organizer('tg1') o WHERE o.kind = 'neutral' AND o.display_name IS NULL), 1, 'get_game_organizer stays neutral for a stranger');
SELECT t.ok((SELECT host_id = t.id('grown') AND image LIKE '%/a.jpg' AND NOT organizer_hidden FROM public.hosted_games_public WHERE id = 'ag1'),
  'an adult host is unaffected: id and cover as before (adult-only game)');
SELECT t.ok((SELECT host_id = t.id('grown') AND NOT organizer_hidden FROM public.hosted_games_public WHERE id = 'ag2'), 'and on a youth-inclusive game');
SELECT t.eq(t.count($$SELECT 1 FROM public.join_requests_visible$$), 0, 'a stranger sees no join requests');
SELECT t.reset();

SELECT t.as_anon();
SELECT t.ok((SELECT host_id = t.id('grown') FROM public.hosted_games_public WHERE id = 'ag1'), 'anonymous visitors read the view (adult listing unchanged)');
SELECT t.eq(t.count($$SELECT 1 FROM public.hosted_games_public WHERE id IN ('tg1','tg2','ag2')$$), 0, 'and still see no youth-inclusive game');
SELECT t.reset();

SELECT t.as_user(t.id('asker'));
SELECT t.ok((SELECT bool_and(host_id IS NULL AND NOT viewer_is_host) FROM public.join_requests_visible WHERE player_id = auth.uid()),
  'a requester''s own requests through join_requests_visible carry no host id');
SELECT t.eq(t.count($$SELECT 1 FROM public.join_requests_visible WHERE player_id = auth.uid()$$), 2, 'but the requests are all there');
SELECT t.ok((SELECT host_id IS NULL FROM public.hosted_games_public WHERE id = 'tg1'), 'asking to join does not make the requester related');
SELECT t.reset();

-- the people who may know: the host, a guardian, staff, the roster, a teammate
SELECT t.as_user(t.id('teen'));
SELECT t.ok((SELECT host_id = t.id('teen') AND viewer_is_host AND NOT organizer_hidden AND image LIKE '%/cover.jpg' FROM public.hosted_games_public WHERE id = 'tg1'),
  'the host sees their own id, cover and viewer_is_host');
SELECT t.eq((SELECT count(*)::int FROM public.hosted_games_public WHERE viewer_is_host), 2, 'viewer_is_host lists exactly their games ("my games")');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests_visible WHERE viewer_is_host AND host_id = auth.uid()), 2, 'and the requests for them');
SELECT t.reset();
SELECT t.as_user(t.id('mom'));
SELECT t.ok((SELECT host_id = t.id('teen') FROM public.hosted_games_public WHERE id = 'tg1'), 'a verified guardian sees the host');
SELECT t.reset();
SELECT t.as_user(t.id('modr'));
SELECT t.ok((SELECT host_id = t.id('teen') FROM public.hosted_games_public WHERE id = 'tg2'), 'a moderator sees the host');
SELECT t.reset();
SELECT t.as_user(t.id('pal'));
SELECT t.ok((SELECT host_id = t.id('teen') AND image LIKE '%/cover.jpg' FROM public.hosted_games_public WHERE id = 'tg1'), 'a player on the roster sees the host and the cover');
SELECT t.reset();
SELECT t.as_user(t.id('mate'));
SELECT t.ok((SELECT host_id = t.id('teen') FROM public.hosted_games_public WHERE id = 'tg1'), 'a teammate (shares a team) sees the host');
SELECT t.reset();

-- organizer_ref is the database's choice
SELECT t.as_user(t.id('teen'));
SELECT t.eq(t.changed(format($q$UPDATE public.hosted_games SET organizer_ref = %L WHERE id = 'tg1'$q$, gen_random_uuid())), 1, 'the host may send an organizer_ref...');
SELECT t.reset();
SELECT t.ok((SELECT g1.organizer_ref <> g2.organizer_ref FROM public.hosted_games g1, public.hosted_games g2 WHERE g1.id = 'tg1' AND g2.id = 'tg2'), '...but it never changes');
SELECT t.as_user(t.id('grown'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, organizer_ref) VALUES ('ag3', auth.uid(), 'basketball', 'X', now() + interval '2 days', 'Gym', %L)$q$,
  (SELECT organizer_ref FROM public.hosted_games WHERE id = 'ag1')), 'a new game with a chosen organizer_ref is accepted');
SELECT t.reset();
SELECT t.ok((SELECT a3.organizer_ref <> a1.organizer_ref FROM public.hosted_games a1, public.hosted_games a3 WHERE a1.id = 'ag1' AND a3.id = 'ag3'), 'and gets its own random value instead');

-- payments keep working (the payee is never read from the masked columns)
SELECT t.as_user(t.id('payer'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, status) VALUES (%L, auth.uid(), 'ag1', %L, 'pending')$q$, t.id('sub510'), t.id('grown')),
  'a player pays an adult host as before');
SELECT t.reset();

-- what still carries the id before phase 2: exactly the base columns phase 2 closes, and the cover listing
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.leaks(t.id('teen')::text), ARRAY['public.hosted_games', 'storage.objects'],
  'BEFORE phase 2: for a stranger, only hosted_games (host_id, image) and the cover listing still carry the minor''s id');
SELECT t.reset();
SELECT t.as_user(t.id('asker'));
SELECT t.eq(t.leaks(t.id('teen')::text), ARRAY['public.hosted_games', 'public.join_requests', 'storage.objects'],
  'BEFORE phase 2: for a requester, also their own join_requests.host_id');
SELECT t.reset();
SELECT t.as_anon();
CREATE TEMP TABLE anon_before ON COMMIT DROP AS SELECT t.leaks(t.id('teen')::text) AS l;
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM anon_before, unnest(l) x WHERE x NOT LIKE 'error reading %'), 0,
  'anonymous visitors cannot reach the minor''s id even before phase 2 (no youth game is listed to them)');

-- ===================================================================================================== phase 2, applied in this transaction
\ir ../phase2/sec5_phase2_close_host_id_columns.sql

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.leaks(t.id('teen')::text), '{}'::text[], 'AFTER phase 2: no table or view a stranger can read contains the minor host''s id');
SELECT t.throws($$SELECT host_id FROM public.hosted_games WHERE id = 'tg1'$$, 'permission denied', 'the direct column is closed');
SELECT t.throws($$SELECT * FROM public.hosted_games WHERE id = 'ag1'$$, 'permission denied', 'select * on the table is refused (clients use the view)');
SELECT t.throws($$SELECT id FROM public.hosted_games WHERE host_id = '00000000-0000-0000-0000-000000000000'$$, 'permission denied', 'and so is filtering on it');
SELECT t.eq(t.count($$SELECT id, title, date FROM public.hosted_games WHERE id IN ('tg1','tg2','ag1')$$), 3, 'every other column is still readable');
SELECT t.ok((SELECT host_id = t.id('grown') FROM public.hosted_games_public WHERE id = 'ag1'), 'the view still gives an adult host');
SELECT t.ok((SELECT host_id IS NULL FROM public.hosted_games_public WHERE id = 'tg1'), 'and still hides the minor host');
SELECT t.eq(t.count(format($$SELECT 1 FROM storage.objects WHERE bucket_id = 'game-covers' AND name LIKE %L$$, t.id('teen') || '%')), 0, 'the minor''s cover folder is not listable');
SELECT t.eq(t.count(format($$SELECT 1 FROM storage.objects WHERE bucket_id = 'game-covers' AND name LIKE %L$$, t.id('grown') || '%')), 1, 'an adult host''s cover still is (signing unchanged)');
SELECT t.lives($q$INSERT INTO public.join_requests (game_id, player_id, idempotency_key) VALUES ('ag2', auth.uid(), 'k510c')$q$, 'a player can still ask to join');
SELECT t.reset();
SELECT t.as_user(t.id('asker'));
SELECT t.eq(t.leaks(t.id('teen')::text), '{}'::text[], 'AFTER phase 2: nor any object a requester can read');
SELECT t.throws($$SELECT host_id FROM public.join_requests$$, 'permission denied', 'join_requests.host_id is closed');
SELECT t.eq(t.count($$SELECT id, game_id, status FROM public.join_requests$$), 2, 'the rest of their requests is readable');
SELECT t.reset();
SELECT t.as_anon();
CREATE TEMP TABLE anon_after ON COMMIT DROP AS SELECT t.leaks(t.id('teen')::text) AS l;
SELECT t.reset();
SELECT t.eq((SELECT l FROM anon_after), (SELECT l FROM anon_before),
  'AFTER phase 2: nothing new for an anonymous visitor (no hit, and no read that worked before now fails)');
SELECT t.as_anon();
SELECT t.ok((SELECT host_id = t.id('grown') FROM public.hosted_games_public WHERE id = 'ag1'), 'anonymous discovery still works');
SELECT t.reset();

-- the related paths still work after phase 2
SELECT t.as_user(t.id('teen'));
SELECT t.ok((SELECT host_id = t.id('teen') AND viewer_is_host AND image LIKE '%/cover.jpg' FROM public.hosted_games_public WHERE id = 'tg1'), 'AFTER: the host still reads their own game');
SELECT t.eq(t.count(format($$SELECT 1 FROM storage.objects WHERE bucket_id = 'game-covers' AND name LIKE %L$$, t.id('teen') || '%')), 1, 'and their own cover');
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET title = 'Youth run two' WHERE id = 'tg2'$$), 1, 'and edits it (UPDATE by id, policies use host_id)');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests_visible WHERE viewer_is_host), 2, 'and reads the requests for their games');
SELECT t.reset();
SELECT t.as_user(t.id('pal'));
SELECT t.eq(t.count(format($$SELECT 1 FROM storage.objects WHERE bucket_id = 'game-covers' AND name LIKE %L$$, t.id('teen') || '%')), 1, 'AFTER: a rostered player still signs the cover');
SELECT t.ok((SELECT host_id = t.id('teen') FROM public.hosted_games_public WHERE id = 'tg1'), 'and sees the host');
SELECT t.reset();
SELECT t.as_user(t.id('mom'));
SELECT t.ok((SELECT host_id = t.id('teen') FROM public.hosted_games_public WHERE id = 'tg2'), 'AFTER: the guardian still sees the host');
SELECT t.reset();
SELECT t.as_user(t.id('grown'));
SELECT t.eq(t.count($$SELECT 1 FROM public.game_participants WHERE game_id = 'ag2'$$), 1, 'AFTER: a host still reads their roster (policy subquery on host_id)');
SELECT t.eq((SELECT count(*)::int FROM public.join_requests_visible WHERE viewer_is_host AND game_id = 'ag2'), 1, 'and the requests for their games');
SELECT t.lives($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, location) VALUES ('ag4', auth.uid(), 'basketball', 'New', now() + interval '2 days', 'Gym')$q$,
  'and creates a game');
SELECT t.throws($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, location) VALUES ('ag4', auth.uid(), 'basketball', 'Again', now() + interval '2 days', 'Gym')
                   ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, host_id = EXCLUDED.host_id$q$, 'permission denied',
  'an upsert naming host_id needs SELECT on it (the client claim path no longer upserts)');
SELECT t.eq(t.changed($$DELETE FROM public.hosted_games WHERE id = 'ag4'$$), 1, 'and deletes a game');
SELECT t.eq(t.count($$SELECT 1 FROM public.payment_submissions WHERE game_id = 'ag1'$$), 1, 'and sees the payment for their game');
SELECT t.reset();
SELECT t.as_user(t.id('payer'));
SELECT t.lives(format($q$UPDATE public.payment_submissions SET notes = 'sent' WHERE id = %L$q$, t.id('sub510')), 'AFTER: the payer still updates their proof');
SELECT t.reset();
SELECT t.as_user(t.id('modr'));
SELECT t.ok((SELECT host_id = t.id('teen') FROM public.hosted_games_public WHERE id = 'tg1'), 'AFTER: a moderator still sees the host');
SELECT t.reset();
SELECT t.as_service();
SELECT t.eq(t.changed($$UPDATE public.hosted_games SET hidden_at = now() WHERE id = 'tg3'$$), 1, 'AFTER: moderation actions through the service role are unaffected');
SELECT t.ok((SELECT host_id = t.id('teentwo') FROM public.hosted_games WHERE id = 'tg3'), 'and server code still reads host_id');
SELECT t.reset();
SELECT t.ok(NOT has_column_privilege('authenticated', 'public.hosted_games', 'host_id', 'SELECT')
            AND has_column_privilege('authenticated', 'public.hosted_games', 'host_id', 'INSERT'),
  'AFTER: realtime (which drops columns the subscriber cannot SELECT) no longer carries host_id; inserting it stays allowed');

-- drift: every hosted_games column (except the two masked ones) is in the view, so select=* on the view returns the whole game
SELECT t.eq((SELECT count(*)::int FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'hosted_games'
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns v WHERE v.table_schema = 'public' AND v.table_name = 'hosted_games_public' AND v.column_name = c.column_name)),
  0, 'hosted_games_public has every hosted_games column (add a new column to the view too)');
SELECT t.eq((SELECT count(*)::int FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'join_requests'
               AND NOT EXISTS (SELECT 1 FROM information_schema.columns v WHERE v.table_schema = 'public' AND v.table_name = 'join_requests_visible' AND v.column_name = c.column_name)),
  0, 'join_requests_visible has every join_requests column');
SELECT t.ok((SELECT bool_and(c.reloptions @> ARRAY['security_invoker=true']) FROM pg_class c WHERE c.oid IN ('public.hosted_games_public'::regclass, 'public.join_requests_visible'::regclass)),
  'both views run as the caller, so the table''s row security decides which rows come back');
ROLLBACK;
