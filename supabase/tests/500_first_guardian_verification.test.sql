-- SEC-4: a family invitation (or a consent-email click) never makes anyone a guardian on its own. A first guardian waits, with no authority,
-- until BallaCity staff verify them; every activation, revocation and recovery is audited.
BEGIN;
SELECT t.person('realmom', 40), t.person('coachx', 35), t.person('hostx', 36), t.person('contactx', 33), t.person('chatx', 34),
       t.person('dadcoach', 44), t.person('oldmom', 45), t.person('emailx', 37), t.person('spamone', 31), t.person('spamtwo', 32),
       t.person('spamthree', 33), t.person('spammer', 38), t.person('modone', 39), t.person('modtwo', 41), t.person('randomadult', 29),
       t.person('kidu', 10), t.person('teen', 15), t.person('teenb', 16), t.person('teenc', 14), t.person('teene', 15), t.person('teenf', 13),
       t.person('teend', 16), t.person('teenr', 15), t.person('oldkid', 14), t.person('oldkidu', 9), t.person('kidc', 11),
       t.person('wrongkid', 15), t.person('sone', 14), t.person('stwo', 14), t.person('sthree', 14), t.person('sfour', 14), t.person('adultp', 30);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('modtwo'), 'admin');
-- an existing, legitimate family (linked before this release): must keep working untouched
SELECT t.guardian('oldmom', 'oldkid');
SELECT t.guardian('oldmom', 'oldkidu');
CREATE TEMP TABLE before_links AS SELECT id, status, verified_at, verified_by, verification_method FROM public.guardian_links;
GRANT SELECT ON before_links TO authenticated;

