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
-- a minor joins a team through an invitation their verified guardian approved (the only membership that counts as a messaging context)
SELECT t.invited_member('squad', 't16', 'gmom');
SELECT t.invited_member('squad', 't14', 'gmom');
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
SELECT t.eq(t.dm('host', 't14'), 'needs_connection:other', 'a game''s host and a self-joined minor participant: not a context (anyone can publish a public game)');
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, guardian_approved_at, guardian_approved_by) VALUES ('pub', t.id('t14'), t.id('host'), 'k-approved', 'approved', now(), t.id('gmom'));
SET LOCAL session_replication_role = origin;
SELECT t.ok(t.dm('host', 't14') IS NULL, 'an adult host and a participant whose guardian approved that participation: a context');
SELECT t.eq(t.dm('stranger', 't14'), 'needs_connection:other', 'a co-participant adult is still a stranger');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('t16');

-- ================= 3. minors with each other (E2)
SELECT t.eq(t.dm('t14', 't15b'), 'needs_connection:other', 'two 13-15 year olds sharing a public game are not a context, even with peers on both sides (consent goes through a request)');
SELECT t.eq(t.dm('t16', 't15b'), 'needs_connection:other', 'nor across age bands');
SELECT t.eq(t.dm('kid', 't14'), 'needs_connection:other', 'and never an under-13');
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('t15b');
SELECT t.eq(t.dm('t14', 't15b'), 'teammates_only:other', 'the other guardian''s stricter setting wins');
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

