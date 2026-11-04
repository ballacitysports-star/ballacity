-- SEC-8: payment writes and payment reads are not oracles. Inserting a payment or a join request for someone else, or naming a guessed
-- payee, gives one answer whoever the other account is; a self-made payment claim unlocks no handles and no messaging; the PayPal merchant
-- id is the payee's and only for people who can see or are involved with the game.
BEGIN;
SELECT t.person('ahost', 35), t.person('stranger', 44), t.person('teenhost', 17), t.person('guardian', 40), t.person('other', 50),
       t.person('payer', 29), t.person('kid', 15), t.person('gk', 41), t.person('teen', 16), t.person('gt', 42), t.person('victim', 31),
       t.person('member', 27);
SELECT t.guardian('guardian', 'teenhost'), t.guardian('gk', 'kid'), t.guardian('gt', 'teen');

-- The error a statement raises, or NULL. Lets a test compare two refusals for equality.
CREATE FUNCTION t.err(stmt text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE stmt;
  EXCEPTION WHEN OTHERS THEN
    RETURN SQLERRM;
  END;
  RETURN NULL;
END $$;
GRANT EXECUTE ON FUNCTION t.err(text) TO PUBLIC;

-- a paid game hosted by a 17-year-old, with the guardian as payment manager, and NO payment settings row
SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.pay', public.grant_minor_hosting_approval(t.id('teenhost'), 168, true)::text, false);
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, min_age, max_age, hosting_approval_id) VALUES ('m-paid', %L, 'basketball', 'paid youth run', now()+interval '3 days', 10, 13, 17, %L)$q$, t.id('teenhost'), current_setting('t.pay')::uuid),
  'setup: a paid minor-hosted game with a guardian payment manager');
SELECT t.reset();
SELECT t.eq(private_sec.game_payee('m-paid'), t.id('guardian'), 'setup: the payee is the guardian');
INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (t.id('guardian'), 'venmo', 'guardian-real-name');
INSERT INTO public.host_paypal_accounts (host_id, merchant_id) VALUES (t.id('guardian'), 'MERCH-GUARDIAN');
SET LOCAL session_replication_role = replica;
INSERT INTO public.host_paypal_accounts (host_id, merchant_id) VALUES (t.id('teenhost'), 'MERCH-TEEN');   -- legacy row of the minor
SET LOCAL session_replication_role = origin;

-- adult-hosted games
INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('pub-open', t.id('ahost'), 'basketball', 'open run', now()+interval '3 days');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('pub-open', t.id('ahost'), 10, false);
INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('pub-nosettings', t.id('ahost'), 'basketball', 'run', now()+interval '3 days');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, is_private, location) VALUES ('priv-a', t.id('ahost'), 'basketball', 'private run', now()+interval '3 days', true, 'Gym');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('priv-a', t.id('ahost'), 10, false);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('priv-a', t.id('member'));
SET LOCAL session_replication_role = origin;
INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (t.id('ahost'), 'venmo', 'ahost-handle');
INSERT INTO public.host_paypal_accounts (host_id, merchant_id) VALUES (t.id('ahost'), 'MERCH-AHOST');

-- ============================================================ 1. a payment insert does not confirm who the payee is
SELECT t.as_user(t.id('stranger'));
SELECT set_config('t.e_other', t.err(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'm-paid', %L)$q$, t.id('stranger'), t.id('other'))), true);
SELECT set_config('t.e_teen', t.err(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'm-paid', %L)$q$, t.id('stranger'), t.id('teenhost'))), true);
SELECT set_config('t.e_guard', t.err(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'm-paid', %L)$q$, t.id('stranger'), t.id('guardian'))), true);
SELECT t.reset();
SELECT t.ok(current_setting('t.e_other') ILIKE '%Host approval required%', '1: a stranger guessing an unrelated adult as payee is refused for approval');
SELECT t.eq(current_setting('t.e_teen'), current_setting('t.e_other'), '1: guessing the minor host gives the identical error');
SELECT t.eq(current_setting('t.e_guard'), current_setting('t.e_other'), '1: guessing the real guardian payee gives the identical error');
-- an approved player's payment goes to the payee whatever host_id they send
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, reviewed_at) VALUES ('m-paid', t.id('payer'), t.id('teenhost'), 'kp', 'approved', now() - interval '1 minute');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('payer'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, 'm-paid', %L)$q$, t.id('ps-payer'), t.id('payer'), t.id('other')),
  '1: an approved player naming an unrelated account still pays');
SELECT t.reset();
SELECT t.eq((SELECT host_id FROM public.payment_submissions WHERE id = t.id('ps-payer')), t.id('guardian'), '1: and the row names the payee the database chose');

