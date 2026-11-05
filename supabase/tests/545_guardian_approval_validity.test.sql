-- F03 (with A-F3, A-F4): a guardian's approval of a game, a payment or a team invite counts only while the guardian who
-- gave it still has authority (active, verified link; no open hold). Suspension, revocation, account recovery and
-- replacement all void earlier approvals; the current guardian must approve. A guardian's controls survive a suspension.
BEGIN;
SELECT t.person('modone', 40), t.person('modtwo', 41), t.person('modthree', 42), t.person('host', 35), t.person('mgr', 38),
       t.person('adultp', 30),
       t.person('teen1', 16), t.person('ga1', 44), t.person('gb1', 50),
       t.person('teen2', 16), t.person('ga2', 45),
       t.person('teen3', 15), t.person('ga3', 46), t.person('gb3', 47),
       t.person('teen4', 16), t.person('ga4', 48), t.person('gn4', 49),
       t.person('teen5', 17), t.person('ga5', 43), t.person('gb5', 42),
       t.person('teen6', 14), t.person('ga6', 41),
       t.person('gheld', 40),
       t.person('teen8', 16), t.person('ga8', 39), t.person('ga8b', 38);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('modtwo'), 'admin'), (t.id('modthree'), 'moderator');
SELECT t.guardian('ga1', 'teen1'), t.guardian('gb1', 'teen1'), t.guardian('ga2', 'teen2'), t.guardian('ga3', 'teen3'), t.guardian('gb3', 'teen3'),
       t.guardian('ga4', 'teen4'), t.guardian('ga5', 'teen5'), t.guardian('ga6', 'teen6'), t.guardian('ga8', 'teen8');

