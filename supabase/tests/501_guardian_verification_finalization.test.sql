-- SEC-4 finalization: two-person review of suspicious first-guardian claims, the invitation's child_name in the staff queue, appeals,
-- account recovery (lost access, a fraud revocation restored, a compromised guardian suspended), has_guardian_link after a staff revocation
-- of a managed child's guardian, and the core guarantees again: redemption alone and a pending (even first-reviewed) claim grant nothing,
-- the adult-eligibility check runs at activation, and every decision is audited.
BEGIN;
SELECT t.person('modone', 39), t.person('modtwo', 41), t.person('modthree', 42), t.person('modclaim', 43), t.person('randomadult', 29),
       t.person('momx', 40), t.person('kidpat', 12),
       t.person('dualx', 41), t.person('kidone', 14), t.person('kidtwo', 14),
       t.person('cleanx', 38), t.person('kidthree', 13), t.person('cleany', 37), t.person('kidfour', 15),
       t.person('kidfive', 14), t.person('teenclaimer', 16), t.person('adultkid', 25),
       t.person('appealx', 36), t.person('kidsix', 13), t.person('appealy', 35), t.person('kidseven', 15),
       t.person('famguard', 44), t.person('otheradult', 45), t.person('kideight', 12),
       t.person('latex', 33), t.person('kidlate', 14), t.person('serialx', 34), t.person('kidra', 14), t.person('kidrb', 14), t.person('kidrc', 14),
       t.person('kidrd', 14),
       t.person('lostmom', 40), t.person('newmom', 40), t.person('noconfirm', 40), t.person('kidnine', 10),
       t.person('fraudmom', 41), t.person('kidten', 11),
       t.person('hackedmom', 42), t.person('kideleven', 14), t.person('kidtwelve', 9), t.person('kidthirteen', 13),
       t.person('stolenmom', 43), t.person('kidfourteen', 12),
       t.person('managedmom', 39);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('modtwo'), 'admin'), (t.id('modthree'), 'moderator'),
                                                     (t.id('modclaim'), 'moderator');

CREATE FUNCTION t.tok(label text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$ SELECT md5('sec4f-invite-' || label) || md5(label) $f$;
CREATE FUNCTION t.invite(who text, label text, childname text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_user(t.id(who));
  PERFORM public.create_minor_invite(childname, 'parent', t.tok(label), now() + interval '7 days');
  PERFORM t.reset();
END $f$;
CREATE FUNCTION t.redeem(child text, label text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_user(t.id(child));
  PERFORM public.redeem_minor_invite(t.tok(label));
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
CREATE FUNCTION t.like(got text, pattern text, name text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  IF got LIKE pattern THEN RAISE NOTICE 'ok - %', name; ELSE RAISE NOTICE 'not ok - % (got %, wanted %)', name, got, pattern; END IF;
END $f$;
GRANT EXECUTE ON FUNCTION t.like(text, text, text) TO authenticated, anon;
-- a scalar query's result as text, or 'ERROR: <message>' (so a missing column or function is a failed assertion, not an aborted file)
CREATE FUNCTION t.q(sql text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  EXECUTE 'SELECT (' || sql || ')::text' INTO r;
  RETURN r;
EXCEPTION WHEN OTHERS THEN
  RETURN 'ERROR: ' || SQLERRM;
END $f$;
CREATE FUNCTION t.cnt(query text) RETURNS int LANGUAGE plpgsql AS $f$
DECLARE n int;
BEGIN
  EXECUTE format('SELECT count(*)::int FROM (%s) q', query) INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN RETURN 0;
          WHEN OTHERS THEN RETURN -1;
END $f$;
CREATE FUNCTION t.appeal_of(_request uuid) RETURNS uuid LANGUAGE plpgsql AS $f$
BEGIN
  RETURN (SELECT id FROM public.guardian_claim_appeals WHERE request_id = _request);
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $f$;
GRANT EXECUTE ON FUNCTION t.q(text), t.cnt(text), t.appeal_of(uuid) TO authenticated, anon;
-- the audit trail of one request or link, as action:actor_role, oldest first
CREATE FUNCTION t.trail(_request uuid) RETURNS text LANGUAGE sql AS $f$
  SELECT string_agg(action || ':' || actor_role, ',' ORDER BY id) FROM public.guardian_link_audit WHERE request_id = _request
$f$;
GRANT EXECUTE ON FUNCTION t.tok(text), t.claim(text, text), t.link(text, text), t.res(text), t.trail(uuid) TO authenticated, anon;
CREATE FUNCTION t.vis_private(g text) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.hosted_game_private WHERE game_id = g $f$;
GRANT EXECUTE ON FUNCTION t.vis_private(text) TO authenticated;

-- a youth game with kidpat on the roster: its exact location is guardian-only data
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, location, neighborhood, lat, lng) VALUES
  ('g-sec4f', t.id('randomadult'), 'basketball', 'U13', now() + interval '2 days', 8, 13, 'School Gym, 9 Pine St', 'Eastside', 33.9, -84.5);
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g-sec4f', t.id('kidpat'));
SET LOCAL session_replication_role = origin;

-- ================= 1. case references and name matching (the inputs the two-person rule depends on)
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('GV-20261104')$s$), 'GV-20261104', 'a case reference is accepted');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('  zd-48213-b ')$s$), 'ZD-48213-B', 'normalized to upper case and trimmed');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('CASE') IS NULL$s$), 'true', 'four characters are not a reference');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('GV-123') IS NULL$s$), 'true', 'nor a reference with fewer than four digits');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('checked their ID on a call') IS NULL$s$), 'true', 'nor free text');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('https://drive.example/GV-1234') IS NULL$s$), 'true', 'nor a link to a document');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('mom@example.com') IS NULL$s$), 'true', 'nor an e-mail address');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_case_ref('GV-' || repeat('1', 70)) IS NULL$s$), 'true', 'nor more than 64 characters');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_name_plausible('Sam', ARRAY['Samantha Lee', NULL])$s$), 'true', 'names: a short form matches');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_name_plausible('Alexander', ARRAY['Player', 'alex_b'])$s$), 'true', 'names: the username counts too');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_name_plausible('Kidpat Smith', ARRAY['Kidpat'])$s$), 'true', 'names: any word matches');
SELECT t.eq(t.q($s$SELECT NOT private_sec.guardian_name_plausible('Jordan', ARRAY['Kidpat', 'kidpat'])$s$), 'true', 'names: a different name does not');
SELECT t.eq(t.q($s$SELECT NOT private_sec.guardian_name_plausible('Jo', ARRAY['Jordan'])$s$), 'true', 'names: two letters are not enough for a prefix');
SELECT t.eq(t.q($s$SELECT private_sec.guardian_name_plausible(NULL, ARRAY['Kidpat']) IS NULL$s$), 'true', 'names: no invitation name, no verdict');

