-- A player writes their own game_participants row, so the rules the join screen
-- shows have to hold in the database: host approval, a confirmed fee, a game
-- that has not ended, a free seat, and the guardian's controls for a minor.
BEGIN;

SELECT t.person('host', 35), t.person('adult', 29), t.person('other', 31), t.person('guardian', 41),
       t.person('teenmid', 14), t.person('teenold', 17), t.person('kidyoung', 10);
SELECT t.guardian('guardian', 'teenmid');
SELECT t.guardian('guardian', 'teenold');
SELECT t.guardian('guardian', 'kidyoung');

INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('open',      t.id('host'), 'basketball', 'Open run',        now() + interval '2 days', 10),
  ('approval',  t.id('host'), 'basketball', 'Approval run',    now() + interval '2 days', 10),
  ('nosetting', t.id('host'), 'basketball', 'Never configured', now() + interval '2 days', 10),
  ('paidopen',  t.id('host'), 'basketball', 'Paid open run',   now() + interval '2 days', 10),
  ('paidappr',  t.id('host'), 'basketball', 'Paid approval',   now() + interval '2 days', 10),
  ('past',      t.id('host'), 'basketball', 'Last week',       now() - interval '3 days', 10),
  ('pastlong',  t.id('host'), 'basketball', 'Still going',     now() - interval '1 hour', 10),
  ('closed',    t.id('host'), 'basketball', 'Closed run',      now() + interval '2 days', 10),
  ('closedpay', t.id('host'), 'basketball', 'Closed paid run', now() + interval '2 days', 10),
  ('tiny',      t.id('host'), 'basketball', 'One seat',        now() + interval '2 days', 1);
UPDATE public.hosted_games SET duration = '3 hours' WHERE id = 'pastlong';

INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES
  ('open',      t.id('host'),  0, false),
  ('approval',  t.id('host'),  0, true),
  ('paidopen',  t.id('host'), 10, false),
  ('paidappr',  t.id('host'), 10, true),
  ('past',      t.id('host'),  0, false),
  ('pastlong',  t.id('host'),  0, false),
  ('closed',    t.id('host'),  0, false),
  ('closedpay', t.id('host'), 10, true),
  ('tiny',      t.id('host'),  0, false);

-- A player asks to join; with _approve the host then approves, the way each does
-- it in the app (the player files the request, only the host can approve it).
CREATE FUNCTION pg_temp.request(_game text, _player text, _key text, _approve boolean) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE rid uuid := t.id('req-' || _game || '-' || _player);
BEGIN
  PERFORM t.as_user(t.id(_player));
  INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
  VALUES (rid, _game, t.id(_player), t.id('host'), _key);
  IF _approve THEN
    PERFORM t.as_user(t.id('host'));
    UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = rid;
  END IF;
  PERFORM t.reset();
  RETURN rid;
END $$;

-- ---- instant-join games ----------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('adult')),
  'a player joins a free instant-join game on their own');
SELECT t.reset();

-- ---- host approval ---------------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('adult')),
  'GAME_APPROVAL_REQUIRED', 'a player cannot skip the host''s approval by writing their own roster row');
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'nosetting', t.id('adult')),
  'GAME_APPROVAL_REQUIRED', 'a game the host never configured is request-to-join, as the screen treats it');
SELECT t.reset();

SELECT pg_temp.request('approval', 'adult', 'a1', false);
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('adult')),
  'GAME_APPROVAL_REQUIRED', 'asking is not being approved');
SELECT t.reset();

SELECT t.as_user(t.id('host'));
UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-approval-adult');
SELECT t.reset();
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('adult')),
  'an approved player takes their place');
SELECT t.reset();

-- A different player's approval is no use to someone else.
SELECT t.as_user(t.id('other'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('other')),
  'GAME_APPROVAL_REQUIRED', 'another player''s approval does not carry over');
SELECT t.reset();

-- The host runs their own game without asking themselves.
SELECT t.as_user(t.id('host'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('host')),
  'the host can put themselves on their own roster');
SELECT t.reset();

-- ---- the entry fee ---------------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'paidopen', t.id('adult')),
  'GAME_PAYMENT_REQUIRED', 'a paid game does not take a player who has not paid');
SELECT t.reset();

INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, status)
VALUES ('paidopen', t.id('host'), t.id('adult'), 'venmo', 'pending');
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'paidopen', t.id('adult')),
  'GAME_PAYMENT_REQUIRED', 'a payment the host has not confirmed does not count');
SELECT t.reset();

SELECT t.as_user(t.id('host'));
UPDATE public.payment_submissions SET status = 'verified', reviewed_at = now()
WHERE game_id = 'paidopen' AND player_id = t.id('adult');
SELECT t.reset();
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'paidopen', t.id('adult')),
  'a player whose fee the host confirmed takes their place');
SELECT t.reset();

-- Approval alone does not cover a fee.
SELECT pg_temp.request('paidappr', 'adult', 'a2', true);
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'paidappr', t.id('adult')),
  'GAME_PAYMENT_REQUIRED', 'an approved player on a paid game still has to be confirmed as paid');
SELECT t.reset();

-- The server adds a player whose payment it has just verified (service role).
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'paidappr', t.id('adult')),
  'the server can roster a player it has just verified');

-- ---- a game that is over ---------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'past', t.id('adult')),
  'GAME_COMPLETED', 'nobody joins a game that ended days ago');
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'pastlong', t.id('adult')),
  'a game still inside its length is not over');