CREATE FUNCTION t.link(parent text, child text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.guardian_links WHERE parent_user_id = t.id(parent) AND child_user_id = t.id(child)
$f$;
CREATE FUNCTION t.res(stmt text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  EXECUTE stmt INTO r;
  RETURN COALESCE(r, '<null>');
EXCEPTION WHEN OTHERS THEN RETURN 'ERROR: ' || SQLERRM;
END $f$;
CREATE FUNCTION t.like(got text, pattern text, name text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF got LIKE pattern THEN RAISE NOTICE 'ok - %', name; ELSE RAISE NOTICE 'not ok - % (got %, wanted %)', name, got, pattern; END IF;
END $f$;
-- a join request for each teen, approved by the host, then approved by a guardian through the real RPC
CREATE FUNCTION t.ask(teen text, game text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  SET LOCAL session_replication_role = replica;
  INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, reviewed_at)
  VALUES (game, t.id(teen), t.id('host'), 'k-' || teen || '-' || game, 'approved', now());
  SET LOCAL session_replication_role = origin;
END $f$;
CREATE FUNCTION t.approve(guardian text, teen text, game text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  PERFORM t.as_user(t.id(guardian));
  r := t.res(format('SELECT public.guardian_approve_join_request(%L, true)::text',
                    (SELECT id FROM public.join_requests WHERE game_id = game AND player_id = t.id(teen))));
  PERFORM t.reset();
  RETURN r;
END $f$;
CREATE FUNCTION t.pay_blocked(teen text, game text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT private_sec.payment_guardian_missing(game, t.id(teen))
$f$;
CREATE FUNCTION t.join(teen text, game text) RETURNS text LANGUAGE sql AS $f$
  SELECT t.res(format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L) RETURNING ''joined''', game, t.id(teen)))
$f$;

INSERT INTO public.hosted_games (id, host_id, sport, title, date, price) VALUES
  ('g-pay', t.id('host'), 'basketball', 'Paid youth run', now() + interval '3 days', 10),
  ('g-join', t.id('host'), 'basketball', 'Youth run', now() + interval '3 days', 0);
SELECT t.ask(p, g) FROM unnest(ARRAY['teen1','teen2','teen3','teen4','teen5','teen6']) p, unnest(ARRAY['g-pay','g-join']) g;

-- ================= baseline: a currently valid guardian's approval works
SELECT t.like(t.approve('ga1', 'teen1', 'g-pay'), '%', 'setup: guardian A approves teen1''s paid game');
SELECT t.ok(NOT t.pay_blocked('teen1', 'g-pay'), 'baseline: payment allowed with the current guardian''s approval');
SELECT t.ok(t.pay_blocked('teen1', 'g-join'), 'baseline: a game the guardian did not approve stays blocked');
SELECT t.ok(NOT private_sec.payment_guardian_missing('g-pay', t.id('adultp')), 'baseline: an adult needs no guardian approval');

-- ================= revocation of the approving guardian (another guardian remains)
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Not the parent (ticket GV-1)', false)$q$, t.link('ga1', 'teen1')), 'setup: staff revoke guardian A');
SELECT t.reset();
SELECT t.ok(t.pay_blocked('teen1', 'g-pay'), 'F03 revocation: the revoked guardian''s approval no longer allows payment (guardian B must approve)');
SELECT t.like(t.approve('ga1', 'teen1', 'g-pay'), 'ERROR:%', 'F03 revocation: and the revoked guardian cannot approve again');

-- ================= suspension (and A-F3: approvals and gates stay closed while suspended)
SELECT t.like(t.approve('ga2', 'teen2', 'g-join'), '%', 'setup: guardian approves teen2''s game');
SELECT t.like(t.approve('ga2', 'teen2', 'g-pay'), '%', 'setup: and the paid one');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_suspend_guardian_authority(%L, 'Account takeover reported (ZD-1)')$q$, t.id('ga2')), 'setup: staff suspend guardian');
SELECT t.reset();
SELECT t.ok(t.pay_blocked('teen2', 'g-pay'), 'F03 suspension: a suspended guardian''s approval does not allow payment');
SELECT t.like(t.join('teen2', 'g-join'), 'ERROR:%GUARDIAN_APPROVAL_REQUIRED%', 'F03/A-F3 suspension: nor joining the game');

-- ================= multiple guardians: the remaining guardian must approve
SELECT t.like(t.approve('ga3', 'teen3', 'g-pay'), '%', 'setup: guardian A approves teen3''s game (B also a guardian)');
SELECT t.ok(NOT t.pay_blocked('teen3', 'g-pay'), 'baseline: allowed while A is a guardian');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Court order (GV-3)', false)$q$, t.link('ga3', 'teen3')), 'setup: A revoked, B remains');
SELECT t.reset();
SELECT t.ok(t.pay_blocked('teen3', 'g-pay'), 'F03 multiple guardians: A''s old approval is not enough although B is active');
SELECT t.like(t.approve('gb3', 'teen3', 'g-pay'), '%', 'setup: B approves');
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE game_id = 'g-pay' AND player_id = t.id('teen3')), t.id('gb3'),
  'F03: B''s approval replaces A''s on the request (no stale approver kept)');
SELECT t.ok(NOT t.pay_blocked('teen3', 'g-pay'), 'F03 multiple guardians: B''s approval allows payment');

-- ================= recovery after compromise (old account replaced by a verified new one)
SELECT t.like(t.approve('ga4', 'teen4', 'g-pay'), '%', 'setup: the old (later compromised) account approves');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_open_guardian_recovery(%L, %L, 'Account compromised; ticket ZD-4')$q$, t.link('ga4', 'teen4'), t.id('gn4')), 'setup: recovery opened');
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'GV-40000001')$q$,
  (SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id('teen4') AND parent_user_id = t.id('gn4'))), 'setup: first review');
SELECT t.as_user(t.id('modthree'));
SELECT t.lives(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-40000002')$q$,
  (SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id('teen4') AND parent_user_id = t.id('gn4'))), 'setup: second review activates the new account');
SELECT t.reset();
SELECT t.ok(private_sec.is_guardian_of(t.id('gn4'), t.id('teen4')) AND NOT private_sec.is_guardian_of(t.id('ga4'), t.id('teen4')), 'setup: the new account is the guardian');
SELECT t.ok(t.pay_blocked('teen4', 'g-pay'), 'F03 recovery: the compromised account''s approval no longer allows payment');
SELECT t.like(t.approve('gn4', 'teen4', 'g-pay'), '%', 'setup: the recovered account approves');
SELECT t.ok(NOT t.pay_blocked('teen4', 'g-pay'), 'F03 recovery: the recovered account''s approval does');

-- ================= replacement (approval by a different guardian than the current one)
SELECT t.like(t.approve('ga5', 'teen5', 'g-join'), '%', 'setup: the previous guardian approves the game');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Guardianship transferred (GV-5)', false)$q$, t.link('ga5', 'teen5')), 'setup: previous guardian removed');
SELECT t.reset();
SELECT t.guardian('gb5', 'teen5');
SELECT t.like(t.join('teen5', 'g-join'), 'ERROR:%GUARDIAN_APPROVAL_REQUIRED%', 'F03 replacement: the previous guardian''s approval does not let the teen join');
SELECT t.like(t.approve('gb5', 'teen5', 'g-join'), '%', 'setup: the new guardian approves');
SELECT t.eq(t.join('teen5', 'g-join'), 'joined', 'F03 replacement: the current guardian''s approval does');

-- ================= A-F3: a guardian's controls survive a suspension
INSERT INTO public.child_controls (child_user_id, updated_by, game_participation) VALUES (t.id('teen6'), t.id('ga6'), false)
  ON CONFLICT (child_user_id) DO UPDATE SET game_participation = false;
SELECT t.ok(NOT public.child_game_participation_allowed(t.id('teen6')), 'baseline: the guardian disabled game participation');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_suspend_guardian_authority(%L, 'Review (ZD-6)')$q$, t.id('ga6')), 'setup: guardian suspended');
SELECT t.reset();
SELECT t.ok(NOT public.child_game_participation_allowed(t.id('teen6')), 'A-F3: participation stays disabled while the guardian is suspended');

-- ================= A-F4: a held guardian gains no new guardian authority
INSERT INTO public.guardian_authority_holds (guardian_user_id, reason, placed_by) VALUES (t.id('gheld'), 'Compromise reported', t.id('modone'));
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
VALUES (t.id('newkid'), 'newkid@example.test', now(), '{"display_name":"Newkid"}'::jsonb, jsonb_build_object('managed', 'true', 'managed_by', t.id('gheld')::text));
SELECT t.as_user(t.id('gheld'));
SELECT t.like(t.res(format($q$SELECT cohort FROM public.provision_managed_child(%L, (current_date - interval '9 years')::date, 'Mini', 'parent', NULL, jsonb_build_object('terms', (SELECT version FROM public.legal_documents WHERE document_type = 'terms' AND published ORDER BY effective_date DESC LIMIT 1), 'privacy', (SELECT version FROM public.legal_documents WHERE document_type = 'privacy' AND published ORDER BY effective_date DESC LIMIT 1)), true)$q$, t.id('newkid'))),
  'ERROR:%GUARDIAN_NOT_ELIGIBLE%', 'A-F4: a held guardian cannot create a managed child');
SELECT t.reset();
SELECT t.ok(NOT private_sec.is_guardian_of(t.id('gheld'), t.id('newkid')), 'A-F4: and gains no link');

-- ================= team invite acceptance
SELECT t.team('fteam', 'mgr');
INSERT INTO public.team_invites (id, team_id, invitee_id, invited_by, role, status, expires_at)
VALUES (t.id('inv8'), 'fteam', t.id('teen8'), t.id('mgr'), 'player', 'pending', now() + interval '7 days');
SELECT t.as_user(t.id('ga8'));
SELECT t.lives(format('SELECT public.guardian_approve_team_invite(%L, true)', t.id('inv8')), 'setup: guardian approves the team invite');
SELECT t.reset();
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Not the parent (GV-8)', false)$q$, t.link('ga8', 'teen8')), 'setup: guardian revoked');
SELECT t.reset();
SELECT t.ok(NOT private_sec.team_membership_authorizes('fteam', t.id('teen8')),
  'F03 roster access: after the approving guardian is revoked the membership no longer authorizes team contact');
SELECT t.guardian('ga8b', 'teen8');
SELECT t.ok(NOT private_sec.team_membership_authorizes('fteam', t.id('teen8')),
  'F03 roster access: a new guardian does not inherit the old approval (re-approval needed)');
ROLLBACK;
