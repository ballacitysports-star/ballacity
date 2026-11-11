-- Minor-safety gates (20261111120000): a declared age to take a place in a game, join a team by invite, or be added to
-- an organization or a roster directly; payment handles only for an adult payee and a caller who can see or is in the
-- game; revoke_parental_consent and team_invite_player give nobody an answer about other people.
--
-- "nobday" and "nokid" signed up before sign-up asked for a date of birth: their age is unknown. Each defect is shown
-- closed next to the legitimate path that must keep working.
BEGIN;

SELECT t.person('host', 40), t.person('adult', 28), t.person('stranger', 33), t.person('mod', 38),
       t.person('parent', 41), t.person('teen', 16), t.person('kid', 11), t.person('manager', 35),
       t.person('blocker', 30), t.person('teenblock', 15), t.person('teenhost', 17), t.person('orgadmin', 45),
       t.person('asker', 29), t.person('approved', 31), t.person('playing', 27);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobday'), 'nobday780@example.test', now(), jsonb_build_object('display_name', 'Nobday', 'account_type', 'player')),
       (t.id('nokid'), 'nokid780@example.test', now(), jsonb_build_object('display_name', 'Nokid', 'account_type', 'player')),
       (t.id('nbhost'), 'nbhost780@example.test', now(), jsonb_build_object('display_name', 'Nbhost', 'account_type', 'player')),
       (t.id('latebday'), 'latebday780@example.test', now(), jsonb_build_object('display_name', 'Latebday', 'account_type', 'player'));
SELECT t.guardian('parent', 'teen');
SELECT t.guardian('parent', 'kid');
SELECT t.guardian('parent', 'teenblock');
SELECT t.guardian('parent', 'nokid');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('mod'), 'moderator');

SELECT t.eq((SELECT public.age_verified(t.id('nobday'))), false, 'setup: nobday has no declared age');
SELECT t.eq((SELECT public.age_verified(t.id('adult'))), true, 'setup: adult has one');

-- Reads a value as the current role; an error comes back as text instead of ending the file (objects this migration
-- adds do not exist on a database without it, the negative control).
CREATE FUNCTION t.val(q text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  EXECUTE q INTO v;
  RETURN v;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR: ' || SQLERRM;
END $$;

-- ==================================================================================================================
-- 1a. a place in a game needs a declared age, whoever writes the row
-- ==================================================================================================================
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('open', t.id('host'), 'Open run', 'Basketball', now() + interval '3 days', 'Gym', 10, 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('open', t.id('host'), 0, false);

SELECT t.as_user(t.id('nobday'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('nobday')),
  'AGE_VERIFICATION_REQUIRED', 'an account with no birthday cannot take a place itself (kept)');
SELECT t.reset();

-- The server (service role) places a player after the host verified their payment or a PayPal capture
-- (addPaidPlayerToRoster). It acts for the player and must not skip the player's age check. (It cannot write a join
-- request for anyone: validate_join_request needs a signed-in player.)
SELECT t.as_service();
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('nobday')),
  'AGE_VERIFICATION_REQUIRED', 'the server cannot place an account with no birthday in a game');
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('adult')),
  'the server still places an adult');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.game_participants WHERE game_id = 'open' AND user_id = t.id('nobday')), 0,
  'the account with no birthday is not on the roster');

SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('stranger')),
  'an adult still joins an open game themselves');
SELECT t.reset();

-- Once the account adds a birthday, the same write goes through.
SELECT t.as_service();
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('latebday')),
  'AGE_VERIFICATION_REQUIRED', 'another account with no birthday is refused too');
SELECT t.reset();
SELECT t.as_user(t.id('latebday'));
SELECT t.lives($q$SELECT public.set_my_birthday((current_date - interval '25 years')::date)$q$, 'it adds its date of birth');
SELECT t.as_service();
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('latebday')),
  'and is then placed');
SELECT t.reset();

-- ==================================================================================================================
-- 1b. joining a team by invite needs a declared age
-- ==================================================================================================================
SELECT t.team('squad', 'manager');
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by)
VALUES (t.id('inv-nobday'), 'squad', t.id('nobday'), t.id('manager')),
       (t.id('inv-adult'), 'squad', t.id('adult'), t.id('manager')),
       (t.id('inv-nokid'), 'squad', t.id('nokid'), t.id('manager')),
       (t.id('inv-teen'), 'squad', t.id('teen'), t.id('manager'));

SELECT t.as_user(t.id('nobday'));
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', t.id('inv-nobday')),
  'AGE_VERIFICATION_REQUIRED', 'an account with no birthday cannot accept a team invite');
