-- PRIV-2B part 2: minors cannot collect payments; a paid minor-hosted game needs an adult payment manager;
-- a minor host's name cannot be looked up by strangers.
BEGIN;
SELECT t.person('adult', 35), t.person('payer', 29), t.person('teenhost', 17), t.person('teen16', 16), t.person('kid14', 14),
       t.person('guardian', 40), t.person('otherguardian', 41), t.person('orgadmin', 38), t.person('stranger', 44),
       t.person('teenmate', 17), t.person('adminone', 33), t.person('teenpublic', 17);
SELECT t.guardian('guardian', 'teenhost');
SELECT t.guardian('otherguardian', 'kid14');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org'), t.id('orgadmin'), 'Riverside Club', 'riverside');
SET LOCAL session_replication_role = replica;
INSERT INTO public.org_members (org_id, user_id, role) VALUES (t.id('org'), t.id('teenhost'), 'member');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('adminone'), 'admin');
SET LOCAL session_replication_role = origin;

-- ---- a minor cannot become a payee
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (%L, 'venmo', 'teen-handle')$q$, t.id('teenhost')),
  'MINOR_CANNOT_COLLECT_PAYMENTS', 'a 17-year-old cannot add a payment method');
SELECT t.throws(format($q$INSERT INTO public.host_paypal_accounts (host_id, merchant_id) VALUES (%L, 'MERCHANT123')$q$, t.id('teenhost')),
  'MINOR_CANNOT_COLLECT_PAYMENTS', 'nor a PayPal account');
SELECT t.reset();
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format($q$INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (%L, 'venmo', 'adult-handle')$q$, t.id('adult')), 'an adult still can');
SELECT t.reset();

-- ---- a paid game hosted by a minor
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price) VALUES ('p-nomgr', %L, 'basketball', 't', now()+interval '3 days', 10)$q$, t.id('teenhost')),
  'MINOR_HOST_APPROVAL_REQUIRED', 'a minor cannot publish a paid game with no approval at all');
SELECT t.reset();
-- an approval without payment responsibility does not cover a paid game
SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.nopay', public.grant_minor_hosting_approval(t.id('teenhost'))::text, false);
SELECT set_config('t.pay', public.grant_minor_hosting_approval(t.id('teenhost'), 168, true)::text, false);
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, hosting_approval_id) VALUES ('p-nopay', %L, 'basketball', 't', now()+interval '3 days', 10, %L)$q$, t.id('teenhost'), current_setting('t.nopay')::uuid),
  'MINOR_HOST_PAYMENT_MANAGER_REQUIRED', 'an approval with no payment manager does not cover a paid game');
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, min_age, max_age, hosting_approval_id) VALUES ('p-ok', %L, 'basketball', 'paid youth run', now()+interval '3 days', 10, 13, 17, %L)$q$, t.id('teenhost'), current_setting('t.pay')::uuid),
  'with an approval that names an adult payment manager the paid game can be created');
-- the minor cannot hold the payment settings
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('p-ok', %L, 10)$q$, t.id('teenhost')),
  'MINOR_CANNOT_COLLECT_PAYMENTS', 'the minor cannot hold the payment settings of the paid game');
SELECT t.reset();
-- nor can an unrelated adult
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('p-ok', %L, 10)$q$, t.id('stranger')),
  'MINOR_HOST_PAYMENT_MANAGER_REQUIRED', 'an unrelated adult cannot become the payee of a minor''s game');
SELECT t.reset();
-- another child's guardian cannot approve payment responsibility for this teen
SELECT t.as_user(t.id('otherguardian'));
SELECT t.throws(format($q$SELECT public.grant_minor_hosting_approval(%L, 168, true)$q$, t.id('teenhost')), 'NOT_GUARDIAN', 'another child''s guardian cannot take payment responsibility');
SELECT t.reset();
-- the approving guardian can
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('p-ok', %L, 10, false)$q$, t.id('guardian')),
  'the approving guardian holds the payment settings');
SELECT t.reset();
SELECT t.eq(private_sec.minor_game_payment_manager('p-ok'), t.id('guardian'), 'and is recorded as the payment manager');

INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('legacy-free-adult', t.id('adult'), 'basketball', 'adult run', now()+interval '5 days');
-- payment settings cannot be written onto a game by someone who neither hosts it nor manages its payment
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('legacy-free-adult', %L, 0)$q$, t.id('stranger')), 'row-level security', 'a stranger cannot add settings to an adult host''s game');
SELECT t.reset();
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('legacy-free-adult', %L, 0)$q$, t.id('adult')), 'the adult host can write their own game''s settings');
SELECT t.reset();

-- a join request to the minor-hosted paid game still names the real host (the game's host, not the payment manager)
SELECT t.as_user(t.id('teen16'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('p-ok', %L, %L, 'kpay')$q$, t.id('teen16'), t.id('teenhost')), 'a player can ask to join a minor-hosted paid game');
SELECT t.reset();
SELECT t.eq(private_sec.game_payee('p-ok'), t.id('guardian'), 'the payee of that game is its payment manager');
SELECT t.eq(private_sec.game_payee('legacy-free-adult'), t.id('adult'), 'and of an adult host''s game, the host');

-- payers: only the manager can be named as payee
SELECT t.as_user(t.id('payer'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'p-ok', %L)$q$, t.id('payer'), t.id('teenhost')),
  'PAYMENT_DESTINATION_INVALID', 'a payment cannot be made out to the minor host');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'p-ok', %L)$q$, t.id('payer'), t.id('stranger')),
  'PAYMENT_DESTINATION_INVALID', 'nor to a different adult');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'p-ok', %L)$q$, t.id('payer'), t.id('guardian')),
  'but to the payment manager it can');
SELECT t.reset();

-- existing minor-hosted paid game cannot raise its price or change host without an approval
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, status) VALUES ('legacy-paid', t.id('teenhost'), 'basketball', 'legacy', now()+interval '4 days', 5, 'upcoming');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives($q$UPDATE public.hosted_games SET description = 'edited' WHERE id = 'legacy-paid'$q$, 'a legacy paid game can still be edited');
SELECT t.throws($q$UPDATE public.hosted_games SET price = 25 WHERE id = 'legacy-paid'$q$, 'MINOR_HOST_PAYMENT_MANAGER_REQUIRED', 'but its price cannot be raised');
SELECT t.throws(format($q$UPDATE public.hosted_games SET price = 25, hosting_approval_id = %L WHERE id = 'legacy-paid'$q$, current_setting('t.pay')::uuid),
  'MINOR_HOST_PAYMENT_MANAGER_REQUIRED', 'nor can another game''s approval be attached to it');
SELECT t.reset();

-- legacy payment handles of a minor are not shown
SET LOCAL session_replication_role = replica;
INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (t.id('teenhost'), 'venmo', 'old-teen-handle');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teenhost'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.get_host_payment_methods(t.id('teenhost'))$q$), 0, 'a minor''s old payment handles are not returned, even to the minor');
SELECT t.reset();

-- organization approval with payment responsibility
SELECT t.as_user(t.id('orgadmin'));
SELECT set_config('t.opay', public.grant_org_minor_hosting_approval(t.id('teenhost'), t.id('org'), 168, true)::text, false);
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, min_age, max_age, org_id, hosting_approval_id) VALUES ('p-org', %L, 'basketball', 'club clinic', now()+interval '3 days', 15, 13, 17, %L, %L)$q$, t.id('teenhost'), t.id('org'), current_setting('t.opay')::uuid),
  'an organization administrator can take payment responsibility');
SELECT t.reset();
SELECT t.eq(private_sec.minor_game_payment_manager('p-org'), t.id('orgadmin'), 'the administrator is the recorded manager');
SELECT t.as_user(t.id('orgadmin'));
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('p-org', %L, 15)$q$, t.id('orgadmin')), 'and holds the payment settings');
SELECT t.reset();
-- revoking the approval removes the manager: nobody can be paid for that game any more
SELECT t.as_user(t.id('orgadmin'));
SELECT public.revoke_minor_hosting_approval(current_setting('t.opay')::uuid);
SELECT t.reset();
SELECT t.ok(private_sec.minor_game_payment_manager('p-org') IS NULL, 'a revoked approval leaves the game with no payment manager');
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('p-org', t.id('payer'), t.id('teenhost'), 'kp', 'approved');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('payer'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'p-org', %L)$q$, t.id('payer'), t.id('orgadmin')),
  'PAYMENT_DESTINATION_INVALID', 'so new payments for it are refused');