-- ============================================================ 2. missing settings fail closed; a self-made claim unlocks nothing
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'm-paid', %L)$q$, t.id('stranger'), t.id('guardian')),
  'Host approval required', '2: a paid minor-hosted game with no settings row needs approval before payment');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'pub-nosettings', %L)$q$, t.id('stranger'), t.id('ahost')),
  'Host approval required', '2: so does an adult game with no settings row');
SELECT t.reset();
-- even a settings row saying "no approval" does not lift it for a host who is not a confirmed adult
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('m-paid', t.id('guardian'), 10, false);
SET LOCAL session_replication_role = origin;
SELECT t.ok(private_sec.payment_requires_approval('m-paid'), '2: a minor-hosted game always requires approval before payment');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'm-paid', %L)$q$, t.id('stranger'), t.id('guardian')),
  'Host approval required', '2: and the stranger''s insert is still refused');
SELECT t.reset();
-- self-made claims written before this release (or by any path that skipped approval): pending and rejected
SET LOCAL session_replication_role = replica;
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (t.id('stranger'), 'm-paid', t.id('guardian'), 'pending');
INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (t.id('stranger'), 'm-paid', t.id('guardian'), 'rejected');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_host_payment_methods(t.id('guardian'))), 0, '2: a self-made pending or rejected claim gets the stranger no guardian handles');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('guardian'), 'm-paid')), 0, '2: nor through the game-scoped call');
SELECT t.reset();
SELECT t.ok(NOT private_sec.can_notify(t.id('stranger'), t.id('guardian')), '2: and no channel to notify the guardian');
SELECT t.ok(NOT private_sec.payer_to_payee(t.id('stranger'), t.id('guardian')), '2: it is not a payment relation');
SELECT t.ok(private_sec.payer_to_payee(t.id('payer'), t.id('guardian')), '2: a payment made after an approved request is');
SELECT t.as_user(t.id('payer'));
SELECT t.eq((SELECT count(*)::int FROM public.get_host_payment_methods(t.id('guardian'))), 1, '2: and the approved player sees the guardian''s handle');
SELECT t.reset();

-- the same for a private adult game whose host does not require approval
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, 'priv-a', %L)$q$, t.id('ps-priv'), t.id('stranger'), t.id('ahost')),
  '2: setup: a stranger files a pending claim on a private adult game that needs no approval');
SELECT t.eq((SELECT count(*)::int FROM public.get_host_payment_methods(t.id('ahost'))), 0, '2: the pending claim gets them no handles of the private game''s host');
SELECT t.reset();
SELECT t.ok(NOT private_sec.can_notify(t.id('stranger'), t.id('ahost')), '2: nor a channel to notify that host');
SELECT t.as_user(t.id('ahost'));
SELECT t.lives(format($q$UPDATE public.payment_submissions SET status = 'rejected' WHERE id = %L$q$, t.id('ps-priv')), '2: setup: the host marks the claim rejected');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_host_payment_methods(t.id('ahost'))), 0, '2: nor once it is rejected');
SELECT t.reset();
SELECT t.ok(NOT private_sec.can_notify(t.id('stranger'), t.id('ahost')), '2: still no channel');
SELECT t.as_user(t.id('ahost'));
SELECT t.lives(format($q$UPDATE public.payment_submissions SET status = 'verified' WHERE id = %L$q$, t.id('ps-priv')), '2: setup: the host marks the claim verified');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_host_payment_methods(t.id('ahost'))), 1, '2: once the host verifies the payment the handle is shown');
SELECT t.reset();
SELECT t.ok(private_sec.can_notify(t.id('stranger'), t.id('ahost')), '2: and the payer may notify the host');

-- ============================================================ 3. a payment for someone else reveals nothing about them
SELECT t.as_user(t.id('stranger'));
SELECT set_config('t.p_kid', t.err(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'pub-open', %L)$q$, t.id('kid'), t.id('ahost'))), true);
SELECT set_config('t.p_teen', t.err(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'pub-open', %L)$q$, t.id('teen'), t.id('ahost'))), true);
SELECT set_config('t.p_adult', t.err(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'pub-open', %L)$q$, t.id('victim'), t.id('ahost'))), true);
SELECT t.reset();
SELECT t.ok(current_setting('t.p_kid') ILIKE '%PAYMENT_PLAYER_INVALID%', '3: a payment for a 15-year-old is refused as "not yourself"');
SELECT t.eq(current_setting('t.p_teen'), current_setting('t.p_kid'), '3: a guardian-linked 16-year-old gives the identical error');
SELECT t.eq(current_setting('t.p_adult'), current_setting('t.p_kid'), '3: an adult gives the identical error');
SELECT t.as_anon();
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'pub-open', %L)$q$, t.id('kid'), t.id('ahost')),
  'permission denied', '3: an anonymous visitor cannot reach the table (no trigger runs for them)');