SELECT t.lives(format('SELECT public.team_respond_invite(%L, false)', t.id('inv-nobday')),
  'it can still decline');
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format('SELECT public.team_respond_invite(%L, true)', t.id('inv-adult')), 'an adult accepts as before');
SELECT t.as_user(t.id('parent'));
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('inv-nokid')),
  'AGE_VERIFICATION_REQUIRED', 'a guardian''s approval does not join a child with no birthday to a team');
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('inv-teen')),
  'a guardian''s approval still joins a 16-year-old');
SELECT t.reset();
SELECT t.eq((SELECT array_agg(user_id ORDER BY user_id) FROM public.team_members
              WHERE team_id = 'squad' AND user_id IN (t.id('nobday'), t.id('nokid'), t.id('adult'), t.id('teen'))),
            (SELECT array_agg(u ORDER BY u) FROM unnest(ARRAY[t.id('adult'), t.id('teen')]) u),
  'only the adult and the 16-year-old are on the team');
SELECT t.eq((SELECT status FROM public.team_invites WHERE id = t.id('inv-nokid')), 'pending',
  'the child''s invite waits until they add a birthday');

-- ==================================================================================================================
-- 1c. direct adds by an administrator or a manager: a declared adult only
-- ==================================================================================================================
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('gym'), t.id('orgadmin'), 'Gym', 'gym780');

SELECT t.as_user(t.id('orgadmin'));
SELECT t.lives(format('INSERT INTO public.org_members (org_id, user_id) VALUES (%L, %L)', t.id('gym'), t.id('adult')),
  'an organization''s administrator adds an adult');
SELECT t.throws(format('INSERT INTO public.org_members (org_id, user_id) VALUES (%L, %L)', t.id('gym'), t.id('nobday')),
  'row-level security', 'but not an account with no birthday');
SELECT t.throws(format('INSERT INTO public.org_members (org_id, user_id) VALUES (%L, %L)', t.id('gym'), t.id('teen')),
  'row-level security', 'nor a 16-year-old');
SELECT t.throws(format('INSERT INTO public.org_members (org_id, user_id) VALUES (%L, %L)', t.id('gym'), t.id('kid')),
  'row-level security', 'nor an 11-year-old');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.org_members WHERE org_id = t.id('gym')), 1, 'only the adult was added');

-- A person's own request to join, approved by an administrator, is unchanged.
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format('INSERT INTO public.org_member_requests (id, org_id, user_id) VALUES (%L, %L, %L)',
                      t.id('req-teen'), t.id('gym'), t.id('teen')), 'a 16-year-old asks to join the organization');
SELECT t.as_user(t.id('orgadmin'));
SELECT t.lives(format('SELECT public.approve_org_member_request(%L)', t.id('req-teen')),
  'a minor''s own request to join can still be approved');
SELECT t.reset();

SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($q$INSERT INTO public.team_members (team_id, user_id, role) VALUES ('squad', %L, 'player')$q$, t.id('stranger')),
  'a team manager adds an adult directly');
SELECT t.throws(format($q$INSERT INTO public.team_members (team_id, user_id, role) VALUES ('squad', %L, 'player')$q$, t.id('nobday')),
  'row-level security', 'but not an account with no birthday');
SELECT t.reset();

-- ==================================================================================================================
-- 2. payment handles: an adult payee, and a caller who can see the game or is involved in it
-- ==================================================================================================================
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price, is_private)
VALUES ('pub', t.id('host'), 'Public paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('priv', t.id('host'), 'Private paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, true),
       ('hid', t.id('host'), 'Hidden paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('teenpaid', t.id('teenhost'), 'Teen''s paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false);
-- An account of unknown age can no longer host (block_child_hosting); this is a game from before that rule.
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price, is_private)
VALUES ('nbpaid', t.id('nbhost'), 'Legacy host''s run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false);
SET LOCAL session_replication_role = origin;
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('pub', t.id('host'), 10, true), ('priv', t.id('host'), 10, true), ('hid', t.id('host'), 10, true),
       ('teenpaid', t.id('teenhost'), 10, true), ('nbpaid', t.id('nbhost'), 10, true);
INSERT INTO public.host_payment_methods (host_id, payment_type, username)
VALUES (t.id('host'), 'venmo', 'host-handle'), (t.id('teenhost'), 'venmo', 'teen-real-name'),
       (t.id('nbhost'), 'venmo', 'legacy-handle');
UPDATE public.hosted_games SET hidden_at = now(), moderator_hidden_at = now() WHERE id = 'hid';
SELECT t.as_user(t.id('asker'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
                        VALUES ('priv', %L, %L, 'k-asker')$q$, t.id('asker'), t.id('host')), 'setup: asker asks to join');
SELECT t.as_user(t.id('approved'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
                        VALUES ('priv', %L, %L, 'k-approved'), ('teenpaid', %L, %L, 'k-teenpaid')$q$,
                      t.id('approved'), t.id('host'), t.id('approved'), t.id('teenhost')), 'setup: approved asks to join twice');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now()
                                WHERE player_id = %L$q$, t.id('approved'))), 1, 'setup: the host approves');