SELECT t.reset();

-- ---- the host closed joining -----------------------------------------------
-- (approved before the host closed, for the paid game)
SELECT pg_temp.request('closedpay', 'adult', 'a3', true);
UPDATE public.hosted_games SET joins_closed = true WHERE id IN ('closed', 'closedpay');
SELECT t.as_user(t.id('other'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'closed', t.id('other')),
  'GAME_JOINS_CLOSED', 'new players cannot join once the host closed joining');
SELECT t.reset();

-- A player approved before the host closed still gets their place once they pay.
INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, status)
VALUES ('closedpay', t.id('host'), t.id('adult'), 'venmo', 'pending');
SELECT t.as_user(t.id('host'));
UPDATE public.payment_submissions SET status = 'verified', reviewed_at = now()
WHERE game_id = 'closedpay' AND player_id = t.id('adult');
SELECT t.reset();
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'closedpay', t.id('adult')),
  'the server can roster an approved, paid player after the host closed joining');

-- ---- capacity --------------------------------------------------------------
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'tiny', t.id('adult')),
  'the last seat goes to the first player');
SELECT t.as_user(t.id('other'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'tiny', t.id('other')),
  'GAME_FULL', 'the next player is told the roster is full');
SELECT t.reset();

-- ---- a minor, and what their guardian has set ------------------------------
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('teenmid')),
  'a teen with a guardian joins an instant-join game when nothing is switched off');
SELECT t.reset();
DELETE FROM public.game_participants WHERE user_id = t.id('teenmid');

-- The guardian turns "Can join games" off.
UPDATE public.child_controls SET game_participation = false
WHERE child_user_id IN (t.id('teenmid'), t.id('teenold'));
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('teenmid')),
  'CHILD_GAME_PARTICIPATION_BLOCKED', 'a 14 year old cannot join while their guardian has joining switched off');
SELECT t.as_user(t.id('teenold'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('teenold')),
  'CHILD_GAME_PARTICIPATION_BLOCKED', 'nor can a 17 year old');
SELECT t.reset();

-- A guardian who is no longer linked has no switch to flip, so it stops applying.
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('teenold');
SELECT t.as_user(t.id('teenold'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('teenold')),
  'a revoked guardian link no longer holds a 17 year old back');
SELECT t.reset();

-- Switching it back on lets the 14 year old in.
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teenmid');
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('teenmid')),
  'switching joining back on lets the 14 year old in');
SELECT t.reset();
DELETE FROM public.game_participants WHERE user_id = t.id('teenmid');

-- Withdrawn consent locks a 13-15 account out of games, as it does for teams and reels.
UPDATE public.parental_consents SET status = 'revoked', revoked_at = now() WHERE child_user_id = t.id('teenmid');
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('teenmid')),
  'CHILD_GAME_PARTICIPATION_BLOCKED', 'a 14 year old whose consent was withdrawn cannot join');
SELECT t.reset();
UPDATE public.parental_consents SET status = 'approved', revoked_at = NULL WHERE child_user_id = t.id('teenmid');

-- A minor with a guardian cannot skip the host's approval, or the guardian's, by
-- writing the roster row themselves with no request.
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('teenmid')),
  'GAME_APPROVAL_REQUIRED', 'a minor cannot skip the host''s approval with no request');
SELECT t.reset();

-- Host-approved, but the guardian has not approved this request yet.
SELECT pg_temp.request('approval', 'teenmid', 'a4', true);
SELECT t.as_user(t.id('teenmid'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('teenmid')),
  'GUARDIAN_APPROVAL_REQUIRED', 'host approval alone is not enough for a minor with a guardian');
SELECT t.reset();
UPDATE public.join_requests SET guardian_approved_at = now(), guardian_approved_by = t.id('guardian')
WHERE id = t.id('req-approval-teenmid');
SELECT t.as_user(t.id('teenmid'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'approval', t.id('teenmid')),
  'with the host and the guardian both approving, the minor takes their place');
SELECT t.reset();

-- Under 13: off until the guardian turns it on, and consent still applies.
SELECT t.as_user(t.id('kidyoung'));
SELECT t.lives(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('kidyoung')),
  'an under-13 whose guardian turned joining on can join an instant-join game');
SELECT t.reset();
DELETE FROM public.game_participants WHERE user_id = t.id('kidyoung');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('kidyoung');
SELECT t.as_user(t.id('kidyoung'));
SELECT t.throws(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', 'open', t.id('kidyoung')),
  'CHILD_GAME_PARTICIPATION_BLOCKED', 'an under-13 cannot join while joining is off');
SELECT t.reset();

-- ---- how a game's length is read -------------------------------------------
SELECT t.eq(public.game_duration_minutes('90 min'), 90, 'duration: 90 min');
SELECT t.eq(public.game_duration_minutes('1.5 h'), 90, 'duration: 1.5 h');
SELECT t.eq(public.game_duration_minutes('2 hours'), 120, 'duration: 2 hours');
SELECT t.eq(public.game_duration_minutes('all day'), 90, 'duration: unreadable is 90 minutes');
SELECT t.eq(public.game_duration_minutes(NULL), 90, 'duration: missing is 90 minutes');
SELECT t.eq(public.game_duration_minutes('0 min'), 90, 'duration: zero is 90 minutes');
SELECT t.eq(public.game_duration_minutes('999999 h'), 20160, 'duration: absurd values are capped');

ROLLBACK;