-- self-created relationships a stranger could build before asking for a link
SELECT t.team('squadx', 'coachx');
SELECT t.member('squadx', 'teen');
SELECT t.team('dadsteam', 'dadcoach');
SELECT t.member('dadsteam', 'teenf');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, host_snapshot) VALUES
  ('gx', t.id('hostx'), 'basketball', 'Open run', now() + interval '2 days', 12, 17, 'Gym', 'North', '{"name":"Host"}'::jsonb);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gx', t.id('teenb'));
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, recurring_days, city, travel_radius_km, status, time_slots) VALUES
  ('00000000-0000-0000-0000-0000000005c1', t.id('teenc'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue'], 'Atlanta', 10, 'open', '[]'::jsonb);
INSERT INTO public.availability_contact_requests (availability_id, from_user_id, to_user_id, status)
  VALUES ('00000000-0000-0000-0000-0000000005c1', t.id('contactx'), t.id('teenc'), 'pending');
INSERT INTO public.conversations (id, created_by) VALUES ('00000000-0000-0000-0000-0000000005c2', t.id('chatx'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000005c2', t.id('chatx')), ('00000000-0000-0000-0000-0000000005c2', t.id('teene'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key, status) VALUES ('00000000-0000-0000-0000-0000000005c4', 'gx', t.id('teen'), t.id('hostx'), 'k-sec4', 'pending');
SET LOCAL session_replication_role = origin;

-- helpers: an invitation token hash for a label, and the pending claim for a child
CREATE FUNCTION t.tok(label text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT md5('sec4-invite-' || label) || md5(label) $f$;
-- (childname: the first name the inviter types; it is compared with the redeemer's profile, and a mismatch needs two reviewers)
CREATE FUNCTION t.invite(who text, label text, childname text DEFAULT 'Kiddo') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_user(t.id(who));
  PERFORM public.create_minor_invite(childname, 'parent', t.tok(label), now() + interval '7 days');
  PERFORM t.reset();
END $f$;
CREATE FUNCTION t.claim(child text, claimant text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.guardian_link_requests WHERE child_user_id = t.id(child) AND parent_user_id = t.id(claimant) ORDER BY created_at DESC LIMIT 1
$f$;
CREATE FUNCTION t.link(parent text, child text) RETURNS uuid LANGUAGE sql AS $f$
  SELECT id FROM public.guardian_links WHERE parent_user_id = t.id(parent) AND child_user_id = t.id(child)
$f$;
-- the result of a call as text, or 'ERROR: <message>' (in a savepoint, so a refused call changes nothing)
CREATE FUNCTION t.res(stmt text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  EXECUTE stmt INTO r;
  RETURN COALESCE(r, '<null>');
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR: ' || SQLERRM;
END $f$;
GRANT EXECUTE ON FUNCTION t.tok(text), t.claim(text, text), t.link(text, text), t.res(text) TO authenticated, anon;
-- A client write must change nothing: refused by a privilege, by row level security or by the SEC-4 trigger, or matching no row it may touch.
CREATE FUNCTION t.refused(stmt text, name text) RETURNS void LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  BEGIN
    EXECUTE stmt;
    GET DIAGNOSTICS n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM ~* '(permission denied|row-level security|GUARDIAN_LINK_WRITE_REFUSED)' THEN RAISE NOTICE 'ok - %', name;
    ELSE RAISE NOTICE 'not ok - % (raised "%")', name, SQLERRM; END IF;
    RETURN;
  END;
  IF n = 0 THEN RAISE NOTICE 'ok - % (no row changed)', name; ELSE RAISE NOTICE 'not ok - % (% rows changed)', name, n; END IF;
END $f$;
GRANT EXECUTE ON FUNCTION t.refused(text, text) TO authenticated;

-- ================= 1. legitimate onboarding: a real parent's invitation, then staff verification
SELECT t.invite('realmom', 'mom', 'Kidu');
SELECT t.as_user(t.id('kidu'));
CREATE TEMP TABLE r1 AS SELECT * FROM public.redeem_minor_invite(t.tok('mom'));
SELECT t.reset();
SELECT t.eq((SELECT verification_required FROM r1), true, 'redeeming a first-guardian invitation needs verification');
SELECT t.eq((SELECT pending_approval FROM r1), true, 'and is pending');
SELECT t.eq((SELECT consent_recorded FROM r1), false, 'and records no parental consent');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE child_user_id = t.id('kidu')), 0, 'redemption creates no guardian link at all');
SELECT t.eq((SELECT kind || '/' || status || '/' || source FROM public.guardian_link_requests WHERE id = t.claim('kidu', 'realmom')),
            'first_guardian/pending/family_invite', 'it creates a pending first-guardian claim');
SELECT t.eq((SELECT cardinality(signals) FROM public.guardian_link_requests WHERE id = t.claim('kidu', 'realmom')), 0, 'a real parent with no prior contact has no signals');
SELECT t.eq((SELECT status FROM public.minor_invites WHERE token_hash = t.tok('mom')), 'redeemed', 'the invitation is used up');

-- ================= 2. pending grants nothing
SELECT t.ok(NOT public.is_guardian_of(t.id('realmom'), t.id('kidu')), 'pending: is_guardian_of is false');
SELECT t.ok(NOT private_sec.has_guardian_link(t.id('kidu')), 'pending: has_guardian_link is false');
SELECT t.ok(public.child_features_locked(t.id('kidu')), 'pending: an under-13 stays locked (no consent yet)');
SELECT t.ok(public.minor_messaging_block(t.id('realmom'), t.id('kidu')) IS NOT NULL, 'pending: minor_messaging_block still refuses');
SELECT t.ok(NOT public.can_notify(t.id('realmom'), t.id('kidu')), 'pending: can_notify is false');
SELECT t.as_user(t.id('realmom'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('kidu')), 'MINOR_MESSAGING_BLOCKED', 'pending: the claimant cannot open a conversation');
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"messaging":"peers"}'::jsonb)$q$, t.id('kidu')), 'NOT_AUTHORIZED', 'pending: no controls');
SELECT t.throws(format($q$SELECT public.create_parent_request(%L, 'access', 'x')$q$, t.id('kidu')), 'NOT_AUTHORIZED', 'pending: no data requests');
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('kidu')), 'NOT_AUTHORIZED', 'pending: no consent management');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_children_overview()'), 0, 'pending: the Parent Center lists no child');
SELECT t.eq(t.count(format('SELECT 1 FROM public.child_controls WHERE child_user_id = %L', t.id('kidu'))), 0, 'pending: the child''s controls are not readable');
SELECT t.throws(format('SELECT public.guardian_decide_link_request(%L, true)', t.claim('kidu', 'realmom')), 'REQUEST_NOT_FOUND', 'pending: the claimant cannot approve their own claim');
SELECT t.reset();
SELECT t.as_user(t.id('coachx'));
SELECT t.lives(format('SELECT public.create_minor_invite(%L, %L, %L, now() + interval ''7 days'')', 'Kiddo', 'parent', t.tok('coach')), 'setup: the coach invites');
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('coach')), 'setup: their player redeems');
SELECT t.as_user(t.id('coachx'));
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', '00000000-0000-0000-0000-0000000005c4'),
                'NOT_GUARDIAN', 'pending: the claimant cannot approve the child''s game request');
SELECT t.reset();
SELECT t.eq(public.minor_messaging_block(t.id('coachx'), t.id('teen')), 'needs_guardian_link:other', 'pending: a 15-year-old with only a pending claim still has no guardian');