-- ================= 2. a stolen or forwarded link: the invitation names another child
SELECT t.invite('momx', 'pat', 'Jordan');
SELECT t.redeem('kidpat', 'pat');
SELECT t.as_user(t.id('modone'));
CREATE TEMP TABLE q1 AS SELECT * FROM public.staff_guardian_claims() WHERE request_id = t.claim('kidpat', 'momx');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT invite_child_name || ' / ' || child_name FROM q1$s$), ('Jordan / Kidpat')::text, 'staff see the invitation''s child_name next to the redeemer''s name');
SELECT t.eq(t.q($s$SELECT name_match FROM q1$s$), (false)::text, 'flagged as a name mismatch');
SELECT t.eq(t.q($s$SELECT suspicion FROM q1$s$), (ARRAY['name_mismatch']::text[])::text, 'which makes the claim suspicious');
SELECT t.eq(t.q($s$SELECT review_stage FROM q1$s$), ('first_review')::text, 'so it needs a first and a second review');

-- redemption alone grants nothing (messaging, location, administration)
SELECT t.ok(NOT public.is_guardian_of(t.id('momx'), t.id('kidpat')) AND NOT private_sec.has_guardian_link(t.id('kidpat')),
            'redeemed: no guardian authority and no guardian link');
SELECT t.as_user(t.id('momx'));
SELECT t.throws(format('SELECT public.create_direct_conversation(%L)', t.id('kidpat')), 'MINOR_MESSAGING_BLOCKED', 'redeemed: no messaging');
SELECT t.eq(t.vis_private('g-sec4f'), 0, 'redeemed: no exact game location');
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"messaging":"peers"}'::jsonb)$q$, t.id('kidpat')), 'NOT_AUTHORIZED', 'redeemed: no controls');
SELECT t.eq(t.cnt('SELECT 1 FROM public.guardian_children_overview()'), 0, 'redeemed: no Parent Center');
SELECT t.reset();

-- first review
SELECT t.as_user(t.id('modone'));
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'CASE')$q$, t.claim('kidpat', 'momx'))), '%EVIDENCE_REQUIRED%',
              'a 4-character reference is refused');
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'looked at the ID')$q$, t.claim('kidpat', 'momx'))), '%EVIDENCE_REQUIRED%',
              'so is free text');
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'gv-20261104')$q$, t.claim('kidpat', 'momx'))), 'second_review_required',
            'the first reviewer only records a first review');
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'GV-20261105')$q$, t.claim('kidpat', 'momx'))), '%SECOND_REVIEWER_REQUIRED%',
              'and cannot also make the second');
SELECT t.eq(t.q($s$SELECT can_review::text || '/' || review_stage FROM public.staff_guardian_claims() WHERE request_id = t.claim('kidpat', 'momx')$s$), ('false/second_review')::text,
            'the queue tells the first reviewer someone else must finish it');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.q($s$SELECT can_review::text || '/' || review_stage || '/' || first_reviewer_name FROM public.staff_guardian_claims() WHERE request_id = t.claim('kidpat', 'momx')$s$), ('true/second_review/Modone')::text, 'and shows another staff member who made the first review');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT status || '/' || first_review_evidence_ref FROM public.guardian_link_requests WHERE id = t.claim('kidpat', 'momx')$s$), ('pending/GV-20261104')::text,
            'after the first review the claim is still pending (reference stored normalized)');

-- a first-reviewed claim still grants nothing
SELECT t.ok(NOT public.is_guardian_of(t.id('momx'), t.id('kidpat')) AND NOT private_sec.has_guardian_link(t.id('kidpat'))
            AND public.minor_messaging_block(t.id('momx'), t.id('kidpat')) IS NOT NULL, 'first-reviewed: no authority, no link, no messaging');
SELECT t.as_user(t.id('momx'));
SELECT t.eq(t.vis_private('g-sec4f'), 0, 'first-reviewed: no exact game location');
SELECT t.throws(format($q$SELECT public.create_parent_request(%L, 'access', 'x')$q$, t.id('kidpat')), 'NOT_AUTHORIZED', 'first-reviewed: no data requests');
SELECT t.throws(format($q$SELECT public.revoke_parental_consent(%L, 'x')$q$, t.id('kidpat')), 'NOT_AUTHORIZED', 'first-reviewed: no consent management');
SELECT t.reset();

