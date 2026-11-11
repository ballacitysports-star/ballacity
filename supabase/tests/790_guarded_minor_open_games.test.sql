-- Task #71 (20261111160000): a minor with an active guardian link takes a place in a game only on a request for that
-- game that a current guardian approved, on an open game (no host approval queue) as on a queue game, whoever writes
-- the place. On an open game the request needs the guardian only, never the host. Adults and 16-17-year-olds with no
-- guardian are untouched, and so is every host, payment and cohort rule.
--
-- teeng (16) has guardian ga; kid (14) has guardian gk; teenu (16) has no guardian; adult is 28; grown (18) still has
-- an active link to ga; gb is a second adult who becomes teeng's guardian in section 8.
-- Games: fo* free open, po* paid open (requires_approval false); fq free and pq paid with a host queue.
BEGIN;

SELECT t.person('host', 40), t.person('ga', 41), t.person('gk', 42), t.person('teeng', 16), t.person('teenu', 16),
       t.person('kid', 14), t.person('adult', 28), t.person('grown', 18), t.person('gb', 43);
SELECT t.guardian('ga', 'teeng');
SELECT t.guardian('gk', 'kid');
SELECT t.guardian('ga', 'grown');

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('fo', t.id('host'), 'Free open', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-direct', t.id('host'), 'Free open 0', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-server', t.id('host'), 'Free open 1', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-dodge', t.id('host'), 'Free open 2', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-no', t.id('host'), 'Free open 3', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-stale', t.id('host'), 'Free open 4', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-legacy', t.id('host'), 'Free open 5', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-other', t.id('host'), 'Free open 6', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-hostno', t.id('host'), 'Free open 7', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-gone', t.id('host'), 'Free open 8', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-grown', t.id('host'), 'Free open 9', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('fo-two', t.id('host'), 'Free open 10', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('po', t.id('host'), 'Paid open', 'Basketball', now() + interval '3 days', 'Gym', 10, 10),
       ('po-paypal', t.id('host'), 'Paid open 2', 'Basketball', now() + interval '3 days', 'Gym', 10, 10),
       ('fq', t.id('host'), 'Free queue', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('pq', t.id('host'), 'Paid queue', 'Basketball', now() + interval '3 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('fo', t.id('host'), 0, false), ('fo-direct', t.id('host'), 0, false), ('fo-server', t.id('host'), 0, false),
       ('fo-dodge', t.id('host'), 0, false), ('fo-no', t.id('host'), 0, false),
       ('fo-stale', t.id('host'), 0, false), ('fo-legacy', t.id('host'), 0, false),
       ('fo-other', t.id('host'), 0, false), ('fo-hostno', t.id('host'), 0, false), ('fo-gone', t.id('host'), 0, false),
       ('fo-grown', t.id('host'), 0, false), ('fo-two', t.id('host'), 0, true), ('fo-two', t.id('adult'), 0, false),
       ('po', t.id('host'), 10, false), ('po-paypal', t.id('host'), 10, false),
       ('fq', t.id('host'), 0, true), ('pq', t.id('host'), 10, true);

CREATE FUNCTION pg_temp.place(_game text, _who text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', _game, t.id(_who));
$$;
CREATE FUNCTION pg_temp.ask(_game text, _who text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key) VALUES (%L, %L, %L, %L, %L)',
                t.id('req-' || _game || '-' || _who), _game, t.id(_who), t.id('host'), 'k-' || _game || '-' || _who);
$$;
CREATE FUNCTION pg_temp.pay(_game text, _who text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, %L, %L)',
                t.id('pay-' || _game || '-' || _who), t.id(_who), _game, t.id('host'));
$$;
CREATE FUNCTION pg_temp.approve(_game text, _who text, _yes boolean DEFAULT true) RETURNS text LANGUAGE sql AS $$
  SELECT format('SELECT public.guardian_approve_join_request(%L, %L)', t.id('req-' || _game || '-' || _who), _yes);
$$;
GRANT EXECUTE ON FUNCTION pg_temp.place(text, text), pg_temp.ask(text, text), pg_temp.pay(text, text),
                          pg_temp.approve(text, text, boolean) TO authenticated, service_role;

-- ---- 1. free open game, no request: a guarded minor cannot take a place directly --------------------------------
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fo-direct', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'a 16-17 with a guardian cannot join a free open game with no request');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(pg_temp.place('fo-direct', 'kid'), 'GUARDIAN_APPROVAL_REQUIRED',
  'a 13-15 with a guardian cannot join a free open game with no request');
SELECT t.as_service();
SELECT t.throws(pg_temp.place('fo-server', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'nor can the server place a guarded minor with no approved request');
SELECT t.as_user(t.id('teenu'));
SELECT t.lives(pg_temp.place('fo-direct', 'teenu'), 'a 16-17 with no guardian still joins a free open game directly');
SELECT t.as_user(t.id('adult'));
SELECT t.lives(pg_temp.place('fo-direct', 'adult'), 'an adult still joins a free open game directly');
SELECT t.reset();

-- ---- 2. deleting one's own request does not reopen the direct join -----------------------------------------------
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.ask('fo-dodge', 'teeng'), 'the child asks on an open game');
SELECT t.throws(pg_temp.place('fo-dodge', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED', 'and cannot join before the guardian answers');
SELECT t.eq(t.changed(format($q$DELETE FROM public.join_requests WHERE id = %L$q$, t.id('req-fo-dodge-teeng'))), 1,
  'the child can still take their request back');
SELECT t.throws(pg_temp.place('fo-dodge', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'and with the request gone, the direct join is still refused');
SELECT t.reset();

-- ---- 3. free open game: the guardian alone answers, the host is not needed ----------------------------------------
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.ask('fo', 'teeng'), 'the 16-17 asks their guardian about the free open game');
SELECT t.as_user(t.id('kid'));
SELECT t.lives(pg_temp.ask('fo', 'kid'), 'the 13-15 asks too');
SELECT t.as_user(t.id('ga'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.join_requests WHERE id = %L$q$, t.id('req-fo-teeng'))), 1,
  'the guardian can see the request they are asked about');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.join_requests WHERE id = %L$q$, t.id('req-fo-kid'))), 0,
  'and not another family''s');