-- ================= 3. staff verification activates, with the evidence and who verified
SELECT t.as_user(t.id('realmom'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0001')$q$, t.claim('kidu', 'realmom')), 'NOT_AUTHORIZED', 'the inviter cannot verify');
SELECT t.as_user(t.id('kidu'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0001')$q$, t.claim('kidu', 'realmom')), 'NOT_AUTHORIZED', 'the child cannot verify');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', '  ')$q$, t.claim('kidu', 'realmom')), 'EVIDENCE_REQUIRED', 'staff must record the evidence');
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'looked fine', 'CASE-0001')$q$, t.claim('kidu', 'realmom')), 'METHOD_INVALID', 'and a known method');
SELECT t.lives(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-1234')$q$, t.claim('kidu', 'realmom')), 'a moderator verifies the parent');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('realmom'), t.id('kidu')), 'verified: is_guardian_of is true');
SELECT t.eq((SELECT verified_by FROM public.guardian_links WHERE id = t.link('realmom', 'kidu')), t.id('modone'), 'the link records who verified it');
SELECT t.eq((SELECT verification_method FROM public.guardian_links WHERE id = t.link('realmom', 'kidu')), 'government_id', 'and how');
SELECT t.eq((SELECT status || '/' || method FROM public.parental_consents WHERE child_user_id = t.id('kidu')), 'approved/manual_review', 'consent is recorded on activation');
SELECT t.ok(NOT public.child_features_locked(t.id('kidu')), 'the under-13 account unlocks');
SELECT t.ok(public.minor_messaging_block(t.id('realmom'), t.id('kidu')) IS NULL, 'the guardian can message their child');
SELECT t.as_user(t.id('realmom'));
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"messaging":"teammates"}'::jsonb)$q$, t.id('kidu')), 'the guardian functions work');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_children_overview()'), 1, 'and the Parent Center lists the child');
SELECT t.reset();
SELECT t.eq((SELECT string_agg(action || ':' || actor_role, ',' ORDER BY id) FROM public.guardian_link_audit WHERE child_user_id = t.id('kidu')),
            'claim_created:child,link_activated:staff,claim_approved:staff', 'audit: claim, activation and approval, with roles');
SELECT t.eq((SELECT actor_id::text || '/' || evidence_ref || '/' || method FROM public.guardian_link_audit WHERE child_user_id = t.id('kidu') AND action = 'link_activated'),
            t.id('modone')::text || '/CASE-1234/government_id', 'audit: who verified, the evidence reference and the method');

-- a staff member who is a party cannot verify their own claim
SELECT t.invite('modtwo', 'modtwo');
SELECT t.as_user(t.id('teend'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('modtwo')), 'setup: a child redeems a staff member''s invitation');
SELECT t.as_user(t.id('modtwo'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0002')$q$, t.claim('teend', 'modtwo')), 'CONFLICT_OF_INTEREST', 'staff cannot verify themselves');
SELECT t.reset();

-- ================= 4. existing legitimate links are untouched
SELECT t.ok(public.is_guardian_of(t.id('oldmom'), t.id('oldkid')) AND public.is_guardian_of(t.id('oldmom'), t.id('oldkidu')), 'existing links stay active');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links g JOIN before_links b ON b.id = g.id
              WHERE (g.status, g.verified_at, g.verified_by, g.verification_method) IS DISTINCT FROM (b.status, b.verified_at, b.verified_by, b.verification_method)), 0,
            'and unchanged (no backfill, no re-verification)');
SELECT t.as_user(t.id('oldmom'));
SELECT t.lives(format($q$SELECT public.set_child_controls(%L, '{"messaging":"teammates"}'::jsonb)$q$, t.id('oldkid')), 'an existing guardian still manages controls');
SELECT t.reset();
SELECT t.ok(public.minor_messaging_block(t.id('oldmom'), t.id('oldkid')) IS NULL, 'and still messages their child');

-- ================= 5. fraudulent claims: a stranger who coached, hosted, contacted or chatted with the child
SELECT t.eq((SELECT signals FROM public.guardian_link_requests WHERE id = t.claim('teen', 'coachx')), ARRAY['shared_team']::text[],
            'the coach''s claim is flagged: they share a team');