-- the adult-eligibility check runs at activation (the second review), not only at the first
UPDATE public.profiles SET age_review_required = true WHERE id = t.id('momx');
SELECT t.as_user(t.id('modtwo'));
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'GV-20261105')$q$, t.claim('kidpat', 'momx'))), '%GUARDIAN_NOT_ELIGIBLE%',
              'a claimant whose age went under review cannot be activated by the second review');
SELECT t.reset();
UPDATE public.profiles SET age_review_required = false WHERE id = t.id('momx');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'GV-20261105')$q$, t.claim('kidpat', 'momx'))), 'activated',
            'a second, different staff member activates it');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('momx'), t.id('kidpat')), 'only now is the claimant a guardian');
SELECT t.eq(t.q($s$SELECT verified_by FROM public.guardian_links WHERE id = t.link('momx', 'kidpat')$s$), (t.id('modtwo'))::text, 'the link names the second reviewer');
SELECT t.eq(t.trail(t.claim('kidpat', 'momx')), 'claim_created:child,claim_first_review:staff,link_activated:staff,claim_approved:staff',
            'audit: the claim, the first review, the activation and the approval');
SELECT t.eq(t.q($s$SELECT actor_id::text || '/' || method || '/' || evidence_ref FROM public.guardian_link_audit
              WHERE request_id = t.claim('kidpat', 'momx') AND action = 'claim_first_review'$s$), (t.id('modone')::text || '/government_id/GV-20261104')::text, 'audit: who made the first review, how, and the reference');
SELECT t.eq(t.q($s$SELECT actor_id::text || '/' || method || '/' || evidence_ref || '/' || (detail ->> 'first_review_by') FROM public.guardian_link_audit
              WHERE request_id = t.claim('kidpat', 'momx') AND action = 'link_activated'$s$), (t.id('modtwo')::text || '/video_call/GV-20261105/' || t.id('modone')::text)::text, 'audit: the second review names both reviewers');
SELECT t.as_user(t.id('momx'));
SELECT t.eq(t.vis_private('g-sec4f'), 1, 'positive control: the verified guardian now reads the exact location');
SELECT t.reset();

-- ================= 3. the other suspicion criteria
-- the claimant has another pending claim
SELECT t.invite('dualx', 'd1', 'Kidone');
SELECT t.invite('dualx', 'd2', 'Kidtwo');
SELECT t.redeem('kidone', 'd1');
SELECT t.redeem('kidtwo', 'd2');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.q($s$SELECT suspicion FROM public.staff_guardian_claims() WHERE request_id = t.claim('kidone', 'dualx')$s$), (ARRAY['other_claims']::text[])::text,
            'a claimant holding other claims is suspicious (names match)');
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-30000001')$q$, t.claim('kidone', 'dualx'))), 'second_review_required',
            'and needs a second reviewer');
SELECT t.reset();
-- method 'other' always needs a second review
SELECT t.invite('cleanx', 'c1', 'Kidthree');
SELECT t.redeem('kidthree', 'c1');
SELECT t.invite('cleany', 'c2', 'Kidfour');
SELECT t.redeem('kidfour', 'c2');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.q($s$SELECT review_stage || '/' || cardinality(suspicion) FROM public.staff_guardian_claims() WHERE request_id = t.claim('kidthree', 'cleanx')$s$), ('single_review/0')::text,
            'a clean claim needs one verifier');
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'other', 'GV-30000002')$q$, t.claim('kidthree', 'cleanx'))), 'second_review_required',
            'but verifying it by method "other" makes it a first review');
SELECT t.eq(t.q($s$SELECT suspicion FROM public.guardian_link_requests WHERE id = t.claim('kidthree', 'cleanx')$s$), (ARRAY['method_other']::text[])::text, 'recorded as method_other');
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-30000003')$q$, t.claim('kidfour', 'cleany'))), 'activated',
            'a clean claim with a named method is activated by one verifier');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-30000004')$q$, t.claim('kidthree', 'cleanx'))), 'activated',
            'the "other" claim activates on a second review');
SELECT t.reset();
-- the two reviewers must both be non-parties
SELECT t.invite('modclaim', 'mc', 'Jordan');
SELECT t.redeem('kidfive', 'mc');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-30000005')$q$, t.claim('kidfive', 'modclaim'))), 'second_review_required',
            'setup: a first review of a staff member''s own claim');
SELECT t.as_user(t.id('modclaim'));
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-30000006')$q$, t.claim('kidfive', 'modclaim'))), '%CONFLICT_OF_INTEREST%',
              'the claimant cannot make the second review, staff or not');
SELECT t.as_user(t.id('kidfive'));
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-30000006')$q$, t.claim('kidfive', 'modclaim'))), '%NOT_AUTHORIZED%',
              'nor the child who redeemed it');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('modclaim'), t.id('kidfive')), 'still nobody''s guardian');