SELECT t.reset();

-- guardian approval does not override age eligibility (unchanged, re-checked with a payment manager attached)
SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.pay2', public.grant_minor_hosting_approval(t.id('teenhost'), 168, true)::text, false);
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, min_age, hosting_approval_id) VALUES ('p-18', %L, 'basketball', 't', now()+interval '3 days', 10, 18, %L)$q$, t.id('teenhost'), current_setting('t.pay2')::uuid),
  'ADULT_HOST_REQUIRED', 'a payment-managing guardian still cannot make a minor the host of an 18+ game');
SELECT t.reset();

-- an organization administrator cannot use the approval call to learn anyone's age band
SELECT t.as_user(t.id('orgadmin'));
SELECT t.throws(format($q$SELECT public.grant_org_minor_hosting_approval(%L, %L)$q$, t.id('stranger'), t.id('org')), 'this member cannot be approved for hosting', 'an adult non-member gets the neutral refusal');
SELECT t.throws(format($q$SELECT public.grant_org_minor_hosting_approval(%L, %L)$q$, t.id('teen16'), t.id('org')), 'this member cannot be approved for hosting', 'a 16-year-old non-member gets the same refusal as an adult one');
SELECT t.reset();

-- under-16 and unknown ages are unchanged: they cannot host at all
SELECT t.as_user(t.id('kid14'));
SELECT t.throws(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price) VALUES ('k-paid', %L, 'basketball', 't', now()+interval '3 days', 5)$q$, t.id('kid14')),
  'CHILD_CANNOT_HOST', 'a 14-year-old cannot host, paid or not');
SELECT t.reset();

-- ---- identity: names of non-adults are not handed to strangers
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, host_snapshot) VALUES
  ('id-game', t.id('teenhost'), 'basketball', 'teen run', now()+interval '3 days', 13, 17, '{}');
SELECT t.as_user(t.id('stranger'));
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'a stranger gets no name for a minor host');
SELECT t.ok((SELECT avatar_initials IS NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'and no initials');
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('adult')])), 'an adult''s name is returned as before');
SELECT t.eq(t.count($q$SELECT 1 FROM public.profiles WHERE id = t.id('teenhost')$q$), 0, 'and the profile row itself is not readable');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'anonymous callers get no name either');
SELECT t.reset();
SELECT t.as_user(t.id('teenhost'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'the minor sees their own name');
SELECT t.reset();
SELECT t.as_user(t.id('guardian'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'a verified guardian sees it');
SELECT t.reset();
SELECT t.as_user(t.id('otherguardian'));
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'another child''s guardian does not');
SELECT t.reset();
SELECT t.as_user(t.id('adminone'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'an administrator does');
SELECT t.reset();
-- people who actually share a game, a chat or a team with the minor
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('id-game', t.id('teenmate'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teenmate'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'a player in the same game sees the host''s name');
SELECT t.reset();
SELECT t.team('tmx', 'adult');
SELECT t.member('tmx', 'teenhost');
SELECT t.member('tmx', 'payer');
SELECT t.as_user(t.id('payer'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('teenhost')])), 'a teammate sees it');
SELECT t.reset();
-- every non-adult cohort is hidden from a stranger, adults are not (the lookup is not specific to 16-17 hosts)
SELECT t.person('c9', 9), t.person('c14', 14), t.person('c16', 16), t.person('c17', 17), t.person('c30', 30);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (t.id('cnoage'), 'cnoage@example.test', now(), '{"display_name":"Cnoage","account_type":"player"}');
SELECT t.as_user(t.id('stranger'));
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('c9')])), 'under-13: name hidden from a stranger');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('c14')])), '13-15: name hidden from a stranger');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('c16')])), '16: name hidden from a stranger');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('c17')])), '17: name hidden from a stranger');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('cnoage')])) OR NOT EXISTS (SELECT 1 FROM public.visible_avatars(ARRAY[t.id('cnoage')])), 'unknown age: name hidden from a stranger');
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('c30')])), 'adult: name returned');
SELECT t.reset();