SELECT t.invite('hostx', 'host');
SELECT t.invite('contactx', 'contact');
SELECT t.invite('chatx', 'chat');
SELECT t.as_user(t.id('teenb'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('host')), 'setup: a player redeems the host''s invitation');
SELECT t.as_user(t.id('teenc'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('contact')), 'setup: a contacted player redeems');
SELECT t.as_user(t.id('teene'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('chat')), 'setup: a chat partner redeems');
SELECT t.reset();
SELECT t.eq((SELECT signals FROM public.guardian_link_requests WHERE id = t.claim('teenb', 'hostx')), ARRAY['shared_game']::text[], 'a game host''s claim is flagged');
SELECT t.eq((SELECT signals FROM public.guardian_link_requests WHERE id = t.claim('teenc', 'contactx')), ARRAY['contact_request']::text[], 'a contact request is flagged');
SELECT t.eq((SELECT signals FROM public.guardian_link_requests WHERE id = t.claim('teene', 'chatx')), ARRAY['conversation']::text[], 'a conversation is flagged');
SELECT t.ok(NOT public.is_guardian_of(t.id('coachx'), t.id('teen')) AND NOT public.is_guardian_of(t.id('hostx'), t.id('teenb'))
            AND NOT public.is_guardian_of(t.id('contactx'), t.id('teenc')) AND NOT public.is_guardian_of(t.id('chatx'), t.id('teene')),
            'none of them is a guardian');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0003')$q$, t.claim('teen', 'coachx')), 'SIGNALS_NOT_ACKNOWLEDGED', 'a flagged claim cannot be verified by default');
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0004')$q$, t.claim('teenb', 'hostx')), 'SIGNALS_NOT_ACKNOWLEDGED', 'nor the host''s');
SELECT t.lives(format($q$SELECT public.staff_decline_guardian_claim(%L, 'Not the parent: coach of the team')$q$, t.claim('teen', 'coachx')), 'staff decline the coach');
SELECT t.throws(format($q$SELECT public.staff_decline_guardian_claim(%L, '')$q$, t.claim('teenb', 'hostx')), 'REASON_REQUIRED', 'a decline needs a reason');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.guardian_link_requests WHERE id = t.claim('teen', 'coachx')), 'declined', 'the coach''s claim is declined');
SELECT t.eq((SELECT reason FROM public.guardian_link_audit WHERE request_id = t.claim('teen', 'coachx') AND action = 'claim_declined'), 'Not the parent: coach of the team', 'audit: the decline and its reason');
-- a signal that appears AFTER the claim (the stranger messages the child while the claim waits) is caught at verification
SET LOCAL session_replication_role = replica;
INSERT INTO public.conversations (id, created_by) VALUES ('00000000-0000-0000-0000-0000000005c3', t.id('contactx'));
INSERT INTO public.conversation_participants (conversation_id, user_id) VALUES
  ('00000000-0000-0000-0000-0000000005c3', t.id('contactx')), ('00000000-0000-0000-0000-0000000005c3', t.id('teenc'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('modone'));
SELECT t.eq((SELECT signals FROM public.staff_guardian_claims() WHERE request_id = t.claim('teenc', 'contactx')), ARRAY['contact_request', 'conversation']::text[],
            'a relationship built while the claim waits shows up in the staff queue');
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0009')$q$, t.claim('teenc', 'contactx')), 'conversation', 'and blocks verification without acknowledgement');
SELECT t.reset();
-- a parent who really coaches their child's team: flagged, then verified only with the reviewer's explicit acknowledgement
SELECT t.invite('dadcoach', 'dad', 'Teenf');
SELECT t.as_user(t.id('teenf'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('dad')), 'setup: a coach''s own child redeems');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'consent_document', 'CASE-0005')$q$, t.claim('teenf', 'dadcoach')), 'SIGNALS_NOT_ACKNOWLEDGED', 'the parent-coach is flagged too');
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'consent_document', 'CASE-0005', true)$q$, t.claim('teenf', 'dadcoach'))), 'second_review_required',
            'once the reviewer acknowledges the signal it is a first review: a flagged claim needs a second reviewer');
SELECT t.ok(NOT public.is_guardian_of(t.id('dadcoach'), t.id('teenf')), 'the first review alone activates nothing');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'CASE-0015', true)$q$, t.claim('teenf', 'dadcoach'))), 'activated',
            'and a different staff member''s acknowledged second review verifies it');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('dadcoach'), t.id('teenf')), 'the parent-coach is now a guardian');
SELECT t.eq((SELECT detail -> 'signals' FROM public.guardian_link_audit WHERE link_id = t.link('dadcoach', 'teenf') AND action = 'link_activated'), '["shared_team"]'::jsonb,
            'audit: the acknowledged signals are recorded with the activation');

-- ================= 6. expired invitations
SELECT t.invite('realmom', 'late');
UPDATE public.minor_invites SET expires_at = now() - interval '1 minute' WHERE token_hash = t.tok('late');
SELECT t.invite('realmom', 'old');
UPDATE public.minor_invites SET created_at = now() - interval '15 days' WHERE token_hash = t.tok('old');
SELECT t.as_user(t.id('teenr'));
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('late')), 'INVITE_EXPIRED', 'an expired invitation is refused');
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('old')), 'INVITE_EXPIRED', 'an invitation older than 14 days is refused even if its expiry was set later');
SELECT t.as_user(t.id('realmom'));
SELECT t.lives(format('SELECT public.create_minor_invite(%L, %L, %L, now() + interval ''90 days'')', 'Kiddo', 'parent', t.tok('long')), 'setup: an invitation asking for 90 days');
SELECT t.reset();
SELECT t.ok((SELECT expires_at FROM public.minor_invites WHERE token_hash = t.tok('long')) <= now() + interval '14 days', 'is capped at 14 days');