SELECT t.reset();
-- 8. the host cannot write a payment for a player either (there is no "mark paid" insert)
SELECT t.as_user(t.id('ahost'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (%L, 'priv-a', %L, 'verified')$q$, t.id('member'), t.id('ahost')),
  'PAYMENT_PLAYER_INVALID', '8: a host cannot record a payment for a player by inserting it');
SELECT t.reset();

-- ============================================================ 5. the guardian-first rule holds for the service role; the server's precondition check
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (%L, 'pub-open', %L, 'verified')$q$, t.id('teen'), t.id('ahost')),
  'GUARDIAN_APPROVAL_REQUIRED', '5: the service role cannot record a payment for a guardian-linked teen before the guardian approves');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (%L, 'pub-nosettings', %L, 'verified')$q$, t.id('victim'), t.id('ahost')),
  'Host approval required', '5: nor for a player whose request was never approved');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, status) VALUES (%L, 'pub-open', %L, 'verified')$q$, t.id('victim'), t.id('ahost')),
  '5: an adult on a game that needs no approval is recorded');
SELECT t.eq(public.payment_precondition_error('pub-open', t.id('teen')), 'GUARDIAN_APPROVAL_REQUIRED', '5: precondition: guardian approval missing');
SELECT t.eq(public.payment_precondition_error('pub-nosettings', t.id('victim')), 'HOST_APPROVAL_REQUIRED', '5: precondition: host approval missing');
SELECT t.eq(public.payment_precondition_error('pub-open', t.id('kid')), 'PAYMENTS_NOT_AVAILABLE', '5: precondition: a 15-year-old cannot pay');
SELECT t.eq(public.payment_precondition_error('pub-open', t.id('ahost')), 'PAYMENT_DESTINATION_INVALID', '5: precondition: the payee cannot pay themselves');
SELECT t.eq(public.payment_precondition_error('m-paid', t.id('payer')), NULL::text, '5: precondition: an approved adult may pay');
SELECT t.eq(public.payment_precondition_error('nope', t.id('payer')), 'GAME_NOT_FOUND', '5: precondition: unknown game');
SELECT t.reset();
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.payment_precondition_error(text,uuid)', 'EXECUTE'), '5: signed-in users cannot call the precondition check');
SELECT t.ok(NOT has_function_privilege('anon', 'public.payment_precondition_error(text,uuid)', 'EXECUTE'), '5: nor anonymous visitors');

-- ============================================================ 4. a join request or roster row for someone else reveals nothing about their age
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES ('age15', t.id('ahost'), 'basketball', 'u15', now()+interval '3 days', 15, 15);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES ('age16', t.id('ahost'), 'basketball', 'u16', now()+interval '3 days', 16, 16);
SELECT t.as_user(t.id('stranger'));
SELECT set_config('t.j15', t.err(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('age15', %L, %L, 'x15')$q$, t.id('kid'), t.id('ahost'))), true);
SELECT set_config('t.j16', t.err(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('age16', %L, %L, 'x16')$q$, t.id('kid'), t.id('ahost'))), true);
SELECT set_config('t.g15', t.err(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('age15', %L)$q$, t.id('kid'))), true);
SELECT set_config('t.g16', t.err(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('age16', %L)$q$, t.id('kid'))), true);
SELECT t.reset();
SELECT t.ok(current_setting('t.j15') ILIKE '%Cannot create a join request for another player%', '4: a join request for a 15-year-old on a 15-only game is refused as "another player"');
SELECT t.eq(current_setting('t.j16'), current_setting('t.j15'), '4: on a 16-only game the error is identical');
SELECT t.ok(current_setting('t.g15') ILIKE '%Cannot add another player%', '4: a roster row for the 15-year-old is refused as "another player"');
SELECT t.eq(current_setting('t.g16'), current_setting('t.g15'), '4: identically on the 16-only game');
-- the host is refused the same way (a host who can edit min/max age learns nothing)
SELECT t.as_user(t.id('ahost'));
SELECT t.eq(t.err(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('age16', %L, %L, 'h16')$q$, t.id('kid'), t.id('ahost'))),
  current_setting('t.j15'), '4: the host of the game gets the same join-request refusal');