SELECT t.as_user(t.id('teenhost'));
SELECT t.eq(t.changed(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now()
                                WHERE player_id = %L$q$, t.id('approved'))), 1, 'setup: the 17-year-old host approves');
SELECT t.reset();
INSERT INTO public.game_participants (game_id, user_id) VALUES ('priv', t.id('playing')), ('hid', t.id('playing'));

CREATE TEMP TABLE pm (game text, payee text);
INSERT INTO pm VALUES ('pub', 'host'), ('priv', 'host'), ('hid', 'host'), ('teenpaid', 'teenhost'), ('nbpaid', 'nbhost');
GRANT SELECT ON pm TO authenticated, anon;
CREATE FUNCTION t.handles(_game text) RETURNS int LANGUAGE sql AS $$
  SELECT t.count(format('SELECT 1 FROM public.get_game_host_payment_methods(%L, %L)',
                        t.id((SELECT payee FROM pm WHERE game = _game)), _game))
$$;

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.handles('pub'), 1, 'a signed-in account that can see a public listing gets an adult host''s handles (kept)');
SELECT t.eq(t.handles('teenpaid'), 0, 'a 16-17-year-old host''s handles are not given to a stranger');
SELECT t.eq(t.handles('nbpaid'), 0, 'nor a host''s whose age is unknown');
SELECT t.eq(t.handles('priv'), 0, 'nor a private game''s to someone who cannot see it');
SELECT t.eq(t.handles('hid'), 0, 'nor a hidden game''s');
SELECT t.as_user(t.id('approved'));
SELECT t.eq(t.handles('priv'), 1, 'an approved requester gets the adult host''s handles');
SELECT t.eq(t.handles('teenpaid'), 0, 'but never a 16-17-year-old host''s, even approved');
SELECT t.as_user(t.id('asker'));
SELECT t.eq(t.handles('priv'), 1, 'someone who asked to join can see the private game, so gets them (the read policy)');
SELECT t.as_user(t.id('playing'));
SELECT t.eq(t.handles('priv'), 1, 'a participant gets them');
SELECT t.eq(t.handles('hid'), 1, 'also for a game a moderator hid (involved)');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.handles('priv'), 1, 'the host gets their own');
SELECT t.as_user(t.id('teenhost'));
SELECT t.eq(t.handles('teenpaid'), 1, 'a 16-17-year-old host still sees their own');
SELECT t.as_anon();
SELECT t.eq(t.handles('pub'), 0, 'a signed-out visitor gets nothing (kept)');
SELECT t.reset();

-- ==================================================================================================================
-- 3. revoke_parental_consent answers nobody about other people's consents
-- ==================================================================================================================
SELECT t.ok(EXISTS (SELECT 1 FROM public.parental_consents WHERE child_user_id = t.id('kid')), 'setup: the kid has a consent record');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.parental_consents WHERE child_user_id = t.id('adult')), 'setup: the adult has none');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('kid')), 'NOT_AUTHORIZED',
  'a stranger asking about a child with a consent record is refused');
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('adult')), 'NOT_AUTHORIZED',
  'and gets the same answer for an account without one');
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('ghost')), 'NOT_AUTHORIZED',
  'and for an account that does not exist');
SELECT t.as_user(t.id('mod'));
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('adult')), 'CONSENT_NOT_FOUND',
  'an authorized caller (a moderator) still learns there is nothing to withdraw');
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format($q$SELECT public.revoke_parental_consent(%L, 'parent decided')$q$, t.id('kid')),
  'the guardian withdraws consent as before');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kid')), 'revoked', 'and it is withdrawn');

-- ==================================================================================================================
-- 4. team_invite_player gives the manager one answer, whoever the target is
-- ==================================================================================================================
SELECT t.team('crew', 'manager');
INSERT INTO public.team_waivers (id, team_id, version, title, content, published, published_at, created_by)
VALUES (t.id('crew-waiver'), 'crew', '1', 'Crew waiver', 'Terms.', true, now(), t.id('manager'));
INSERT INTO public.user_blocks (blocker_id, blocked_id)
VALUES (t.id('blocker'), t.id('manager')), (t.id('teenblock'), t.id('manager'));