-- ================= 7. forged approvals
-- clients have no write privilege at all
SELECT t.as_user(t.id('teenb'));
SELECT t.throws(format($q$UPDATE public.guardian_link_requests SET status = 'approved', decided_by = %L, decided_at = now() WHERE id = %L$q$, t.id('teenb'), t.claim('teenb', 'hostx')),
                'permission denied', 'the child cannot approve the claim directly');
SELECT t.refused(format($q$INSERT INTO public.guardian_links (parent_user_id, child_user_id, status, verified_at, verified_by) VALUES (%L, %L, 'active', now(), %L)$q$, t.id('hostx'), t.id('teenb'), t.id('modone')),
                'the child cannot insert a verified link');
SELECT t.as_user(t.id('hostx'));
SELECT t.refused(format($q$INSERT INTO public.guardian_links (parent_user_id, child_user_id, status, verified_at) VALUES (%L, %L, 'active', now())$q$, t.id('hostx'), t.id('teenb')),
                'the inviter cannot insert a verified link');
SELECT t.throws(format($q$UPDATE public.guardian_link_requests SET status = 'approved', verification_method = 'government_id', evidence_ref = 'x' WHERE id = %L$q$, t.claim('teenb', 'hostx')),
                'permission denied', 'the inviter cannot approve the claim directly');
SELECT t.throws(format($q$INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, status, kind) VALUES (%L, %L, 'approved', 'first_guardian')$q$, t.id('teenb'), t.id('hostx')),
                'permission denied', 'nor insert an approved request');
SELECT t.as_user(t.id('oldkid'));
SELECT t.refused(format($q$UPDATE public.guardian_links SET verified_by = %L, verified_at = now() WHERE child_user_id = %L$q$, t.id('modone'), t.id('oldkid')),
                'a child cannot rewrite the verification of an existing link');
SELECT t.as_user(t.id('oldmom'));
SELECT t.refused(format($q$UPDATE public.guardian_links SET status = 'active', verified_by = %L WHERE child_user_id = %L$q$, t.id('modone'), t.id('oldkid')),
                'nor can the guardian');
SELECT t.reset();
-- defense in depth: even a write that reaches the table from a signed-in session (a definer path that forgot the flag) is refused
SELECT set_config('request.jwt.claim.sub', t.id('hostx')::text, true);
SELECT t.throws(format($q$INSERT INTO public.guardian_links (parent_user_id, child_user_id, status, verified_at) VALUES (%L, %L, 'active', now())$q$, t.id('hostx'), t.id('teenb')),
                'GUARDIAN_LINK_WRITE_REFUSED', 'trigger: the inviter''s session cannot insert an active link');
SELECT t.throws(format($q$UPDATE public.guardian_link_requests SET status = 'approved', decided_by = %L WHERE id = %L$q$, t.id('hostx'), t.claim('teenb', 'hostx')),
                'GUARDIAN_LINK_WRITE_REFUSED', 'trigger: nor approve the request');
SELECT set_config('request.jwt.claim.sub', t.id('teenb')::text, true);
SELECT t.throws(format($q$UPDATE public.guardian_link_requests SET status = 'approved' WHERE id = %L$q$, t.claim('teenb', 'hostx')),
                'GUARDIAN_LINK_WRITE_REFUSED', 'trigger: the child''s session cannot approve it');
SELECT t.throws(format($q$INSERT INTO public.guardian_links (parent_user_id, child_user_id, status, verified_at) VALUES (%L, %L, 'active', now())$q$, t.id('hostx'), t.id('teenb')),
                'GUARDIAN_LINK_WRITE_REFUSED', 'trigger: nor insert the link');
SELECT set_config('request.jwt.claim.sub', t.id('oldmom')::text, true);
SELECT t.throws(format($q$UPDATE public.guardian_links SET verified_by = %L WHERE id = %L$q$, t.id('modone'), t.link('oldmom', 'oldkid')),
                'GUARDIAN_LINK_WRITE_REFUSED', 'trigger: a guardian cannot stamp a verifier on their own link');
SELECT t.throws(format($q$UPDATE public.guardian_links SET status = 'revoked', verified_at = now() - interval '1 day' WHERE id = %L$q$, t.link('oldmom', 'oldkid')),
                'GUARDIAN_LINK_WRITE_REFUSED', 'trigger: nor re-date it while revoking');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('hostx'), t.id('teenb')), 'no forged write made the host a guardian');
SELECT t.eq((SELECT status FROM public.guardian_link_requests WHERE id = t.claim('teenb', 'hostx')), 'pending', 'and the claim is still pending');

