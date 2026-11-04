-- R7: one authorization policy for conversations, messages, contact requests and notifications involving a minor or a person of unknown age.
BEGIN;
SELECT t.person('stranger', 35), t.person('coach', 38), t.person('host', 37), t.person('adultpost', 30), t.person('gmom', 41), t.person('gdad', 42),
       t.person('kid', 10), t.person('t14', 14), t.person('t16', 16), t.person('t15b', 15), t.person('t17u', 17), t.person('t16u', 16), t.person('unk', 30),
       t.person('modone', 39);
SELECT t.guardian('gmom', 'kid'); SELECT t.guardian('gmom', 't14'); SELECT t.guardian('gmom', 't16'); SELECT t.guardian('gdad', 't15b');
SET LOCAL session_replication_role = replica;
UPDATE public.profiles SET age_cohort = 'unknown' WHERE id = t.id('unk');
SET LOCAL session_replication_role = origin;
SELECT t.team('squad', 'coach');
SELECT t.member('squad', 't16');
SELECT t.member('squad', 't14');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('pub', t.id('host'), 'basketball', 'Open run', now() + interval '2 days', 12, 17, 'Gym', 'North', '{"name":"Host"}'::jsonb);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('pub', t.id('stranger')), ('pub', t.id('t14')), ('pub', t.id('t15b')), ('pub', t.id('t16'));
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, recurring_days, city, travel_radius_km, status, time_slots) VALUES
  ('00000000-0000-0000-0000-0000000000b1', t.id('adultpost'), ARRAY['Basketball'], 'All Levels', ARRAY['Mon'], 'Atlanta', 10, 'open', '[]'::jsonb),
  ('00000000-0000-0000-0000-0000000000b2', t.id('t16'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue'], 'Atlanta', 10, 'open', '[]'::jsonb),
  ('00000000-0000-0000-0000-0000000000b3', t.id('t15b'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue'], 'Atlanta', 10, 'open', '[]'::jsonb);
SET LOCAL session_replication_role = origin;
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id IN (t.id('kid'), t.id('t14'), t.id('t16'), t.id('t15b'));

CREATE FUNCTION t.dm(who text, other text) RETURNS text LANGUAGE sql AS $f$ SELECT public.minor_messaging_block(t.id(who), t.id(other)) $f$;
GRANT EXECUTE ON FUNCTION t.dm(text, text) TO anon, authenticated;

-- ================= 1. a stranger adult never reaches a minor (E1, E3, E4)
SELECT t.eq(t.dm('stranger', 'kid'), 'child_needs_guardian:other', 'under 13');
SELECT t.eq(t.dm('stranger', 't14'), 'needs_connection:other', '13-15, even though they share a public game and the guardian chose peers (E4, E3)');
SELECT t.eq(t.dm('stranger', 't16'), 'needs_connection:other', '16-17 with the guardian peers setting (E3)');
SELECT t.eq(t.dm('stranger', 't17u'), 'needs_guardian_link:other', 'an unlinked 16-17: ask them to link a guardian (E1)');
SELECT t.eq(t.dm('stranger', 't16u'), 'needs_guardian_link:other', 'an unlinked 16 year old');
SELECT t.eq(t.dm('stranger', 'unk'), 'needs_guardian_link:other', 'an unknown age fails closed');
SELECT t.eq(t.dm('t17u', 'stranger'), 'needs_guardian_link:self', 'and the other direction names the minor''s side');
SELECT t.ok(t.dm('stranger', 'adultpost') IS NULL, 'adult to adult is unchanged');

-- ================= 2. authorized contexts
SELECT t.ok(t.dm('gmom', 'kid') IS NULL, 'a verified guardian and their child');
SELECT t.eq(t.dm('gdad', 'kid'), 'child_needs_guardian:other', 'another family''s guardian');
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('t16');
SELECT t.ok(t.dm('coach', 't16') IS NULL, 'a coach and a player of the same team');
SELECT t.eq(t.dm('coach', 't15b'), 'needs_connection:other', 'but not a player of another team');
SELECT t.ok(t.dm('host', 't14') IS NULL, 'a game''s host and a confirmed participant');
SELECT t.eq(t.dm('stranger', 't14'), 'needs_connection:other', 'a co-participant adult is still a stranger');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('t16');

-- ================= 3. minors with each other (E2)
SELECT t.ok(t.dm('t16', 't15b') IS NULL, 'two minors whose guardians both chose peers and who share a confirmed game');
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('t15b');
SELECT t.eq(t.dm('t16', 't15b'), 'teammates_only:other', 'the other guardian''s stricter setting wins');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('t15b');
SELECT t.ok(t.dm('t16', 't14') IS NULL, 'teammates of the same team');
SELECT t.eq(t.dm('t16u', 't17u'), 'needs_guardian_link:self', 'two unlinked minors cannot');
SELECT t.eq(t.dm('t14', 't17u'), 'needs_guardian_link:other', 'a linked minor and an unlinked one cannot');

-- ================= 4. conversations, messages, revocation, history
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('t16')), 'MINOR_MESSAGING_BLOCKED:needs_connection', 'creation is refused');
SELECT t.as_user(t.id('coach'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('t16')), 'a coach can open a conversation with a player of their team');
SELECT t.reset();
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('t16');
SELECT t.as_user(t.id('coach'));
SELECT t.lives($q$INSERT INTO public.messages (conversation_id, sender_id, body) SELECT conversation_id, t.id('coach'), 'practice at 6' FROM public.conversation_participants WHERE user_id = t.id('t16') LIMIT 1$q$, 'and send');
SELECT t.reset();
DELETE FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('t16');
SELECT t.as_user(t.id('coach'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) SELECT conversation_id, t.id('coach'), 'still there?' FROM public.conversation_participants WHERE user_id = t.id('t16') LIMIT 1$q$, 'MINOR_MESSAGING_BLOCKED', 'when the context ends (removed from the team) the next message is refused');
SELECT t.eq(t.count($$SELECT 1 FROM public.messages WHERE body = 'practice at 6'$$), 1, 'but the history stays readable to the coach');
SELECT t.as_user(t.id('t16'));
SELECT t.eq(t.count($$SELECT 1 FROM public.messages WHERE body = 'practice at 6'$$), 1, 'and to the player');
SELECT t.reset();

-- ================= 5. contact requests: the guardian-mediated flow (E5)
CREATE FUNCTION t.req(who text, avail text, other text) RETURNS void LANGUAGE sql AS $f$
  INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message)
  VALUES (t.id(who), t.id(other), ('00000000-0000-0000-0000-0000000000' || avail)::uuid, 'contact', 'hello') $f$;
GRANT EXECUTE ON FUNCTION t.req(text, text, text) TO anon, authenticated;
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('t16');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT t.req('stranger', 'b2', 't16')$q$, 'MINOR_MESSAGING_BLOCKED:needs_connection', 'an adult stranger cannot ask a minor');
SELECT t.as_user(t.id('t17u'));
SELECT t.throws($q$SELECT t.req('t17u', 'b1', 'adultpost')$q$, 'MINOR_MESSAGING_BLOCKED:needs_guardian_link:self', 'an unlinked 16-17 cannot ask an adult: link a guardian first');
SELECT t.as_user(t.id('t16'));
SELECT t.throws($q$SELECT t.req('t16', 'b3', 't15b')$q$, 'MINOR_MESSAGING_BLOCKED:needs_connection', 'a minor cannot ask an unrelated minor');
SELECT t.lives($q$SELECT t.req('t16', 'b1', 'adultpost')$q$, 'a linked minor can ask an adult; the request waits for a guardian');
SELECT t.eq((SELECT status FROM public.availability_contact_requests WHERE from_user_id = t.id('t16')), 'awaiting_guardian', 'its status is awaiting_guardian whatever the client sent');
SELECT t.eq(t.changed($$UPDATE public.availability_contact_requests SET status = 'accepted', guardian_approved_at = now() WHERE from_user_id = auth.uid()$$), 0, 'the minor cannot approve their own request');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('gmom') AND type = 'guardian_approval'), 1, 'the guardian is notified');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('adultpost')), 0, 'the recipient is not');
SELECT t.as_user(t.id('adultpost'));
SELECT t.eq(t.count($$SELECT 1 FROM public.availability_contact_requests$$), 0, 'the recipient cannot see it');
SELECT t.eq(t.changed($$UPDATE public.availability_contact_requests SET status = 'accepted'$$), 0, 'nor change it');
SELECT t.as_user(t.id('gdad'));
SELECT t.throws(format($q$SELECT public.guardian_decide_contact_request(%L, true)$q$, (SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t16'))), 'REQUEST_NOT_FOUND', 'another family''s guardian cannot decide');
SELECT t.as_user(t.id('t16'));
SELECT t.throws(format($q$SELECT public.guardian_decide_contact_request(%L, true)$q$, (SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t16'))), 'REQUEST_NOT_FOUND', 'nor the child');
SELECT t.as_user(t.id('gmom'));
SELECT t.eq(t.count($$SELECT 1 FROM public.availability_contact_requests$$), 1, 'the guardian sees the child''s request');
SELECT t.lives(format($q$SELECT public.guardian_decide_contact_request(%L, true)$q$, (SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t16'))), 'a verified guardian approves');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.availability_contact_requests WHERE from_user_id = t.id('t16')), 'pending', 'now pending');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('adultpost') AND type = 'contact_request'), 1, 'the recipient is told, without names');
SELECT t.as_user(t.id('adultpost'));
SELECT t.eq(t.count($$SELECT 1 FROM public.availability_contact_requests$$), 1, 'the recipient now sees it');
SELECT t.lives($q$UPDATE public.availability_contact_requests SET status = 'accepted'$q$, 'and accepts');
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('t16')), 'an accepted, guardian-approved request authorizes a conversation');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('t16');
SELECT t.as_user(t.id('adultpost'));
SELECT t.throws($q$INSERT INTO public.messages (conversation_id, sender_id, body) SELECT conversation_id, t.id('adultpost'), 'hi again' FROM public.conversation_participants WHERE user_id = t.id('t16') AND conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = t.id('adultpost')) LIMIT 1$q$, 'MINOR_MESSAGING_BLOCKED', 'when the guardian link is revoked the approval lapses and the next message is refused');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'active' WHERE child_user_id = t.id('t16');

-- a declined request
SELECT t.as_user(t.id('t15b'));
SELECT t.lives($q$SELECT t.req('t15b', 'b1', 'adultpost')$q$, 'a second minor asks');
SELECT t.as_user(t.id('gdad'));
SELECT t.lives(format($q$SELECT public.guardian_decide_contact_request(%L, false)$q$, (SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t15b'))), 'the guardian declines');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.availability_contact_requests WHERE from_user_id = t.id('t15b')), 'withdrawn', 'it is withdrawn');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('adultpost') AND type = 'contact_request'), 1, 'and the recipient is not told');

-- ================= 6. notifications (can_notify gates every server-written notification and push)
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t14')), 'a game-mate adult cannot notify a 13-15 year old');
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t16')), 'nor a 16-17');
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('unk')), 'nor a person of unknown age');
SELECT t.ok(public.can_notify(t.id('host'), t.id('t14')), 'a host can notify their participant');
SELECT t.ok(public.can_notify(t.id('gmom'), t.id('kid')), 'a guardian can notify their child');
SELECT t.ok(public.can_notify(t.id('coach'), t.id('t14')), 'a coach can notify a player of their team');
SELECT t.ok(public.can_notify(t.id('stranger'), t.id('host')), 'adult to adult through a shared game is unchanged');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('stranger'));
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('host')), 'a block stops notifications');

-- ================= 7. bypass attempts
SELECT set_config('t.conv', (SELECT conversation_id::text FROM public.conversation_participants WHERE user_id = t.id('t16') LIMIT 1), false);
SELECT t.as_user(t.id('t17u'));
SELECT t.throws(format($q$INSERT INTO public.messages (conversation_id, sender_id, body) VALUES (%L, %L, 'x')$q$, current_setting('t.conv'), t.id('t17u')), 'MINOR_MESSAGING_BLOCKED', 'a client cannot send into a conversation it is not in');
SELECT t.as_anon();
SELECT t.throws(format($q$SELECT public.guardian_decide_contact_request(%L, true)$q$, gen_random_uuid()), 'permission denied', 'anonymous cannot decide requests');
SELECT t.reset();
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.messaging_connection(uuid, uuid)', 'EXECUTE'), false, 'the connection helper is not callable by clients (no oracle)');
SELECT t.eq(has_function_privilege('authenticated', 'public.gate_contact_request_for_guardian()', 'EXECUTE'), false, 'nor the gate trigger');
SELECT t.eq(has_function_privilege('anon', 'public.can_notify(uuid, uuid)', 'EXECUTE'), false, 'nor can anonymous call can_notify');
ROLLBACK;