SELECT t.eq(t.err(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('age16', %L)$q$, t.id('kid'))),
  current_setting('t.g15'), '4: and the same roster refusal');
SELECT t.reset();
-- a guardian also goes through the guardian functions, not a direct row
SELECT t.as_user(t.id('gk'));
SELECT t.eq(t.err(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('age15', %L)$q$, t.id('kid'))),
  current_setting('t.g15'), '4: a guardian cannot write the child''s roster row directly either');
SELECT t.reset();
-- the server (service role) rostering a paid player is not affected by the self-only rule
SELECT t.as_service();
SELECT t.ok(COALESCE(t.err(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('pub-open', %L)$q$, t.id('victim'))), '') NOT ILIKE '%another player%',
  '4: the service role can still add a paid player to the roster');
SELECT t.reset();
-- the player's own request still gets the real checks
SELECT t.as_user(t.id('victim'));
SELECT t.throws(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('age15', %L, %L, 'v15')$q$, t.id('victim'), t.id('ahost')),
  '', '4: an adult''s own request to a 15-only game is still refused by the age rule');
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('pub-nosettings', %L, %L, 'vok')$q$, t.id('victim'), t.id('ahost')),
  '4: and their own request to an open game still works');
SELECT t.reset();

-- ============================================================ 6. the PayPal merchant id is the payee's, for involved callers only
SELECT t.ok(NOT has_function_privilege('anon', 'public.get_game_host_paypal(text)', 'EXECUTE'), '6: anonymous visitors cannot call get_game_host_paypal');
SELECT t.as_anon();
SELECT t.eq(t.count($q$SELECT 1 FROM public.get_game_host_paypal('pub-open')$q$), 0, '6: anon gets nothing');
SELECT t.reset();
SELECT t.as_user(t.id('other'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.get_game_host_paypal('m-paid')$q$), 0, '6: a stranger gets nothing for a minor-hosted game');
SELECT t.eq(t.count($q$SELECT 1 FROM public.get_game_host_paypal('priv-a')$q$), 0, '6: an unrelated account gets nothing for a private adult game');
SELECT t.eq((SELECT merchant_id FROM public.get_game_host_paypal('pub-open')), 'MERCH-AHOST', '6: a public adult listing still shows its host''s merchant id');
SELECT t.reset();
SELECT t.as_user(t.id('member'));
SELECT t.eq((SELECT merchant_id FROM public.get_game_host_paypal('priv-a')), 'MERCH-AHOST', '6: a participant of the private game gets it');
SELECT t.reset();
SELECT t.as_user(t.id('payer'));
SELECT t.eq((SELECT string_agg(merchant_id, ',') FROM public.get_game_host_paypal('m-paid')), 'MERCH-GUARDIAN',
  '6: an involved player of the minor-hosted game gets only the payee''s merchant id, never the minor''s');
SELECT t.reset();
-- ============================================================ R5 review F1: moving one's own claim does not confirm a payee
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, 'pub-open', %L)$q$, t.id('ps-move'), t.id('stranger'), t.id('ahost')),
  'F1 setup: a stranger''s own pending claim on an open adult game');
SELECT set_config('t.u_guard', t.err(format($q$UPDATE public.payment_submissions SET game_id = 'm-paid', host_id = %L WHERE id = %L$q$, t.id('guardian'), t.id('ps-move'))), true);
SELECT set_config('t.u_other', t.err(format($q$UPDATE public.payment_submissions SET game_id = 'm-paid', host_id = %L WHERE id = %L$q$, t.id('other'), t.id('ps-move'))), true);
SELECT set_config('t.u_host', t.err(format($q$UPDATE public.payment_submissions SET host_id = %L WHERE id = %L$q$, t.id('guardian'), t.id('ps-move'))), true);
SELECT t.reset();
SELECT t.ok(current_setting('t.u_other') ILIKE '%PAYMENT_FIELD_FORBIDDEN%', 'F1: moving a claim to another game or payee is refused');
SELECT t.eq(current_setting('t.u_guard'), current_setting('t.u_other'), 'F1: guessing the real guardian payee gives the identical error');
SELECT t.eq(current_setting('t.u_host'), current_setting('t.u_other'), 'F1: so does changing only the payee');
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format($q$UPDATE public.payment_submissions SET notes = 'sent' WHERE id = %L$q$, t.id('ps-move')), 'F1: the player still edits their own pending claim');
SELECT t.reset();
SELECT t.eq((SELECT game_id || '/' || host_id::text FROM public.payment_submissions WHERE id = t.id('ps-move')), ('pub-open/' || t.id('ahost')::text), 'F1: the claim keeps its game and payee');

ROLLBACK;
