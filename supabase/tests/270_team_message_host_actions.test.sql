-- The actions a team manager, a conversation participant or a game's host takes
-- through a function a signed-in user can call directly. Each is tested as the
-- app cannot be trusted to: called by a stranger, by an ordinary member, and by
-- a guardian acting for a child, as well as by the person it is meant for.
BEGIN;

SELECT t.person('owner', 40), t.person('manager', 33), t.person('player', 27),
       t.person('player2', 26), t.person('stranger', 31), t.person('mod', 38),
       t.person('parent', 41), t.person('teen', 14), t.person('host', 40);
SELECT t.guardian('parent', 'teen');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('mod'), 'moderator');

SELECT t.team('squad', 'owner');
SELECT t.member('squad', 'owner', 'owner');
SELECT t.member('squad', 'manager', 'manager');
SELECT t.member('squad', 'player', 'player');
SELECT t.member('squad', 'player2', 'player');
SELECT t.member('squad', 'teen', 'player');

-- ---- team_invite_player ---------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.team_invite_player(%L, %L, %L::public.team_role, NULL)', 'squad', t.id('host'), 'player'),
  'NOT_TEAM_MANAGER', 'a stranger cannot invite anyone to a team');
SELECT t.as_user(t.id('player'));
SELECT t.throws(format('SELECT public.team_invite_player(%L, %L, %L::public.team_role, NULL)', 'squad', t.id('host'), 'player'),
  'NOT_TEAM_MANAGER', 'an ordinary member cannot either');
SELECT t.as_user(t.id('parent'));
SELECT t.throws(format('SELECT public.team_invite_player(%L, %L, %L::public.team_role, NULL)', 'squad', t.id('host'), 'player'),
  'NOT_TEAM_MANAGER', 'a guardian has no say over a team their child is on');
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format('SELECT public.team_invite_player(%L, %L, %L::public.team_role, NULL)', 'squad', t.id('host'), 'owner'),
  'OWNER_NOT_INVITABLE', 'nobody can be invited as the owner');
SELECT t.lives(format('SELECT public.team_invite_player(%L, %L, %L::public.team_role, NULL)', 'squad', t.id('host'), 'player'),
  'a manager can invite');
SELECT t.reset();
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('stranger'), t.id('manager'));
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format('SELECT public.team_invite_player(%L, %L, %L::public.team_role, NULL)', 'squad', t.id('stranger'), 'player'),
  'BLOCKED', 'but not someone who has blocked them');
SELECT t.reset();

-- ---- team_remove_member ---------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.team_remove_member(%L, %L)', 'squad', t.id('player2')),
  'NOT_TEAM_MANAGER', 'a stranger cannot remove a member');
SELECT t.as_user(t.id('player'));
SELECT t.throws(format('SELECT public.team_remove_member(%L, %L)', 'squad', t.id('player2')),
  'NOT_TEAM_MANAGER', 'a member cannot remove another member');
SELECT t.as_user(t.id('parent'));
SELECT t.throws(format('SELECT public.team_remove_member(%L, %L)', 'squad', t.id('player2')),
  'NOT_TEAM_MANAGER', 'nor can a guardian');
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format('SELECT public.team_remove_member(%L, %L)', 'squad', t.id('owner')),
  'OWNER_NOT_REMOVABLE', 'a manager cannot remove the owner');
SELECT t.as_user(t.id('player'));
SELECT t.lives(format('SELECT public.team_remove_member(%L, %L)', 'squad', t.id('player')),
  'a member can leave');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id('player2')), 1,
  'and nobody else was removed by the refused attempts');

-- ---- team_set_member_role -------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.team_set_member_role(%L, %L, %L::public.team_role)', 'squad', t.id('player2'), 'manager'),
  'NOT_TEAM_MANAGER', 'a stranger cannot promote anyone');
SELECT t.as_user(t.id('player2'));
SELECT t.throws(format('SELECT public.team_set_member_role(%L, %L, %L::public.team_role)', 'squad', t.id('player2'), 'manager'),
  'NOT_TEAM_MANAGER', 'a member cannot promote themselves');
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format('SELECT public.team_set_member_role(%L, %L, %L::public.team_role)', 'squad', t.id('player2'), 'owner'),
  'OWNER_ROLE_FIXED', 'nobody can be made owner this way');
SELECT t.throws(format('SELECT public.team_set_member_role(%L, %L, %L::public.team_role)', 'squad', t.id('owner'), 'player'),
  'OWNER_ROLE_FIXED', 'and the owner cannot be demoted this way');
SELECT t.reset();

-- ---- transfer_team_ownership ----------------------------------------------
SELECT t.as_user(t.id('manager'));
SELECT t.throws(format('SELECT public.transfer_team_ownership(%L, %L)', 'squad', t.id('manager')),
  'NOT_TEAM_OWNER', 'a manager cannot take the team');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.transfer_team_ownership(%L, %L)', 'squad', t.id('stranger')),
  'NOT_TEAM_OWNER', 'neither can a stranger');
SELECT t.as_user(t.id('owner'));
SELECT t.throws(format('SELECT public.transfer_team_ownership(%L, %L)', 'squad', t.id('stranger')),
  'NOT_A_MEMBER', 'the owner can only hand it to a member');
SELECT t.throws(format('SELECT public.transfer_team_ownership(%L, %L)', 'squad', t.id('player2')),
  'TARGET_NOT_MANAGER', 'and only to a manager');
SELECT t.reset();
SELECT t.eq((SELECT owner_id FROM public.teams WHERE id = 'squad'), t.id('owner'), 'ownership never moved');

-- ---- set_team_event_availability (RSVP for a team event) -------------------
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, event_date)
VALUES (t.id('tryout'), 'squad', t.id('owner'), 'tryout', 'Open tryout', 'Bring shoes', now() + interval '5 days');
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = t.id('tryout');