-- activation itself refuses an ineligible guardian or a child who is now an adult, whichever path calls it
INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, kind) VALUES (t.id('kidfive'), t.id('teenclaimer'), 'first_guardian');
INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, kind) VALUES (t.id('adultkid'), t.id('randomadult'), 'first_guardian');
SELECT t.throws(format($q$SELECT private_sec.guardian_activate(r, %L, 'staff', 'government_id', 'GV-30000007', '{}'::jsonb) FROM public.guardian_link_requests r WHERE id = %L$q$,
                       t.id('modone'), t.claim('kidfive', 'teenclaimer')), 'GUARDIAN_NOT_ELIGIBLE', 'guardian_activate refuses a minor claimant');
SELECT t.throws(format($q$SELECT private_sec.guardian_activate(r, %L, 'staff', 'government_id', 'GV-30000007', '{}'::jsonb) FROM public.guardian_link_requests r WHERE id = %L$q$,
                       t.id('modone'), t.claim('adultkid', 'randomadult')), 'CHILD_NOT_MINOR', 'and a child who is an adult now');

-- ================= 4. appeals
SELECT t.invite('appealx', 'ap', 'Jordan');
SELECT t.redeem('kidsix', 'ap');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_decline_guardian_claim(%L, 'Could not confirm identity')$q$, t.claim('kidsix', 'appealx')), 'setup: staff decline a claim');
SELECT t.as_user(t.id('kidtwo'));
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'I know this is really my parent and want them linked.')$q$, t.claim('kidtwo', 'dualx'))),
              '%APPEAL_NOT_AVAILABLE%', 'a pending claim cannot be appealed');
SELECT t.as_user(t.id('randomadult'));
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'I would like to appeal this decision please.')$q$, t.claim('kidsix', 'appealx'))),
              '%REQUEST_NOT_FOUND%', 'a stranger cannot appeal');
SELECT t.as_user(t.id('appealx'));
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'wrong')$q$, t.claim('kidsix', 'appealx'))), '%APPEAL_REASON_REQUIRED%', 'an appeal needs a reason');
SELECT t.lives(format($q$SELECT public.file_guardian_claim_appeal(%L, 'I am her mother; I can show the birth certificate on a video call.')$q$, t.claim('kidsix', 'appealx')),
               'the declined claimant appeals');
SELECT t.as_user(t.id('kidsix'));
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'This really is my mom, please link her account.')$q$, t.claim('kidsix', 'appealx'))),
              '%APPEAL_EXISTS%', 'one appeal per claim');
SELECT t.eq(t.cnt('SELECT 1 FROM public.guardian_claim_appeals'), 1, 'the child can read the appeal about them');
SELECT t.throws($q$INSERT INTO public.guardian_claim_appeals (request_id, child_user_id, claimant_user_id, filed_by, filed_role, reason)
                  SELECT request_id, child_user_id, claimant_user_id, filed_by, filed_role, reason FROM public.guardian_claim_appeals$q$,
                'permission denied', 'nobody writes an appeal directly');
SELECT t.as_user(t.id('randomadult'));
SELECT t.eq(t.cnt('SELECT 1 FROM public.guardian_claim_appeals'), 0, 'a stranger reads no appeal');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.cnt('SELECT 1 FROM public.staff_guardian_claim_appeals()'), 0, 'the decliner does not get the appeal in their queue');
SELECT t.like(t.res(format($q$SELECT public.staff_decide_guardian_claim_appeal(%L, true, 'Reconsidered')$q$, t.appeal_of(t.claim('kidsix', 'appealx')))),
              '%CONFLICT_OF_INTEREST%', 'and cannot decide it');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.q($s$SELECT invite_child_name || '/' || filed_role FROM public.staff_guardian_claim_appeals()$s$), ('Jordan/claimant')::text, 'another staff member sees it, with the invitation name');
SELECT t.eq(t.res(format($q$SELECT public.staff_decide_guardian_claim_appeal(%L, true, 'Claimant offered stronger evidence')$q$, t.appeal_of(t.claim('kidsix', 'appealx')))),
            'upheld', 'and upholds it');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT status || '/' || (barred_reviewer = t.id('modone'))::text || '/' || ('reopened_on_appeal' = ANY (suspicion))::text
               FROM public.guardian_link_requests WHERE id = t.claim('kidsix', 'appealx')$s$), ('pending/true/true')::text, 'an upheld appeal reopens the claim, bars the decliner and needs two reviewers');
SELECT t.ok(NOT public.is_guardian_of(t.id('appealx'), t.id('kidsix')), 'an upheld appeal activates nothing');
SELECT t.as_user(t.id('modone'));
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-40000001')$q$, t.claim('kidsix', 'appealx'))), '%CONFLICT_OF_INTEREST%',
              'the decliner cannot review the reopened claim');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'GV-40000002')$q$, t.claim('kidsix', 'appealx'))), 'second_review_required',
            'the reopened claim gets a first review');
SELECT t.as_user(t.id('modthree'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'consent_document', 'GV-40000003')$q$, t.claim('kidsix', 'appealx'))), 'activated',
            'and a second');
SELECT t.reset();
SELECT t.eq(t.trail(t.claim('kidsix', 'appealx')),
            'claim_created:child,claim_declined:staff,appeal_filed:claimant,appeal_upheld:staff,claim_reopened:staff,claim_first_review:staff,link_activated:staff,claim_approved:staff',
            'audit: the decline, the appeal, its decision, the reopening and both reviews');
-- the child appeals; the appeal is rejected
SELECT t.invite('appealy', 'ay', 'Kidseven');
SELECT t.redeem('kidseven', 'ay');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_decline_guardian_claim(%L, 'No reply to our calls')$q$, t.claim('kidseven', 'appealy')), 'setup: another decline');
SELECT t.as_user(t.id('kidseven'));
SELECT t.lives(format($q$SELECT public.file_guardian_claim_appeal(%L, 'That is my dad, he was travelling and missed the calls.')$q$, t.claim('kidseven', 'appealy')),
               'the child appeals');