-- ================= 8. compromised invitations: reuse, another child, after revocation, flooding
SELECT t.as_user(t.id('wrongkid'));
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('mom')), 'INVITE_USED', 'a used invitation cannot be reused by another child');
SELECT t.reset();
SELECT t.invite('realmom', 'leaked');
SELECT t.as_user(t.id('wrongkid'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('leaked')), 'a leaked link opened by a different child');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('realmom'), t.id('wrongkid')), 'gives the inviter nothing over that child');
SELECT t.as_user(t.id('randomadult'));
SELECT t.throws(format('SELECT public.withdraw_guardian_claim(%L)', t.claim('wrongkid', 'realmom')), 'REQUEST_NOT_FOUND', 'a third person cannot cancel it');
SELECT t.as_user(t.id('teenr'));
SELECT t.throws(format('SELECT public.withdraw_guardian_claim(%L)', t.claim('wrongkid', 'realmom')), 'REQUEST_NOT_FOUND', 'nor another child');
SELECT t.as_user(t.id('wrongkid'));
SELECT t.lives(format('SELECT public.withdraw_guardian_claim(%L)', t.claim('wrongkid', 'realmom')), 'the child withdraws the claim');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.guardian_link_requests WHERE id = t.claim('wrongkid', 'realmom')), 'withdrawn', 'it is withdrawn');
SELECT t.eq((SELECT actor_role FROM public.guardian_link_audit WHERE request_id = t.claim('wrongkid', 'realmom') AND action = 'claim_withdrawn'), 'child', 'audit: the child withdrew it');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE-0006')$q$, t.claim('wrongkid', 'realmom')), 'REQUEST_NOT_FOUND', 'a withdrawn claim cannot be verified');
SELECT t.reset();
SELECT t.as_user(t.id('teenr'));
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('leaked')), 'INVITE_USED', 'and the link stays used');
SELECT t.reset();
-- revoked by the inviter, and by staff
SELECT t.invite('realmom', 'cancelled');
SELECT t.invite('realmom', 'staffcancelled');
CREATE TEMP TABLE inv AS SELECT token_hash, id FROM public.minor_invites;
GRANT SELECT ON inv TO authenticated;
SELECT t.as_user(t.id('randomadult'));
SELECT t.throws(format('SELECT public.revoke_minor_invite(%L)', (SELECT id FROM inv WHERE token_hash = t.tok('cancelled'))), 'NOT_FOUND', 'a stranger cannot cancel an invitation');
SELECT t.as_user(t.id('realmom'));
SELECT t.lives(format('SELECT public.revoke_minor_invite(%L)', (SELECT id FROM inv WHERE token_hash = t.tok('cancelled'))), 'the inviter cancels one');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format('SELECT public.revoke_minor_invite(%L)', (SELECT id FROM inv WHERE token_hash = t.tok('staffcancelled'))), 'staff cancel another');
SELECT t.as_user(t.id('teenr'));
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('cancelled')), 'INVITE_REVOKED', 'a cancelled invitation cannot be redeemed');
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('staffcancelled')), 'INVITE_REVOKED', 'nor one staff cancelled');
SELECT t.reset();
-- flooding one child with claims
SELECT t.invite('spamone', 'sa'); SELECT t.invite('spamtwo', 'sb'); SELECT t.invite('spamthree', 'sc');
SELECT t.as_user(t.id('teenr'));
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('sa')), 'a child may hold a pending claim');
SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('sb')), 'and a second');
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('sc')), 'CLAIM_RATE_LIMITED', 'but not a third');
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.minor_invites WHERE token_hash = t.tok('sc')), 'pending', 'the refused invitation is not consumed');
-- one adult claiming many children
SELECT t.invite('spammer', 'p1'); SELECT t.invite('spammer', 'p2'); SELECT t.invite('spammer', 'p3'); SELECT t.invite('spammer', 'p4');
SELECT t.as_user(t.id('sone'));   SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('p1')), 'setup: claim 1');
SELECT t.as_user(t.id('stwo'));   SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('p2')), 'setup: claim 2');
SELECT t.as_user(t.id('sthree')); SELECT t.lives(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('p3')), 'setup: claim 3');
SELECT t.as_user(t.id('sfour'));  SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('p4')), 'CLAIM_RATE_LIMITED', 'one adult cannot hold more than three pending first-guardian claims');
SELECT t.reset();
-- invitation creation is rate limited
SELECT t.as_user(t.id('spammer'));
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r5') || md5('x'), now() + interval '1 day')$q$, 'setup: invitation 5');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r6') || md5('x'), now() + interval '1 day')$q$, 'setup: 6');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r7') || md5('x'), now() + interval '1 day')$q$, 'setup: 7');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r8') || md5('x'), now() + interval '1 day')$q$, 'setup: 8');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r9') || md5('x'), now() + interval '1 day')$q$, 'setup: 9');
SELECT t.lives($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r10') || md5('x'), now() + interval '1 day')$q$, 'setup: 10');
SELECT t.throws($q$SELECT public.create_minor_invite('Kiddo', 'parent', md5('r11') || md5('x'), now() + interval '1 day')$q$, 'TOO_MANY_INVITES', 'at most 10 invitations a day');
SELECT t.reset();

-- ================= 9. the consent email is not an activation path
UPDATE public.parental_consents SET status = 'pending', verification_token_hash = md5('consent-kidc'), token_expires_at = now() + interval '1 day', requested_at = now()
 WHERE child_user_id = t.id('kidc');
SELECT t.eq(has_function_privilege('authenticated', 'public.approve_parental_consent(text, text, uuid, jsonb)', 'EXECUTE'), false, 'approve_parental_consent is not callable by clients');
SELECT t.as_service();
SELECT t.throws(format($q$SELECT public.approve_parental_consent(%L, 'email_confirmation', NULL, '{}'::jsonb)$q$, md5('consent-kidc')), 'GUARDIAN_NOT_ELIGIBLE', 'consent without a known adult fails closed');
SELECT t.throws(format($q$SELECT public.approve_parental_consent(%L, 'email_confirmation', %L, '{}'::jsonb)$q$, md5('consent-kidc'), t.id('teenr')), 'GUARDIAN_NOT_ELIGIBLE', 'a minor cannot approve');
SELECT t.lives(format($q$SELECT public.approve_parental_consent(%L, 'email_confirmation', %L, '{"terms":"v9"}'::jsonb)$q$, md5('consent-kidc'), t.id('emailx')), 'an adult who opened the link');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('emailx'), t.id('kidc')), 'is not a guardian');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE child_user_id = t.id('kidc')), 0, 'and no link exists');
SELECT t.eq((SELECT kind || '/' || source || '/' || status FROM public.guardian_link_requests WHERE id = t.claim('kidc', 'emailx')), 'first_guardian/consent_email/pending', 'it is a pending claim');
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kidc')), 'pending', 'the consent stays pending');
SELECT t.ok((SELECT verification_token_hash IS NULL FROM public.parental_consents WHERE child_user_id = t.id('kidc')), 'and the link is used up');
SELECT t.ok(public.child_features_locked(t.id('kidc')), 'the child stays locked');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'CASE-0007')$q$, t.claim('kidc', 'emailx')), 'staff verify the consent-email claimant');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('emailx'), t.id('kidc')) AND NOT public.child_features_locked(t.id('kidc')), 'then the link and the consent apply');
SELECT t.eq((SELECT terms_version FROM public.parental_consents WHERE child_user_id = t.id('kidc')), 'v9', 'with the versions the guardian accepted');
-- a verified guardian approving their own child's consent works as before
UPDATE public.parental_consents SET status = 'pending', verification_token_hash = md5('consent-oldkidu'), token_expires_at = now() + interval '1 day'
 WHERE child_user_id = t.id('oldkidu');