SELECT t.as_user(t.id('manager'));
SELECT t.lives(format($q$SELECT public.team_invite_player('crew', %L, 'player', 'Join us')$q$, t.id('adult')),
  'a manager invites an adult');
SELECT t.lives(format($q$SELECT public.team_invite_player('crew', %L, 'player', 'Join us')$q$, t.id('blocker')),
  'and gets the same answer for someone who blocked them (it used to say BLOCKED)');
SELECT t.lives(format($q$SELECT public.team_invite_player('crew', %L, 'player', 'Join us')$q$, t.id('teenblock')),
  'and for a minor who blocked them');
SELECT t.lives(format($q$SELECT public.team_invite_player('crew', %L, 'player', 'Join us')$q$, t.id('ghost')),
  'and for an account that does not exist');
SELECT t.eq(t.count($$SELECT 1 FROM public.team_invites WHERE team_id = 'crew' AND status = 'pending' AND message = 'Join us'$$), 4,
  'the manager sees the four invitations alike');
SELECT t.throws(format($q$SELECT public.team_invite_player('crew', %L, 'player', NULL)$q$, t.id('blocker')),
  'duplicate key', 'inviting again while one is pending fails the same way for someone who blocked them');
SELECT t.throws(format($q$SELECT public.team_invite_player('crew', %L, 'player', NULL)$q$, t.id('adult')),
  'duplicate key', 'as for anyone else');
SELECT t.eq(t.val($$SELECT count(*) FROM public.team_invite_suppressions$$), 'ERROR: permission denied for table team_invite_suppressions',
  'the manager cannot read which invitations were held back');
SELECT t.eq(t.val(format('SELECT private_sec.team_invite_reaches_invitee(%L, %L)',
                         (SELECT id FROM public.team_invites WHERE team_id = 'crew' AND invitee_id = t.id('adult')), t.id('adult'))), 'false',
  'and the helper the read rules use answers nothing to them');
SELECT t.reset();

-- The invitation never reaches the person who blocked the manager, nor their guardians.
CREATE TEMP TABLE crew_inv AS SELECT invitee_id, id FROM public.team_invites WHERE team_id = 'crew';
GRANT SELECT ON crew_inv TO authenticated;
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('adult') AND type = 'team_invite'), 1,
  'the adult is told about their invitation');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id IN (t.id('blocker'), t.id('teenblock')) AND type = 'team_invite'), 0,
  'the people who blocked the manager are not');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('parent') AND type = 'team_invite'), 0,
  'nor is the blocking minor''s guardian');

SELECT t.as_user(t.id('blocker'));
SELECT t.eq(t.count($$SELECT 1 FROM public.team_invites WHERE team_id = 'crew'$$), 0,
  'the person who blocked the manager does not see the invitation');
SELECT t.throws(format('SELECT public.team_respond_invite(%L, true)', (SELECT id FROM crew_inv WHERE invitee_id = t.id('blocker'))),
  'INVITE_NOT_FOUND', 'and cannot accept it');
SELECT t.throws(format('SELECT public.team_respond_invite(%L, false)', (SELECT id FROM crew_inv WHERE invitee_id = t.id('blocker'))),
  'INVITE_NOT_FOUND', 'or answer it at all');
SELECT t.throws(format($q$SELECT public.sign_team_waiver('crew', %L)$q$, t.id('crew-waiver')),
  'NOT_TEAM_MEMBER_OR_INVITEE', 'nor does it let them sign the team''s waiver');
SELECT t.as_user(t.id('parent'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.team_invites WHERE team_id = 'crew' AND invitee_id = %L$q$, t.id('teenblock'))), 0,
  'the blocking minor''s guardian does not see it');
SELECT t.throws(format('SELECT public.guardian_approve_team_invite(%L, true)', (SELECT id FROM crew_inv WHERE invitee_id = t.id('teenblock'))),
  'INVITE_NOT_FOUND', 'and cannot approve it');
SELECT t.as_user(t.id('adult'));
SELECT t.eq(t.count($$SELECT 1 FROM public.team_invites WHERE team_id = 'crew'$$), 1, 'an ordinary invitee still sees theirs');
SELECT t.lives(format($q$SELECT public.sign_team_waiver('crew', %L)$q$, t.id('crew-waiver')), 'signs the waiver');
SELECT t.lives(format('SELECT public.team_respond_invite(%L, true)', (SELECT id FROM crew_inv WHERE invitee_id = t.id('adult'))),
  'and joins');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.team_members WHERE team_id = 'crew' AND user_id IN (t.id('blocker'), t.id('teenblock'))), 0,
  'nobody joined through a held-back invitation');

ROLLBACK;