SELECT t.as_user(t.id('modthree'));
SELECT t.eq(t.res(format($q$SELECT public.staff_decide_guardian_claim_appeal(%L, false, 'Still no answer from the claimant')$q$,
                         t.appeal_of(t.claim('kidseven', 'appealy')))), 'rejected', 'staff reject it');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT status FROM public.guardian_link_requests WHERE id = t.claim('kidseven', 'appealy')$s$), ('declined')::text, 'the decline stands');
SELECT t.eq(t.q($s$SELECT string_agg(action || ':' || actor_role, ',' ORDER BY id) FROM public.guardian_link_audit
              WHERE request_id = t.claim('kidseven', 'appealy') AND action LIKE 'appeal%'$s$), ('appeal_filed:child,appeal_rejected:staff')::text, 'audit: the child''s appeal and its rejection');
-- a guardian's decline of an additional guardian is not appealable here
SELECT t.guardian('famguard', 'kideight');
SELECT t.invite('otheradult', 'oa', 'Kideight');
SELECT t.redeem('kideight', 'oa');
SELECT t.as_user(t.id('famguard'));
SELECT t.lives(format('SELECT public.guardian_decide_link_request(%L, false)', t.claim('kideight', 'otheradult')), 'setup: the current guardian declines');
SELECT t.as_user(t.id('otheradult'));
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'I am the other parent and should be linked as well.')$q$, t.claim('kideight', 'otheradult'))),
              '%APPEAL_NOT_AVAILABLE%', 'a family''s own decline is not a staff decision to appeal');
SELECT t.reset();
-- window and rate limit
SELECT t.lives($s$INSERT INTO public.guardian_link_requests (child_user_id, parent_user_id, kind, status, decided_by, decided_at, decided_role, decision_reason) VALUES
  (t.id('kidlate'), t.id('latex'), 'first_guardian', 'declined', t.id('modone'), now() - interval '31 days', 'staff', 'old'),
  (t.id('kidra'), t.id('serialx'), 'first_guardian', 'declined', t.id('modone'), now(), 'staff', 'x'),
  (t.id('kidrb'), t.id('serialx'), 'first_guardian', 'declined', t.id('modone'), now(), 'staff', 'x'),
  (t.id('kidrc'), t.id('serialx'), 'first_guardian', 'declined', t.id('modone'), now(), 'staff', 'x'),
  (t.id('kidrd'), t.id('serialx'), 'first_guardian', 'declined', t.id('modone'), now(), 'staff', 'x')$s$, 'setup: declined claims');
SELECT t.as_user(t.id('latex'));
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'Please look at this again, I am the parent.')$q$, t.claim('kidlate', 'latex'))),
              '%APPEAL_WINDOW_CLOSED%', 'appeals close 30 days after the decision');
SELECT t.as_user(t.id('serialx'));
SELECT t.lives(format($q$SELECT public.file_guardian_claim_appeal(%L, 'Please look at this again, I am the parent.')$q$, t.claim('kidra', 'serialx')), 'setup: appeal 1');
SELECT t.lives(format($q$SELECT public.file_guardian_claim_appeal(%L, 'Please look at this again, I am the parent.')$q$, t.claim('kidrb', 'serialx')), 'setup: appeal 2');
SELECT t.lives(format($q$SELECT public.file_guardian_claim_appeal(%L, 'Please look at this again, I am the parent.')$q$, t.claim('kidrc', 'serialx')), 'setup: appeal 3');
SELECT t.like(t.res(format($q$SELECT public.file_guardian_claim_appeal(%L, 'Please look at this again, I am the parent.')$q$, t.claim('kidrd', 'serialx'))),
              '%APPEAL_RATE_LIMITED%', 'at most three appeals per person in 30 days');
SELECT t.reset();

-- ================= 5. account recovery: a guardian who lost access is re-linked only to a verified identity, by two other staff
SELECT t.guardian('lostmom', 'kidnine');
UPDATE public.parental_consents SET parent_user_id = t.id('lostmom') WHERE child_user_id = t.id('kidnine');   -- as an approval records it
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = t.id('noconfirm');
SELECT t.as_user(t.id('lostmom'));
SELECT t.like(t.res(format($q$SELECT public.staff_open_guardian_recovery(%L, %L, 'Lost my phone')$q$, t.link('lostmom', 'kidnine'), t.id('newmom'))), '%NOT_AUTHORIZED%',
              'a guardian cannot open a recovery themselves');
SELECT t.as_user(t.id('modone'));
SELECT t.like(t.res(format($q$SELECT public.staff_open_guardian_recovery(%L, %L, 'Lost access')$q$, t.link('lostmom', 'kidnine'), t.id('teenclaimer'))),
              '%GUARDIAN_NOT_ELIGIBLE%', 'recovery never links a minor account');
SELECT t.like(t.res(format($q$SELECT public.staff_open_guardian_recovery(%L, %L, 'Lost access')$q$, t.link('lostmom', 'kidnine'), t.id('noconfirm'))),
              '%GUARDIAN_NOT_ELIGIBLE%', 'nor an account with an unconfirmed e-mail');