SELECT t.as_service();
SELECT t.lives(format($q$SELECT public.approve_parental_consent(%L, 'email_confirmation', %L, '{}'::jsonb)$q$, md5('consent-oldkidu'), t.id('oldmom')), 'an existing guardian approves consent');
SELECT t.reset();
SELECT t.eq((SELECT status || '/' || method FROM public.parental_consents WHERE child_user_id = t.id('oldkidu')), 'approved/email_confirmation', 'unchanged for a verified guardian');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_link_requests WHERE child_user_id = t.id('oldkidu')), 0, 'and no claim is created');

-- ================= 10. managed children: the guardian who created the profile is still linked at once
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
VALUES (t.id('managedkid'), 'managedkid@example.test', now(), '{"display_name":"Managedkid"}'::jsonb,
        jsonb_build_object('managed', 'true', 'managed_by', t.id('realmom')::text));
SELECT t.as_user(t.id('realmom'));
SELECT t.lives(format($q$SELECT * FROM public.provision_managed_child(%L, (current_date - interval '9 years')::date, 'Mini', 'parent', NULL, jsonb_build_object('terms', (SELECT version FROM public.legal_documents WHERE document_type = 'terms' AND published ORDER BY effective_date DESC LIMIT 1), 'privacy', (SELECT version FROM public.legal_documents WHERE document_type = 'privacy' AND published ORDER BY effective_date DESC LIMIT 1)), true)$q$, t.id('managedkid')),
               'a guardian provisions a managed child');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('realmom'), t.id('managedkid')), 'the managed child is linked');
SELECT t.eq((SELECT verification_method FROM public.guardian_links WHERE id = t.link('realmom', 'managedkid')), 'managed_child_created', 'recorded as created by the guardian');