SELECT t.as_anon();
SELECT t.throws(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('player2'), 'available'),
  '', 'a signed-out caller cannot answer for anyone');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('player2'), 'available'),
  'NOT_ALLOWED', 'a stranger cannot answer for a member');
SELECT t.throws(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('stranger'), 'available'),
  'NOT_ON_TEAM', 'or for themselves when they are not on the team');
SELECT t.as_user(t.id('player2'));
SELECT t.throws(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('teen'), 'available'),
  'NOT_ALLOWED', 'a member cannot answer for another member');
SELECT t.throws(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('player2'), 'attending'),
  'INVALID_STATUS', 'an answer outside the allowed three is refused');
SELECT t.lives(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('player2'), 'available'),
  'a member can answer for themselves');
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('teen'), 'maybe'),
  'a guardian can answer for their child');
SELECT t.throws(format('SELECT public.set_team_event_availability(%L, %L, %L, NULL)', t.id('tryout'), t.id('player2'), 'available'),
  'NOT_ALLOWED', 'but not for anyone else''s child');
SELECT t.reset();
SELECT t.eq((SELECT set_by FROM public.team_event_availability WHERE post_id = t.id('tryout') AND user_id = t.id('teen')), t.id('parent'),
  'the child''s answer is recorded as set by the guardian');

-- ---- accept / decline a conversation, unsend a message ---------------------
INSERT INTO public.conversations (id, created_by) VALUES (t.id('thread'), t.id('player'));
INSERT INTO public.conversation_participants (conversation_id, user_id)
VALUES (t.id('thread'), t.id('player')), (t.id('thread'), t.id('player2'));
INSERT INTO public.messages (id, conversation_id, sender_id, body)
VALUES (t.id('msg'), t.id('thread'), t.id('player'), 'hi there');

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.accept_conversation(%L)', t.id('thread')),
  'Not a participant', 'a stranger cannot accept someone else''s conversation');
SELECT t.lives(format('SELECT public.decline_conversation(%L)', t.id('thread')),
  'declining a conversation they are not in does nothing');
SELECT t.lives(format('SELECT public.unsend_message(%L)', t.id('msg')),
  'unsending someone else''s message does nothing');
SELECT t.as_user(t.id('player2'));
SELECT t.lives(format('SELECT public.unsend_message(%L)', t.id('msg')),
  'nor does the recipient unsending the sender''s message');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.conversation_participants WHERE conversation_id = t.id('thread')), 2,
  'both participants are still in the thread');
SELECT t.ok((SELECT deleted_at FROM public.messages WHERE id = t.id('msg')) IS NULL,
  'and the message is untouched');
SELECT t.as_user(t.id('player'));
SELECT t.lives(format('SELECT public.unsend_message(%L)', t.id('msg')), 'the sender can unsend');
SELECT t.reset();
SELECT t.ok((SELECT deleted_at FROM public.messages WHERE id = t.id('msg')) IS NOT NULL
        AND (SELECT body FROM public.messages WHERE id = t.id('msg')) IS NULL,
  'and the text is gone');

-- ---- host_cancel_game / host_mark_attendance ------------------------------
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players)
VALUES ('hosted-run', t.id('host'), 'Friday run', 'Basketball', now() + interval '2 days', 'Gym', 10),
       ('started-run', t.id('host'), 'Earlier run', 'Basketball', now() - interval '2 hours', 'Gym', 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('hosted-run', t.id('host'), 0, false), ('started-run', t.id('host'), 0, false);
INSERT INTO public.game_participants (game_id, user_id)
VALUES ('hosted-run', t.id('player2')), ('started-run', t.id('player2'));

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.host_cancel_game(%L, %L)', 'hosted-run', 'no reason'),
  'Only the host', 'a stranger cannot cancel someone else''s game');
SELECT t.throws(format('SELECT public.host_mark_attendance(%L, %L, true)', 'started-run', t.id('player2')),
  'Only the host', 'or mark who attended');
SELECT t.as_user(t.id('player2'));
SELECT t.throws(format('SELECT public.host_cancel_game(%L, %L)', 'hosted-run', 'no reason'),
  'Only the host', 'a player cannot cancel the game they joined');
SELECT t.throws(format('SELECT public.host_mark_attendance(%L, %L, true)', 'started-run', t.id('player2')),
  'Only the host', 'or mark their own attendance');
SELECT t.as_user(t.id('parent'));
SELECT t.throws(format('SELECT public.host_cancel_game(%L, %L)', 'hosted-run', 'no reason'),
  'Only the host', 'and a guardian cannot cancel a game that is not theirs');
SELECT t.reset();
SELECT t.ok((SELECT cancelled_at FROM public.hosted_games WHERE id = 'hosted-run') IS NULL,
  'the game is still on after every refusal');
SELECT t.ok((SELECT attended FROM public.game_participants WHERE game_id = 'started-run' AND user_id = t.id('player2')) IS NOT TRUE,
  'and nobody was marked as attended');
SELECT t.as_user(t.id('host'));
SELECT t.lives(format('SELECT public.host_mark_attendance(%L, %L, true)', 'started-run', t.id('player2')),
  'the host can mark attendance once it has started');
SELECT t.lives(format('SELECT public.host_cancel_game(%L, %L)', 'hosted-run', 'rain'), 'and cancel');
SELECT t.reset();
SELECT t.ok((SELECT cancelled_at FROM public.hosted_games WHERE id = 'hosted-run') IS NOT NULL, 'the game is cancelled');
SELECT t.eq((SELECT attended FROM public.game_participants WHERE game_id = 'started-run' AND user_id = t.id('player2')), true,
  'and the attendance was recorded');

ROLLBACK;
