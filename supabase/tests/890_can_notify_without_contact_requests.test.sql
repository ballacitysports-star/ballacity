-- Migration 20261119120000: an availability contact request no longer makes can_notify true. The other relationships still do,
-- the helper is still contained (a signed-in client asking about others gets the fixed answer), and nothing else moved.
BEGIN;
SELECT t.person('poster', 30), t.person('asker', 31), t.person('inviter', 32), t.person('host', 38), t.person('player', 27),
       t.person('chatter', 29), t.person('stranger', 33);
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, recurring_days, city, travel_radius_km, note, status, time_slots) VALUES
  ('00000000-0000-0000-0000-0000000089a1', t.id('poster'), ARRAY['Basketball'], 'All Levels', ARRAY['Mon'], 'Atlanta', 10, 'Pickup runs', 'open', '[]'::jsonb);
INSERT INTO public.availability_contact_requests (availability_id, from_user_id, to_user_id, kind, status, message) VALUES
  ('00000000-0000-0000-0000-0000000089a1', t.id('asker'), t.id('poster'), 'contact', 'pending', 'Want to run?'),
  ('00000000-0000-0000-0000-0000000089a1', t.id('inviter'), t.id('poster'), 'invite', 'accepted', 'Come play');
INSERT INTO public.hosted_games (id, host_id, sport, title, date, location, max_players) VALUES
  ('host-cn890-game1', t.id('host'), 'basketball', 'Run', now() + interval '2 days', 'Gym', 10);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('host-cn890-game1', t.id('player'));
INSERT INTO public.conversations (id, created_by) VALUES ('00000000-0000-0000-0000-0000000089c1', t.id('chatter'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000089c1', t.id('chatter')), ('00000000-0000-0000-0000-0000000089c1', t.id('poster'));
SET LOCAL session_replication_role = origin;

-- ---- the definition: the clause is gone, nothing else moved
SELECT t.ok(to_regprocedure('private_sec.can_notify(uuid,uuid)') IS NOT NULL, 'the original still lives under private_sec');
SELECT t.eq((SELECT p.prosrc LIKE '%availability_contact_requests%' FROM pg_proc p WHERE p.oid = 'private_sec.can_notify(uuid,uuid)'::regprocedure), false,
            'private_sec.can_notify no longer reads availability_contact_requests');
SELECT t.eq((SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public'] FROM pg_proc p WHERE p.oid = 'private_sec.can_notify(uuid,uuid)'::regprocedure), true,
            'still SECURITY DEFINER, STABLE, search_path public');
SELECT t.eq((SELECT NOT p.prosecdef AND p.prosrc LIKE '%private_sec.rpc_probe_denied%' FROM pg_proc p WHERE p.oid = 'public.can_notify(uuid,uuid)'::regprocedure), true,
            'public.can_notify is still the containment wrapper');
SELECT t.eq(has_function_privilege('anon', 'public.can_notify(uuid,uuid)', 'EXECUTE'), false, 'anonymous still cannot call it');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.can_notify(uuid,uuid)', 'EXECUTE')
            AND has_function_privilege('service_role', 'private_sec.can_notify(uuid,uuid)', 'EXECUTE'), true,
            'the private copy kept its grants (CREATE OR REPLACE, not DROP)');

-- ---- the answers, as the server (and any definer code) gets them
SELECT t.as_service();
SELECT t.eq(public.can_notify(t.id('asker'), t.id('poster')), false, 'a contact request no longer lets its sender notify the post''s author');
SELECT t.eq(public.can_notify(t.id('poster'), t.id('asker')), false, 'nor the author notify the sender');
SELECT t.eq(public.can_notify(t.id('inviter'), t.id('poster')), false, 'nor does an accepted invite request, in either direction');
SELECT t.eq(public.can_notify(t.id('poster'), t.id('inviter')), false, 'either way round');
SELECT t.eq(public.can_notify(t.id('host'), t.id('player')), true, 'a host and their player still can');
SELECT t.eq(public.can_notify(t.id('player'), t.id('host')), true, 'and the other way');
SELECT t.eq(public.can_notify(t.id('chatter'), t.id('poster')), true, 'people in one conversation still can');
SELECT t.eq(public.can_notify(t.id('asker'), t.id('asker')), true, 'anyone can notify themselves');
SELECT t.eq(public.can_notify(t.id('stranger'), t.id('poster')), false, 'an unrelated pair still cannot');
SELECT t.eq(public.can_notify(NULL, t.id('poster')), false, 'no caller, no answer');
SELECT t.reset();
-- Definer code calling it by the private name sees the same logic.
SELECT t.eq(private_sec.can_notify(t.id('asker'), t.id('poster')), false, 'the private copy answers the same');
SELECT t.eq(private_sec.can_notify(t.id('host'), t.id('player')), true, 'including the relationships that remain');

-- ---- a signed-in client still learns nothing about others
SELECT t.as_user(t.id('player'));
SELECT set_config('request.path', '/rpc/can_notify', true);
SELECT t.eq((SELECT public.can_notify(t.id('player'), t.id('host'))), false, 'a signed-in client asking about another person still gets the fixed answer');
SELECT set_config('request.path', '', true);
SELECT t.reset();

ROLLBACK;