SELECT t.throws(pg_temp.approve('fo', 'kid'), 'NOT_GUARDIAN', 'another child''s guardian cannot approve it');
SELECT t.lives(pg_temp.approve('fo', 'teeng'), 'the guardian approves');
SELECT t.as_user(t.id('gk'));
SELECT t.lives(pg_temp.approve('fo', 'kid'), 'the 13-15''s guardian approves');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.join_requests WHERE id = t.id('req-fo-teeng')), 'pending',
  'the guardian''s approval does not answer for the host: the request stays pending');
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.place('fo', 'teeng'), 'with the guardian''s approval the 16-17 joins the free open game');
SELECT t.as_user(t.id('kid'));
SELECT t.lives(pg_temp.place('fo', 'kid'), 'and so does the 13-15');
SELECT t.reset();

-- ---- 4. a guardian's no, or an approval that no longer counts, keeps the place closed -----------------------------
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.ask('fo-no', 'teeng'), 'the child asks about another game');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('fo-no', 'teeng', false), 'the guardian says no');
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fo-no', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED', 'a declined request does not give a place');
SELECT t.lives(pg_temp.ask('fo-stale', 'teeng'), 'the child asks about a third game');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('fo-stale', 'teeng'), 'the guardian approves it');
SELECT t.reset();
-- The server writes as service_role; here it leaves a stamp naming someone who is not the child's guardian.
UPDATE public.join_requests SET guardian_approved_by = t.id('adult') WHERE id = t.id('req-fo-stale-teeng');
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fo-stale', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'an approval stamp from someone who is not the guardian does not give a place');
SELECT t.reset();

-- ---- 5. paid open game: the request makes payment possible, and the server places them after the host verifies ----
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.pay('po', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'a guarded 16-17 still cannot pay for an open game before their guardian approves');
SELECT t.lives(pg_temp.ask('po', 'teeng'), 'the child asks their guardian about the paid open game');
SELECT t.throws(pg_temp.pay('po', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED', 'and still cannot pay while the request waits');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('po', 'teeng'), 'the guardian approves');
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.pay('po', 'teeng'), 'with the guardian''s approval alone the child can send the payment');
SELECT t.throws(pg_temp.place('po', 'teeng'), 'GAME_PAYMENT_REQUIRED', 'the place still waits for the host to confirm the fee');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.payment_submissions SET status = 'verified', reviewed_at = now() WHERE id = %L$q$,
                             t.id('pay-po-teeng'))), 1, 'the host verifies the payment');
SELECT t.as_service();
SELECT t.lives(pg_temp.place('po', 'teeng'), 'and the server places the child');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.join_requests WHERE id = t.id('req-po-teeng')), 'pending',
  'the host never had to answer the request');

SELECT t.as_user(t.id('kid'));
SELECT t.lives(pg_temp.ask('po', 'kid'), 'a 13-15 can ask about a paid open game');
SELECT t.as_user(t.id('gk'));
SELECT t.lives(pg_temp.approve('po', 'kid'), 'and their guardian can approve');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(pg_temp.pay('po', 'kid'), 'PAYMENTS_NOT_AVAILABLE', 'but a 13-15 still cannot pay');
SELECT t.as_user(t.id('teenu'));
SELECT t.lives(pg_temp.pay('po', 'teenu'), 'a 16-17 with no guardian still pays with no request');
SELECT t.as_user(t.id('adult'));
SELECT t.lives(pg_temp.pay('po', 'adult'), 'an adult still pays with no request');
SELECT t.reset();