SELECT t.lives(format($q$SELECT public.staff_open_guardian_recovery(%L, %L, 'Lost access to old e-mail; ticket ZD-50001')$q$, t.link('lostmom', 'kidnine'), t.id('newmom')),
               'staff open a recovery to the new account');
SELECT t.eq(t.q($s$SELECT review_stage || '/' || can_review::text || '/' || array_to_string(suspicion, ',') FROM public.staff_guardian_claims()
              WHERE request_id = t.claim('kidnine', 'newmom')$s$), ('first_review/false/account_recovery')::text,
            'a recovery is always suspicious, and the submitter cannot review it');
SELECT t.like(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-50000001')$q$, t.claim('kidnine', 'newmom'))), '%CONFLICT_OF_INTEREST%',
              'separation of submission and verification');
SELECT t.as_user(t.id('lostmom'));
SELECT t.like(t.res(format('SELECT public.guardian_decide_link_request(%L, true)', t.claim('kidnine', 'newmom'))), '%REQUEST_NOT_FOUND%',
              'a recovery is not approvable by a guardian (here the lost account itself)');
SELECT t.as_user(t.id('modtwo'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'video_call', 'GV-50000002')$q$, t.claim('kidnine', 'newmom'))), 'second_review_required',
            'first review of the recovery');
SELECT t.ok(NOT public.is_guardian_of(t.id('newmom'), t.id('kidnine')) AND public.is_guardian_of(t.id('lostmom'), t.id('kidnine')),
            'nothing moves until the second review');
SELECT t.as_user(t.id('modthree'));
SELECT t.eq(t.res(format($q$SELECT public.staff_verify_guardian_claim(%L, 'government_id', 'GV-50000003')$q$, t.claim('kidnine', 'newmom'))), 'activated',
            'second review of the recovery');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('newmom'), t.id('kidnine')) AND NOT public.is_guardian_of(t.id('lostmom'), t.id('kidnine')),
            'the verified account is linked and the lost account''s link is revoked');
SELECT t.eq(t.q($s$SELECT status || '/' || parent_user_id::text FROM public.parental_consents WHERE child_user_id = t.id('kidnine')$s$), ('approved/' || t.id('newmom')::text)::text,
            'consent now names the verified account');
SELECT t.eq(t.q($s$SELECT method || '/' || actor_role FROM public.guardian_link_audit WHERE link_id = t.link('lostmom', 'kidnine') AND action = 'link_revoked'$s$), ('account_recovery/staff')::text, 'audit: the old link was revoked by the recovery');
SELECT t.eq(t.trail(t.claim('kidnine', 'newmom')), 'claim_created:staff,claim_first_review:staff,link_activated:staff,claim_approved:staff,link_revoked:staff',
            'audit: the recovery from opening to activation');

-- ================= 6. a link revoked for suspected fraud is restored only by two staff members
SELECT t.guardian('fraudmom', 'kidten');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Reported as not the parent', true)$q$, t.link('fraudmom', 'kidten')), 'staff revoke for suspected fraud');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT detail ->> 'suspected_fraud' FROM public.guardian_link_audit WHERE link_id = t.link('fraudmom', 'kidten') AND action = 'link_revoked'$s$), ('true')::text,
            'audit: the revocation is marked as suspected fraud');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.res(format($q$SELECT public.staff_restore_guardian_link(%L, 'Report was mistaken', 'GV-60000001')$q$, t.link('fraudmom', 'kidten'))), 'second_review_required',
            'one staff member''s restore is only a first review');
SELECT t.like(t.res(format($q$SELECT public.staff_restore_guardian_link(%L, 'Report was mistaken', 'GV-60000001')$q$, t.link('fraudmom', 'kidten'))), '%SECOND_REVIEWER_REQUIRED%',
              'and the same person cannot finish it');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('fraudmom'), t.id('kidten')), 'the link stays revoked meanwhile');
SELECT t.as_user(t.id('modtwo'));
SELECT t.like(t.res(format($q$SELECT public.staff_restore_guardian_link(%L, 'Report was mistaken', 'see notes')$q$, t.link('fraudmom', 'kidten'))), '%EVIDENCE_REQUIRED%',
              'the second review needs a case reference too');
SELECT t.eq(t.res(format($q$SELECT public.staff_restore_guardian_link(%L, 'Confirmed with school records', 'GV-60000002')$q$, t.link('fraudmom', 'kidten'))), 'restored',
            'a second staff member restores it');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('fraudmom'), t.id('kidten')), 'restored');
SELECT t.eq(t.q($s$SELECT (detail ->> 'first_review_by') || '/' || actor_id::text || '/' || evidence_ref FROM public.guardian_link_audit
              WHERE link_id = t.link('fraudmom', 'kidten') AND action = 'link_restored'$s$), (t.id('modone')::text || '/' || t.id('modtwo')::text || '/GV-60000002')::text, 'audit: the restoration names both reviewers');

-- ================= 7. a compromised guardian account: authority suspended at once, lifted only by another staff member
SELECT t.guardian('hackedmom', 'kideleven');
SELECT t.guardian('hackedmom', 'kidtwelve');
INSERT INTO public.managed_device_pairings (child_user_id, created_by, code_hash, expires_at)
VALUES (t.id('kidtwelve'), t.id('hackedmom'), repeat('a', 64), now() + interval '10 minutes');
SELECT t.as_user(t.id('hackedmom'));
SELECT t.like(t.res(format($q$SELECT public.staff_suspend_guardian_authority(%L, 'nope')$q$, t.id('hackedmom'))), '%NOT_AUTHORIZED%', 'a guardian cannot use the staff suspension');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.res(format($q$SELECT public.staff_suspend_guardian_authority(%L, 'Account takeover reported (ZD-70001)')$q$, t.id('hackedmom'))), '2',
            'one staff member suspends the guardian''s authority at once');