-- ================= 8. fixes from the independent review
-- F1: the recipient cannot forge or reuse an approval
SELECT t.as_user(t.id('t16'));
SELECT t.lives($q$SELECT t.req('t16', 'b1', 'adultpost')$q$, 'setup: a linked minor asks an adult again');
SELECT t.as_user(t.id('gmom'));
SELECT t.eq(public.guardian_decide_contact_request((SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t16') AND status = 'awaiting_guardian'), false), 'declined', 'the guardian declines');
SELECT t.as_user(t.id('adultpost'));
SELECT t.eq(t.count($$SELECT 1 FROM public.availability_contact_requests WHERE status = 'withdrawn'$$), 0, 'a declined request is invisible to the recipient');
SELECT t.eq(t.changed($$UPDATE public.availability_contact_requests SET status = 'accepted', guardian_approved_by = auth.uid(), guardian_approved_at = now() WHERE status = 'withdrawn'$$), 0, 'and cannot be revived or self-approved');
SELECT t.reset();
-- a legacy pending row from a minor (created before this migration: no approval, needs_guardian backfilled)
SET LOCAL session_replication_role = replica;
INSERT INTO public.availability_contact_requests (id, availability_id, from_user_id, to_user_id, status, kind, needs_guardian) VALUES
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', t.id('t16'), t.id('stranger'), 'pending', 'contact', true);
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count($$SELECT 1 FROM public.availability_contact_requests WHERE id = '00000000-0000-0000-0000-0000000000d1'$$), 0, 'a legacy pending request from a minor is not visible to the recipient');
SELECT t.eq(t.changed($$UPDATE public.availability_contact_requests SET status = 'accepted', guardian_approved_by = auth.uid(), guardian_approved_at = now() WHERE id = '00000000-0000-0000-0000-0000000000d1'$$), 0, 'nor can it be accepted or self-approved');
SELECT t.reset();
SELECT t.ok(t.dm('stranger', 't16') IS NOT NULL, 'and gives no authorization');
-- a visible pending request: the recipient still cannot write the approval columns
SELECT t.as_user(t.id('t15b'));
SELECT t.lives($q$SELECT t.req('t15b', 'b1', 'adultpost')$q$, 'setup: another minor asks');
SELECT t.as_user(t.id('gdad'));
SELECT t.eq(public.guardian_decide_contact_request((SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t15b') AND status = 'awaiting_guardian'), true), 'approved', 'the guardian approves');
SELECT t.as_user(t.id('adultpost'));
SELECT t.lives($q$UPDATE public.availability_contact_requests SET status = 'accepted', guardian_approved_by = t.id('stranger'), guardian_approved_at = now() - interval '1 year' WHERE from_user_id = t.id('t15b')$q$, 'the recipient accepts (extra columns are ignored)');
SELECT t.reset();
SELECT t.eq((SELECT guardian_approved_by FROM public.availability_contact_requests WHERE from_user_id = t.id('t15b') AND status = 'accepted'), t.id('gdad'), 'the approval columns were not overwritten');
SELECT t.as_user(t.id('adultpost'));
SELECT t.throws($q$UPDATE public.availability_contact_requests SET status = 'pending' WHERE from_user_id = t.id('t15b')$q$, 'cannot be changed that way', 'an accepted request cannot be moved back by the recipient');
SELECT t.reset();

-- F2: an organization administrator can no longer create a context by adding a minor (no consent) or by creating an organization
INSERT INTO public.trainer_orgs (id, name, handle, owner_id) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Pwn Gym', 'pwngym', t.id('stranger'));
INSERT INTO public.org_members (org_id, user_id) VALUES ('00000000-0000-0000-0000-0000000000e1', t.id('t17u')), ('00000000-0000-0000-0000-0000000000e1', t.id('t14'));
SELECT t.eq(t.dm('stranger', 't17u'), 'needs_guardian_link:other', 'an organization admin who added an unlinked teen is still a stranger');
SELECT t.eq(t.dm('stranger', 't14'), 'needs_connection:other', 'and a linked 13-15 member');
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t17u')), 'and cannot notify');

-- F3: a rejected or old join request is not a relationship; controls still apply to the connection branch
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES ('pub2', t.id('stranger'), 'basketball', 'Open run 2', now() + interval '2 days', 12, 17, 'Gym', 'North', '{"name":"S"}'::jsonb);
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('pub2', t.id('t14'), t.id('stranger'), 'k-rej', 'rejected');
SET LOCAL session_replication_role = origin;
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t14')), 'a rejected join request does not allow notifying the child');
UPDATE public.join_requests SET status = 'pending' WHERE idempotency_key = 'k-rej';
SELECT t.ok(public.can_notify(t.id('stranger'), t.id('t14')), 'a live pending request does (the host is dealing with it)');
UPDATE public.join_requests SET created_at = now() - interval '200 days' WHERE idempotency_key = 'k-rej';
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t14')), 'but not an old one');
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('t14');
SELECT t.ok(NOT public.can_notify(t.id('coach'), t.id('t14')), 'guardian controls (messaging off) also stop notifications from a teammate-coach');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('t14');

-- review round 2: a stranger cannot push to a minor host through a join request; peers can be notified
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('pub', t.id('stranger'), t.id('t16'), 'k-creep', 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t16')), 'an adult with a join request to a minor host cannot notify that host');
SELECT t.ok(public.can_notify(t.id('t16'), t.id('stranger')), 'but the host can notify the requester (host to player)');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id IN (t.id('t14'), t.id('t15b'));
SELECT t.ok(NOT public.can_notify(t.id('t14'), t.id('t15b')), 'two teens who only share a game cannot notify each other');

-- F4: approval re-checks blocks and privacy; the guardian sees who is being contacted (names come from visible_avatars in the app)
SELECT t.as_user(t.id('t16'));
SELECT t.lives($q$SELECT t.req('t16', 'b1', 'adultpost')$q$, 'setup: ask again');
SELECT t.reset();
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('adultpost'), t.id('t16'));
SELECT t.as_user(t.id('gmom'));
SELECT t.eq(public.guardian_decide_contact_request((SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t16') AND status = 'awaiting_guardian'), true), 'blocked', 'approving a request to someone who has since blocked the child is refused');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('adultpost') AND type = 'contact_request'), 2, 'and notifies nobody (only the two earlier approved requests produced one each)');

-- F5: team invitations to a minor carry no free text and no direct notification
SELECT t.as_user(t.id('coach'));
SELECT t.lives(format($q$SELECT public.team_invite_player('squad', %L, 'player', 'text me on snap: xyz')$q$, t.id('t17u')), 'a team manager invites a minor');
SELECT t.reset();
SELECT t.ok((SELECT message IS NULL FROM public.team_invites WHERE invitee_id = t.id('t17u') ORDER BY created_at DESC LIMIT 1), 'the free-text message is dropped');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('t17u') AND type = 'team_invite'), 0, 'and the minor gets no direct notification from the manager');
SELECT t.as_user(t.id('coach'));
SELECT t.lives(format($q$SELECT public.team_invite_player('squad', %L, 'player', 'welcome aboard')$q$, t.id('adultpost')), 'an adult invitee is unchanged');
SELECT t.reset();
SELECT t.eq((SELECT message FROM public.team_invites WHERE invitee_id = t.id('adultpost') ORDER BY created_at DESC LIMIT 1), 'welcome aboard', 'message kept for an adult');

-- F6: reactions follow the same decision as messages
SELECT t.as_user(t.id('coach'));
SELECT t.lives(format('SELECT public.create_direct_conversation(%L)', t.id('t14')), 'setup: a coach opens a conversation with a teammate');
SELECT t.reset();
INSERT INTO public.messages (conversation_id, sender_id, body) SELECT conversation_id, t.id('t14'), 'hi coach' FROM public.conversation_participants WHERE user_id = t.id('t14') AND conversation_id IN (SELECT conversation_id FROM public.conversation_participants WHERE user_id = t.id('coach')) LIMIT 1;
DELETE FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('t14');
SELECT t.as_user(t.id('coach'));
SELECT t.throws($q$INSERT INTO public.message_reactions (message_id, user_id, emoji) SELECT id, t.id('coach'), 'x' FROM public.messages WHERE body = 'hi coach'$q$, 'MINOR_MESSAGING_BLOCKED', 'a lapsed context also stops reactions');
SELECT t.reset();

-- F7: no oracle for third parties
SELECT t.as_user(t.id('adultpost'));
SELECT t.eq(public.minor_messaging_block(t.id('gmom'), t.id('t16')), 'needs_connection:other', 'a third party gets the same answer for a guardian pair as for any other');
SELECT t.eq(public.minor_messaging_block(t.id('adultpost'), t.id('t17u')), 'needs_guardian_link:other', 'a party to the pair still gets the reason');
SELECT t.ok(NOT public.can_notify(t.id('gmom'), t.id('t16')), 'can_notify says no to a third party');
SELECT t.reset();

-- ================= teen-to-teen consent: request, sender's guardian approves, recipient (whose guardian allows peers) accepts
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id IN (t.id('t14'), t.id('t15b'));
SELECT t.as_user(t.id('t14'));
SELECT t.lives($q$SELECT t.req('t14', 'b3', 't15b')$q$, 'a 13-15 can ask another 13-15 whose guardian allows peers');
SELECT t.eq((SELECT status FROM public.availability_contact_requests WHERE from_user_id = t.id('t14') AND to_user_id = t.id('t15b')), 'awaiting_guardian', 'it waits for the sender''s guardian');
SELECT t.as_user(t.id('t16'));
SELECT t.throws($q$SELECT t.req('t16', 'b3', 't15b')$q$, 'needs_connection', 'not across age bands');
SELECT t.as_user(t.id('gmom'));
SELECT t.eq(public.guardian_decide_contact_request((SELECT id FROM public.availability_contact_requests WHERE from_user_id = t.id('t14') AND to_user_id = t.id('t15b')), true), 'approved', 'the sender''s guardian approves');
SELECT t.as_user(t.id('t15b'));
SELECT t.lives($q$UPDATE public.availability_contact_requests SET status = 'accepted' WHERE from_user_id = t.id('t14') AND to_user_id = t.id('t15b')$q$, 'the recipient accepts');
SELECT t.reset();
SELECT t.ok(t.dm('t14', 't15b') IS NULL, 'only now may they message (verified context, mutual consent, guardian permission on both sides)');
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('t15b');
SELECT t.eq(t.dm('t14', 't15b'), 'teammates_only:other', 'and the recipient''s guardian can still narrow it later');

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

-- ================= 9. review round 4 (each finding has a regression test, labelled R4-Fn)
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id IN (t.id('kid'), t.id('t14'), t.id('t16'), t.id('t15b'));
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('pub3', t.id('host'), 'basketball', 'Open run 3', now() + interval '3 days', 8, 17, 'Gym', 'North', '{"name":"Host"}'::jsonb);
SET LOCAL session_replication_role = origin;

-- F1: only guardian_approve_join_request writes a join request's guardian approval
SELECT t.as_user(t.id('t15b'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, guardian_approved_at, guardian_approved_by) VALUES ('pub3', %L, %L, 'k-forge', now(), %L)$q$, t.id('t15b'), t.id('host'), t.id('gdad')), 'setup: a 15 year old sends a join request carrying a forged guardian approval');
SELECT t.reset();
SELECT t.ok((SELECT guardian_approved_at IS NULL AND guardian_approved_by IS NULL FROM public.join_requests WHERE idempotency_key = 'k-forge'), 'R4-F1: a forged approval is cleared on insert');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.join_requests SET guardian_approved_at = now(), guardian_approved_by = t.id('gdad') WHERE idempotency_key = 'k-forge'$q$, 'the host tries to stamp a guardian approval');
SELECT t.reset();
SELECT t.ok((SELECT guardian_approved_at IS NULL AND guardian_approved_by IS NULL FROM public.join_requests WHERE idempotency_key = 'k-forge'), 'R4-F1: a stamped approval is not stored');
SELECT t.as_user(t.id('t15b'));
SELECT t.throws($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('pub3', t.id('t15b'))$q$, 'GUARDIAN_APPROVAL_REQUIRED', 'R4-F1: so the participation gate still waits for the guardian');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('pub3', t.id('t15b'));
SET LOCAL session_replication_role = origin;
SELECT t.eq(t.dm('host', 't15b'), 'needs_connection:other', 'R4-F1: and no host-to-minor context exists without a real approval');
DELETE FROM public.game_participants WHERE game_id = 'pub3' AND user_id = t.id('t15b');
SELECT t.as_user(t.id('gdad'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', (SELECT id FROM public.join_requests WHERE idempotency_key = 'k-forge')), 'the verified guardian approves through the function');
SELECT t.reset();
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE idempotency_key = 'k-forge'), t.id('gdad'), 'R4-F1: which stores the approval');

-- F8: the game context needs the host's approval too, and ends 30 days after the game
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('pub3', t.id('t15b'));
SET LOCAL session_replication_role = origin;
SELECT t.eq(t.dm('host', 't15b'), 'needs_connection:other', 'R4-F8: a guardian-approved request the host has not approved is not a context');
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.join_requests SET status = 'approved' WHERE idempotency_key = 'k-forge'$q$, 'the host approves');
SELECT t.reset();
SELECT t.ok(t.dm('host', 't15b') IS NULL, 'R4-F8: approved by host and guardian: a context');
SET LOCAL session_replication_role = replica;
UPDATE public.hosted_games SET date = now() - interval '45 days', ends_at = now() - interval '44 days' WHERE id = 'pub3';
SET LOCAL session_replication_role = origin;
SELECT t.eq(t.dm('host', 't15b'), 'needs_connection:other', 'R4-F8: but not once the game ended more than 30 days ago');
SET LOCAL session_replication_role = replica;
UPDATE public.hosted_games SET date = now() + interval '3 days', ends_at = NULL WHERE id = 'pub3';
SET LOCAL session_replication_role = origin;

-- F2: the join-request branch of can_notify respects the guardian's controls and keeps under-13 contact guardian-mediated
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('pub3', t.id('kid'), t.id('host'), 'k-kid', 'pending');
SET LOCAL session_replication_role = origin;
SELECT t.ok(NOT public.can_notify(t.id('host'), t.id('kid')), 'R4-F2: a host cannot notify an under-13 whose request no guardian approved');
UPDATE public.join_requests SET guardian_approved_at = now(), guardian_approved_by = t.id('gmom') WHERE idempotency_key = 'k-kid';
SELECT t.ok(public.can_notify(t.id('host'), t.id('kid')), 'once a verified guardian approved it, the host can');
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('kid');
SELECT t.ok(NOT public.can_notify(t.id('host'), t.id('kid')), 'R4-F2: but not when the guardian turned messaging off');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('kid');
SELECT t.ok(public.can_notify(t.id('t15b'), t.id('host')), 'a minor can notify the adult host they asked');
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('t15b');
SELECT t.ok(NOT public.can_notify(t.id('t15b'), t.id('host')), 'R4-F2: unless their guardian turned messaging off');
SELECT t.ok(NOT public.can_notify(t.id('host'), t.id('t15b')), 'R4-F2: in either direction');
UPDATE public.child_controls SET messaging = 'peers' WHERE child_user_id = t.id('t15b');

-- F7: an adult cannot insert a request carrying guardian columns, and an adult's request is never a guardian-approved context
SELECT t.as_user(t.id('stranger'));
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message, needs_guardian, guardian_approved_by, guardian_approved_at) VALUES (t.id('stranger'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000b1', 'contact', 'hi', true, t.id('gmom'), now())$q$, 'setup: an adult sends a request with forged guardian columns');
SELECT t.reset();
SELECT t.ok((SELECT NOT needs_guardian AND guardian_approved_at IS NULL AND guardian_approved_by IS NULL AND status = 'pending' FROM public.availability_contact_requests WHERE from_user_id = t.id('stranger') AND to_user_id = t.id('adultpost')), 'R4-F7: the guardian columns are reset on insert');
SET LOCAL session_replication_role = replica;
INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at) VALUES (t.id('gdad'), t.id('adultpost'), 'parent', 'active', now());
INSERT INTO public.availability_contact_requests (id, availability_id, from_user_id, to_user_id, status, kind, needs_guardian, guardian_approved_by, guardian_approved_at) VALUES
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b3', t.id('adultpost'), t.id('t14'), 'accepted', 'contact', true, t.id('gdad'), now());
SET LOCAL session_replication_role = origin;
SELECT t.eq(t.dm('adultpost', 't14'), 'needs_connection:other', 'R4-F7: an accepted, "guardian-approved" request from an adult is not a context');
DELETE FROM public.guardian_links WHERE child_user_id = t.id('adultpost');

-- F4: unknown age fails closed for direct roster adds
SELECT t.as_user(t.id('coach'));
SELECT t.throws(format($q$INSERT INTO public.team_members (team_id, user_id, role) VALUES ('squad', %L, 'player')$q$, t.id('unk')), 'row-level security', 'R4-F4: a manager cannot add a person of unknown age directly');
SELECT t.lives(format($q$INSERT INTO public.team_members (team_id, user_id, role) VALUES ('squad', %L, 'coach')$q$, t.id('modone')), 'a confirmed adult can still be added directly');
SELECT t.reset();

-- F3: an unlinked minor's team membership never opens messaging, even after accepting an invitation
SELECT t.as_user(t.id('stranger'));
SELECT t.lives($q$INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES ('lure', t.id('stranger'), 'team', 'Lure', 'lure')$q$, 'setup: an adult creates their own team');
SELECT t.lives(format($q$SELECT public.team_invite_player('lure', %L, 'player', NULL)$q$, t.id('t17u')), 'and invites an unlinked 17 year old');
SELECT t.as_user(t.id('t17u'));
SELECT t.lives($q$SELECT public.team_respond_invite((SELECT id FROM public.team_invites WHERE team_id = 'lure' AND invitee_id = t.id('t17u')), true)$q$, 'who accepts with no guardian');
SELECT t.reset();
SELECT t.ok(public.shares_team(t.id('stranger'), t.id('t17u')), 'they are teammates (team posts and RSVPs work)');
SELECT t.eq(t.dm('stranger', 't17u'), 'needs_guardian_link:other', 'R4-F3: but that opens no messaging with an unlinked minor');
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t17u')), 'R4-F3: nor notifications');
SELECT t.as_user(t.id('t17u'));
SELECT t.lives($q$INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES ('kidsq', t.id('t17u'), 'team', 'Kidsq', 'kidsq')$q$, 'setup: an unlinked 17 year old creates a team');
SELECT t.lives(format($q$SELECT public.team_invite_player('kidsq', %L, 'player', NULL)$q$, t.id('t16u')), 'and invites an unlinked 16 year old');
SELECT t.as_user(t.id('t16u'));
SELECT t.lives($q$SELECT public.team_respond_invite((SELECT id FROM public.team_invites WHERE team_id = 'kidsq' AND invitee_id = t.id('t16u')), true)$q$, 'who accepts');
SELECT t.reset();
SELECT t.eq(t.dm('t17u', 't16u'), 'needs_guardian_link:self', 'R4-F3: two unlinked minors on a team they made cannot message');
SELECT t.as_user(t.id('coach'));
SELECT t.lives(format($q$SELECT public.team_invite_player('squad', %L, 'player', NULL)$q$, t.id('t15b')), 'setup: a coach invites a linked 15 year old');
SELECT t.as_user(t.id('gdad'));
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', (SELECT id FROM public.team_invites WHERE team_id = 'squad' AND invitee_id = t.id('t15b'))), 'whose verified guardian approves (the player joins)');
SELECT t.reset();
SELECT t.ok(t.dm('coach', 't15b') IS NULL, 'R4-F3: a guardian-approved membership is a context with the team owner');
SELECT t.ok(public.can_notify(t.id('coach'), t.id('t15b')), 'and the coach can notify the player');

-- F5: a direct roster add (by any manager, any age) never counts for a pair involving a non-adult
SELECT t.eq(t.dm('modone', 't15b'), 'needs_connection:other', 'R4-F5: an adult added directly by a manager is not a context for the team''s minors');
SELECT t.as_user(t.id('t16'));
SELECT t.lives($q$INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES ('teenteam', t.id('t16'), 'team', 'Teenteam', 'teenteam')$q$, 'setup: a linked teen creates a team');
SELECT t.lives(format($q$INSERT INTO public.team_members (team_id, user_id, role) VALUES ('teenteam', %L, 'player')$q$, t.id('stranger')), 'and adds an adult directly');
SELECT t.reset();
SELECT t.ok(public.shares_team(t.id('stranger'), t.id('t16')), 'they share a roster');
SELECT t.eq(t.dm('stranger', 't16'), 'needs_connection:other', 'R4-F5: that never opens messaging without a guardian');
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('t16')), 'R4-F5: nor notifications');

-- F6: a family invitation cannot make a fake guardian
SELECT t.as_user(t.id('stranger'));
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', repeat('a', 64), now() + interval '1 day')$q$, 'setup: an adult creates family invitations');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', repeat('b', 64), now() + interval '1 day')$q$, 'setup: a second one');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', repeat('c', 64), now() + interval '1 day')$q$, 'setup: a third one');
SELECT t.as_user(t.id('adultpost'));
SELECT t.throws($q$SELECT * FROM public.redeem_minor_invite(repeat('a', 64))$q$, 'ADULT_CANNOT_REDEEM', 'R4-F6: an adult cannot redeem a family invitation');
SELECT t.as_user(t.id('t16'));
SELECT t.eq((SELECT pending_approval FROM public.redeem_minor_invite(repeat('a', 64))), true, 'R4-F6: a child who already has a guardian only creates a pending request');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('stranger'), t.id('t16')), 'R4-F6: the inviter is not a guardian yet');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('gmom') AND title = 'Approve a new guardian'), 1, 'R4-F6: the current guardian is notified');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.guardian_decide_link_request(%L, true)', (SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id('t16'))), 'REQUEST_NOT_FOUND', 'R4-F6: the requester cannot approve themselves');
SELECT t.as_user(t.id('t16'));
SELECT t.throws(format('SELECT public.guardian_decide_link_request(%L, true)', (SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id('t16'))), 'REQUEST_NOT_FOUND', 'R4-F6: nor the child');
SELECT t.as_user(t.id('t14'));
SELECT t.eq((SELECT pending_approval FROM public.redeem_minor_invite(repeat('b', 64))), true, 'setup: another linked child redeems');
SELECT t.as_user(t.id('gmom'));
SELECT t.eq(public.guardian_decide_link_request((SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id('t14')), false), 'declined', 'the current guardian declines one');
SELECT t.eq(public.guardian_decide_link_request((SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id('t16')), true), 'approved', 'and approves the other');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('stranger'), t.id('t14')), 'R4-F6: a declined request links nobody');
SELECT t.ok(public.is_guardian_of(t.id('stranger'), t.id('t16')), 'R4-F6: an approved one is active');
SELECT t.as_user(t.id('t17u'));
SELECT t.eq((SELECT pending_approval FROM public.redeem_minor_invite(repeat('c', 64))), false, 'a child with no guardian links at once (how the first guardian links)');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('stranger'), t.id('t17u')), 'the first guardian is active');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE title = 'Approve a new guardian'), 2, 'and no one new is asked to approve (only the two earlier requests)');
SELECT t.eq(has_function_privilege('anon', 'public.guardian_decide_link_request(uuid, boolean)', 'EXECUTE'), false, 'anonymous cannot decide link requests');
ROLLBACK;