-- A payment the server records with nobody signed in (PayPal, the #397 stack's concern) does not give a guarded minor
-- a place without the guardian's approval: unchanged, and now for the same reason as a direct join.
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (game_id, player_id, host_id, paid_amount, status, reviewed_at, paid_at, notes, payment_type)
                        VALUES ('po-paypal', %L, %L, 10, 'verified', now(), now(), 'Paid with PayPal checkout', 'paypal')$q$,
                     t.id('teeng'), t.id('host')), 'the server records a payment with no request');
SELECT t.throws(pg_temp.place('po-paypal', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'and still cannot place the guarded minor on it');
SELECT t.reset();

-- ---- 6. queue games: unchanged, the guardian and the host both answer -----------------------------------------------
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.ask('fq', 'teeng'), 'the child asks on a queue game');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('fq', 'teeng'), 'the guardian approves');
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fq', 'teeng'), 'GAME_APPROVAL_REQUIRED', 'the guardian''s approval alone is not enough on a queue game');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = %L$q$,
                             t.id('req-fq-teeng'))), 1, 'the host approves');
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.place('fq', 'teeng'), 'with both answers the child joins the queue game');
SELECT t.as_user(t.id('adult'));
SELECT t.lives(pg_temp.ask('fq', 'adult'), 'an adult asks on the queue game');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = %L$q$,
                             t.id('req-fq-adult'))), 1, 'the host approves the adult');
SELECT t.as_user(t.id('adult'));
SELECT t.lives(pg_temp.place('fq', 'adult'), 'and the adult joins on the host''s answer alone');

SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.ask('pq', 'teeng'), 'the child asks on a paid queue game');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = %L$q$,
                             t.id('req-pq-teeng'))), 1, 'the host approves first');
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.pay('pq', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED', 'payment still waits for the guardian');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('pq', 'teeng'), 'the guardian approves');
SELECT t.as_user(t.id('teeng'));
SELECT t.lives(pg_temp.pay('pq', 'teeng'), 'then the child can pay');
SELECT t.reset();

-- ---- 7. places already taken are kept: the gate runs before INSERT only ----------------------------------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('fo-legacy', t.id('teeng'));
SET LOCAL session_replication_role = origin;
SELECT t.eq((SELECT count(*)::int FROM pg_trigger
              WHERE tgrelid = 'public.game_participants'::regclass AND NOT tgisinternal
                AND tgfoid = 'public.enforce_child_game_participation()'::regprocedure
                AND tgtype::int & (2 | 4 | 8 | 16) = (2 | 4)), 1,
  'the roster gate is a BEFORE INSERT trigger, so rows already written are not re-checked');
SELECT t.eq((SELECT count(*)::int FROM public.game_participants WHERE game_id = 'fo-legacy' AND user_id = t.id('teeng')), 1,
  'a place taken before the migration is still there');

-- ---- 8. an approval opens one game, from a current guardian, and the host's no still counts (task #71 review) -----
-- teeng's approval for 'fo' (section 3) does not open another open game.
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fo-other', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'the guardian''s approval for one game does not open another');
-- The host turns a request to the parent down (through the API): a rejected request gives no place.
SELECT t.lives(pg_temp.ask('fo-hostno', 'teeng'), 'the child asks about another open game');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('fo-hostno', 'teeng'), 'the guardian approves it');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now() WHERE id = %L$q$,
                             t.id('req-fo-hostno-teeng'))), 1, 'the host turns the request down');
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fo-hostno', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'a request the host turned down gives no place, whatever the guardian said');
-- An approval from a guardian whose link has ended does not count once someone else is the guardian.
SELECT t.lives(pg_temp.ask('fo-gone', 'teeng'), 'the child asks about one more open game');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(pg_temp.approve('fo-gone', 'teeng'), 'the guardian approves it');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('teeng');
SELECT t.guardian('gb', 'teeng');
SELECT t.as_user(t.id('teeng'));
SELECT t.throws(pg_temp.place('fo-gone', 'teeng'), 'GUARDIAN_APPROVAL_REQUIRED',
  'an approval from a guardian who is no longer linked does not give a place');
-- An adult whose guardian link is still active is not a minor: the roster gate lets them join directly.
SELECT t.as_user(t.id('grown'));
SELECT t.lives(pg_temp.place('fo-grown', 'grown'), 'an 18-year-old with a link still active joins an open game directly');
SELECT t.reset();

-- The host's list of requests hides a request to the parent only when the game's own settings say it is open
-- (withoutGuardianOnly). The host reads only the payee's settings row, so a second, stale row cannot hide a request
-- the host must answer.
SELECT t.as_user(t.id('host'));
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id = 'fo-two'), 1,
  'a host reads one settings row for their game, though two exist');
SELECT t.eq((SELECT requires_approval FROM public.game_payment_settings WHERE game_id = 'fo-two'), true,
  'and it is the payee''s row');
SELECT t.as_user(t.id('adult'));
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id = 'fo-two'), 0,
  'the owner of the other row reads none, so their list keeps every request');
SELECT t.reset();

ROLLBACK;