SELECT t.like(t.res(format($q$SELECT public.staff_suspend_guardian_authority(%L, 'again')$q$, t.id('hackedmom'))), '%HOLD_EXISTS%', 'once');
SELECT t.reset();
SELECT t.ok(NOT public.is_guardian_of(t.id('hackedmom'), t.id('kideleven')) AND NOT public.is_guardian_of(t.id('hackedmom'), t.id('kidtwelve')),
            'suspended: no guardian authority over either child');
SELECT t.ok(NOT private_sec.has_guardian_link(t.id('kideleven')) AND public.minor_messaging_block(t.id('hackedmom'), t.id('kideleven')) IS NOT NULL,
            'suspended: no guardian link and no messaging');
SELECT t.ok(NOT private_sec.guardian_eligible(t.id('hackedmom')), 'suspended: not eligible for any activation');
SELECT t.eq(t.q($s$SELECT status FROM public.managed_device_pairings WHERE created_by = t.id('hackedmom')$s$), ('revoked')::text, 'suspended: open device pairings revoked');
SELECT t.as_user(t.id('hackedmom'));
SELECT t.throws(format($q$SELECT public.set_child_controls(%L, '{"messaging":"peers"}'::jsonb)$q$, t.id('kideleven')), 'NOT_AUTHORIZED', 'suspended: no controls');
SELECT t.eq(t.cnt('SELECT 1 FROM public.guardian_children_overview()'), 0, 'suspended: no Parent Center');
SELECT t.eq(t.cnt('SELECT 1 FROM public.guardian_authority_holds'), 1, 'the guardian can see the hold on their account');
SELECT t.lives(format('SELECT public.create_minor_invite(%L, %L, %L, now() + interval ''7 days'')', 'Kidthirteen', 'parent', t.tok('hk')), 'setup: the hijacked account invites');
SELECT t.as_user(t.id('kidthirteen'));
SELECT t.throws(format('SELECT * FROM public.redeem_minor_invite(%L)', t.tok('hk')), 'INVITE_INVALID', 'suspended: its invitations do not work');
SELECT t.eq(t.cnt('SELECT 1 FROM public.guardian_authority_holds'), 0, 'and nobody else reads the hold');
SELECT t.as_user(t.id('modone'));
SELECT t.like(t.res(format($q$SELECT public.staff_lift_guardian_suspension(%L, true, 'Secured', 'GV-70000001')$q$, t.id('hackedmom'))), '%SECOND_REVIEWER_REQUIRED%',
              'the staff member who suspended cannot lift it');
SELECT t.as_user(t.id('modtwo'));
SELECT t.like(t.res(format($q$SELECT public.staff_lift_guardian_suspension(%L, true, 'Secured')$q$, t.id('hackedmom'))), '%EVIDENCE_REQUIRED%',
              'reinstating needs a case reference');
SELECT t.eq(t.res(format($q$SELECT public.staff_lift_guardian_suspension(%L, true, 'Password reset, identity confirmed', 'GV-70000002')$q$, t.id('hackedmom'))), '2',
            'a different staff member reinstates after review');
SELECT t.reset();
SELECT t.ok(public.is_guardian_of(t.id('hackedmom'), t.id('kideleven')) AND public.is_guardian_of(t.id('hackedmom'), t.id('kidtwelve')), 'reinstated');
SELECT t.eq(t.q($s$SELECT verified_by::text || '/' || verification_method FROM public.guardian_links WHERE id = t.link('hackedmom', 'kideleven')$s$), (t.id('modtwo')::text || '/staff_reinstatement')::text, 're-verified by the reviewer who lifted the hold');
SELECT t.eq(t.q($s$SELECT string_agg(action || ':' || actor_id::text, ',' ORDER BY id) FROM public.guardian_link_audit
              WHERE guardian_user_id = t.id('hackedmom') AND child_user_id IS NULL$s$), ('guardian_authority_suspended:' || t.id('modone')::text || ',guardian_authority_hold_lifted:' || t.id('modtwo')::text)::text,
            'audit: the suspension and the lift, with who');
SELECT t.eq(t.q($s$SELECT string_agg(action, ',' ORDER BY id) FROM public.guardian_link_audit WHERE link_id = t.link('hackedmom', 'kideleven') AND action <> 'link_activated'$s$), ('link_suspended,link_reinstated')::text, 'audit: each link''s suspension and reinstatement');
-- review concludes the account was not the parent's: revoke, then a restore needs two staff
SELECT t.guardian('stolenmom', 'kidfourteen');
UPDATE public.parental_consents SET parent_user_id = t.id('stolenmom') WHERE child_user_id = t.id('kidfourteen');
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives(format($q$SELECT public.staff_suspend_guardian_authority(%L, 'Suspicious sign-ins')$q$, t.id('stolenmom')), 'setup: suspend');
SELECT t.as_user(t.id('modthree'));
SELECT t.eq(t.res(format($q$SELECT public.staff_lift_guardian_suspension(%L, false, 'Account was sold; not the parent')$q$, t.id('stolenmom'))), '0',
            'another staff member lifts the hold by revoking');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT status FROM public.guardian_links WHERE id = t.link('stolenmom', 'kidfourteen')$s$), ('revoked')::text, 'the link is revoked');