-- ================= 11. revocation and recovery, audited
SELECT t.as_user(t.id('realmom'));
SELECT t.throws(format($q$SELECT public.staff_revoke_guardian_link(%L, 'trying')$q$, t.link('realmom', 'kidu')), 'NOT_AUTHORIZED', 'a guardian cannot use the staff revoke');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_revoke_guardian_link(%L, '')$q$, t.link('realmom', 'kidu')), 'REASON_REQUIRED', 'a revocation needs a reason');
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Fraud report under review')$q$, t.link('realmom', 'kidu')), 'staff revoke a link');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('realmom'), t.id('kidu')), 'revoked: no authority');
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kidu')), 'revoked', 'and that guardian''s consent is withdrawn');
SELECT t.eq((SELECT actor_role || '/' || reason || '/' || (detail ->> 'guardian_cohort') FROM public.guardian_link_audit WHERE link_id = t.link('realmom', 'kidu') AND action = 'link_revoked'),
            'staff/Fraud report under review/adult', 'audit: the revocation, its reason and the guardian''s age band');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_restore_guardian_link(%L, 'Report was mistaken', '')$q$, t.link('realmom', 'kidu')), 'EVIDENCE_REQUIRED', 'a restore needs evidence');
SELECT t.reset();
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('realmom');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format($q$SELECT public.staff_restore_guardian_link(%L, 'Report was mistaken', 'CASE-0008')$q$, t.link('realmom', 'kidu')), 'GUARDIAN_NOT_ELIGIBLE', 'a restore re-checks the guardian');
SELECT t.reset();
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('realmom');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_restore_guardian_link(%L, 'Report was mistaken', 'CASE-0008')$q$, t.link('realmom', 'kidu')), 'staff restore a wrongly revoked link');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('realmom'), t.id('kidu')), 'restored: the guardian is back');
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kidu')), 'approved', 'with consent');
SELECT t.eq((SELECT actor_id::text || '/' || evidence_ref || '/' || reason FROM public.guardian_link_audit WHERE link_id = t.link('realmom', 'kidu') AND action = 'link_restored'),
            t.id('modone')::text || '/CASE-0008/Report was mistaken', 'audit: the restoration, who, the evidence and the reason');
-- a guardian ending their own link still works, and is audited
SELECT t.as_user(t.id('oldmom'));
SELECT t.lives(format('SELECT public.revoke_guardian_link(%L)', t.id('oldkid')), 'a guardian ends their own link');
SELECT t.reset();
SELECT t.eq((SELECT actor_role FROM public.guardian_link_audit WHERE link_id = t.link('oldmom', 'oldkid') AND action = 'link_revoked'), 'guardian', 'audit: the guardian''s own revocation');

-- ================= 12. the audit is append-only and private to staff and the parties
SELECT t.throws($q$UPDATE public.guardian_link_audit SET reason = 'edited'$q$, 'append-only', 'audit rows cannot be edited');
SELECT t.throws($q$DELETE FROM public.guardian_link_audit$q$, 'append-only', 'or deleted');
SELECT t.as_user(t.id('kidu'));
SELECT t.ok(t.count('SELECT 1 FROM public.guardian_link_audit') > 0 AND t.count(format('SELECT 1 FROM public.guardian_link_audit WHERE child_user_id <> %L AND guardian_user_id <> %L', t.id('kidu'), t.id('kidu'))) = 0,
            'the child reads their own audit rows only');
SELECT t.throws($q$INSERT INTO public.guardian_link_audit (child_user_id, guardian_user_id, action, actor_role) VALUES (auth.uid(), auth.uid(), 'link_activated', 'staff')$q$,
                'permission denied', 'and cannot write any');
SELECT t.as_user(t.id('realmom'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.guardian_link_audit WHERE guardian_user_id <> %L AND child_user_id <> %L', t.id('realmom'), t.id('realmom'))), 0, 'a guardian reads only their own rows');
SELECT t.as_user(t.id('randomadult'));
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_link_audit'), 0, 'a stranger reads none');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_link_requests'), 0, 'nor any claim');
SELECT t.throws('SELECT * FROM public.staff_guardian_claims()', 'NOT_AUTHORIZED', 'nor the staff queue');
SELECT t.as_user(t.id('modone'));
SELECT t.ok(t.count('SELECT 1 FROM public.guardian_link_audit') >= 10, 'staff read the audit');
SELECT t.ok(t.count('SELECT 1 FROM public.staff_guardian_claims()') >= 3, 'and the queue of pending claims');
SELECT t.eq((SELECT signals FROM public.staff_guardian_claims() WHERE request_id = t.claim('teene', 'chatx')), ARRAY['conversation']::text[], 'with the signals');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_link_audit'), 0, 'anonymous visitors read nothing');
SELECT t.reset();
SELECT t.ok(NOT has_function_privilege('anon', 'public.staff_verify_guardian_claim(uuid, text, text, boolean)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.withdraw_guardian_claim(uuid)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.staff_restore_guardian_link(uuid, text, text)', 'EXECUTE'), 'anonymous visitors cannot call the new functions');

ROLLBACK;