-- ---- legitimate relationships keep working (a name a person needs to do their job is not hidden from them)
SELECT t.person('m_req', 17), t.person('m_wait', 16), t.person('m_inv', 15), t.person('m_rsvp', 16), t.person('m_orgmem', 17),
       t.person('m_follow', 17), t.person('m_payer', 17), t.person('m_orgreq', 16), t.person('coach', 35), t.person('outsider', 36);
SELECT t.team('tmy', 'coach');
SELECT t.guardian('guardian', 'm_req');
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status) VALUES ('id-game', t.id('m_req'), t.id('teenhost'), 'kreq', 'pending');
INSERT INTO public.game_position_waitlist (game_id, position, user_id) VALUES ('id-game', 'guard', t.id('m_wait'));
INSERT INTO public.team_invites (team_id, invitee_id, invited_by, role) VALUES ('tmy', t.id('m_inv'), t.id('coach'), 'player');
INSERT INTO public.org_members (org_id, user_id, role) VALUES (t.id('org'), t.id('m_orgmem'), 'member');
INSERT INTO public.org_member_requests (org_id, user_id, message) VALUES (t.id('org'), t.id('m_orgreq'), 'hi');
INSERT INTO public.follows (follower_id, followee_id) VALUES (t.id('outsider'), t.id('m_follow'));
SET LOCAL session_replication_role = origin;

-- the host sees a pending requester and a waitlisted player; a stranger sees neither
SELECT t.as_user(t.id('teenhost'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_req')])), 'a host sees the name of someone who asked to join');
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_wait')])), 'and of a waitlisted player');
SELECT t.reset();
UPDATE public.team_invites SET status = 'accepted' WHERE invitee_id = t.id('m_inv');
SELECT t.as_user(t.id('coach'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_inv')])), 'a coach sees someone whose invitation was accepted');
SELECT t.reset();
SELECT t.as_user(t.id('orgadmin'));
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('m_orgmem')])), 'an organization admin no longer sees a bare member (anyone can create an organization and add anyone; SEC-1)');
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_orgreq')])), 'and someone who asked to join');
SELECT t.reset();
SELECT t.as_user(t.id('outsider'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_follow')])), 'an accepted follower sees the name');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('m_req')])), 'but not someone they have no relationship with');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('m_wait')])), 'nor a waitlisted player of a game that is not theirs');
SELECT t.ok((SELECT display_name IS NULL FROM public.visible_avatars(ARRAY[t.id('m_orgmem')])), 'nor an organization member');
SELECT t.reset();
-- a guardian sees their child; payment manager sees the payer
SELECT t.as_user(t.id('guardian'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_req')])), 'a verified guardian sees their child');
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (t.id('m_payer'), 'p-ok', t.id('guardian'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('guardian'));
SELECT t.ok((SELECT display_name IS NOT NULL FROM public.visible_avatars(ARRAY[t.id('m_payer')])), 'a payment manager sees the person paying them');
SELECT t.reset();
-- the helper is not a way to ask about other people's relationships
SELECT t.as_user(t.id('outsider'));
SELECT t.throws(format($q$SELECT private_sec.can_see_minor_name(%L, %L)$q$, t.id('guardian'), t.id('m_req')), 'permission denied', 'the relationship helper cannot be called by users');
SELECT t.reset();

-- the public game row carries no name
SELECT t.as_user(t.id('stranger'));
SELECT t.ok((SELECT NOT (host_snapshot ? 'name') OR host_snapshot ->> 'name' = 'Youth host' FROM public.hosted_games WHERE id = 'id-game'), 'the public game row carries a neutral organizer, not the minor''s name');
SELECT t.reset();
ROLLBACK;