SELECT t.eq(t.q($s$SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kidfourteen')$s$), ('revoked')::text, 'and that guardian''s consent withdrawn');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.res(format($q$SELECT public.staff_restore_guardian_link(%L, 'Owner proved identity', 'GV-70000003')$q$, t.link('stolenmom', 'kidfourteen'))),
            'second_review_required', 'restoring it later is a two-person decision');
SELECT t.reset();

-- ================= 8. has_guardian_link after staff revoke a managed child's guardian
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
VALUES (t.id('managedkid'), 'managedkid@example.test', now(), '{"display_name":"Managedkid"}'::jsonb,
        jsonb_build_object('managed', 'true', 'managed_by', t.id('managedmom')::text));
SELECT t.as_user(t.id('managedmom'));
SELECT t.lives(format($q$SELECT * FROM public.provision_managed_child(%L, (current_date - interval '9 years')::date, 'Mini', 'parent', NULL, jsonb_build_object('terms', (SELECT version FROM public.legal_documents WHERE document_type = 'terms' AND published ORDER BY effective_date DESC LIMIT 1), 'privacy', (SELECT version FROM public.legal_documents WHERE document_type = 'privacy' AND published ORDER BY effective_date DESC LIMIT 1)), true)$q$, t.id('managedkid')),
               'setup: a guardian provisions a managed child');
SELECT t.lives(format('SELECT public.create_device_pairing(%L, %L)', t.id('managedkid'), repeat('b', 64)), 'positive control: the managing guardian pairs a device');
SELECT t.reset();
SELECT t.ok(private_sec.has_guardian_link(t.id('managedkid')), 'a managed child has a guardian link');
SELECT public.notify_guardians_of(t.id('managedkid'), 'guardian_link', 'probe-before', 'x', '/parent');
SELECT t.eq(t.q($s$SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('managedmom') AND title = 'probe-before'$s$), (1)::text, 'and its guardian is notified about it');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.staff_revoke_guardian_link(%L, 'Court order received', true)$q$, t.link('managedmom', 'managedkid')), 'staff revoke the managing guardian');
SELECT t.reset();
SELECT t.ok(EXISTS (SELECT 1 FROM public.managed_accounts WHERE child_user_id = t.id('managedkid')), 'the managed_accounts row remains (account deletion is separate)');
SELECT t.ok(NOT private_sec.has_guardian_link(t.id('managedkid')), 'but it no longer counts as a guardian link');
SELECT t.ok(NOT public.is_guardian_of(t.id('managedmom'), t.id('managedkid')), 'nor as guardian authority');
SELECT public.notify_guardians_of(t.id('managedkid'), 'guardian_link', 'probe-after', 'x', '/parent');
SELECT t.eq(t.q($s$SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('managedmom') AND title = 'probe-after'$s$), (0)::text, 'the revoked guardian is no longer notified about the child');
SELECT t.eq(t.q($s$SELECT status FROM public.managed_device_pairings WHERE child_user_id = t.id('managedkid')$s$), ('revoked')::text, 'the open device pairing is revoked');
SELECT t.as_user(t.id('managedmom'));
SELECT t.throws(format('SELECT public.create_device_pairing(%L, %L)', t.id('managedkid'), repeat('c', 64)), 'NOT_MANAGED', 'and the revoked guardian cannot pair a new device');
SELECT t.reset();

-- ================= 9. audit and access
SELECT t.ok((SELECT array_agg(DISTINCT action) FROM public.guardian_link_audit) @>
            ARRAY['claim_first_review', 'claim_reopened', 'appeal_filed', 'appeal_upheld', 'appeal_rejected', 'guardian_authority_suspended',
                  'guardian_authority_hold_lifted', 'link_suspended', 'link_reinstated', 'link_restored', 'link_revoked'],
            'every kind of decision in this file left an audit row');
SELECT t.throws($q$UPDATE public.guardian_link_audit SET reason = 'edited' WHERE action = 'claim_first_review'$q$, 'append-only', 'audit rows stay append-only');
SELECT t.as_user(t.id('hackedmom'));
SELECT t.throws($q$UPDATE public.guardian_authority_holds SET lifted_at = now()$q$, 'permission denied', 'a guardian cannot lift their own hold');
SELECT t.reset();
SELECT t.eq(t.q($s$SELECT NOT has_function_privilege('anon', 'public.file_guardian_claim_appeal(uuid, text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.staff_decide_guardian_claim_appeal(uuid, boolean, text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.staff_open_guardian_recovery(uuid, uuid, text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.staff_suspend_guardian_authority(uuid, text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.staff_lift_guardian_suspension(uuid, boolean, text, text)', 'EXECUTE')
            AND NOT has_function_privilege('anon', 'public.staff_guardian_claim_appeals()', 'EXECUTE')$s$), 'true', 'anonymous visitors cannot call the new functions');
SELECT t.as_user(t.id('randomadult'));
SELECT t.like(t.res('SELECT count(*)::text FROM public.staff_guardian_claim_appeals()'), '%NOT_AUTHORIZED%', 'nor can a signed-in non-staff user read the appeal queue');
SELECT t.like(t.res(format($q$SELECT public.staff_lift_guardian_suspension(%L, true, 'x', 'GV-00000001')$q$, t.id('hackedmom'))), '%NOT_AUTHORIZED%', 'or lift a hold');
SELECT t.reset();

ROLLBACK;
