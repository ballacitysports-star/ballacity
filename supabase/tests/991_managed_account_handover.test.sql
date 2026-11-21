-- 20261128100000_managed_account_handover (docs/managed-account-handover.md). A managed account has no sign-in of its own; when
-- its person is a known adult the managing guardian can START a handover and the adult COMPLETES it. This file checks, in order:
-- the shape (who may call what, nothing readable through the API), every refusal of a start (minor, unknown age, not the
-- managing guardian, a managed caller, the guardian's own mailbox, an account that exists, another pending handover, a bad token),
-- that a started handover changes nothing about the account, who can read it (only the managing guardian), cancel, expiry (lazy
-- and by the sweep), the claim and finish state machine (finish only after the adult's confirmed address is on the sign-in
-- record; once only; never for someone who became a minor; every effect or none), what completion does (managed row gone, link
-- ended, both sides told once, sessions and device pairing revoked, no address or token kept) and that the #452 rule and sweep
-- agree afterwards.
--
-- People: g (the managing guardian), g2 (a second guardian of the adult, not the manager), g3 (manages madb), mad (managed, 19),
-- madb (managed, 20), mkid (managed, 15), mnob (managed, no birthday), str (a stranger), existing (an account that already
-- uses existing@example.test), pre (managed, 21, a second handover), late (managed, 19, never handed over).
BEGIN;

SELECT t.person('g', 40), t.person('g2', 41), t.person('g3', 42), t.person('str', 35), t.person('existing', 30),
       t.person('mad', 19), t.person('madb', 20), t.person('mkid', 15), t.person('pre', 21), t.person('late', 19);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data)
VALUES (t.id('mnob'), 'mnob@managed.invalid', now(), jsonb_build_object('display_name', 'Mnob', 'account_type', 'player'),
        jsonb_build_object('managed', true, 'managed_by', t.id('g')));
-- The managed accounts look like production's: a placeholder address, no password, app_metadata says managed.
UPDATE auth.users SET email = 'm' || replace(id::text, '-', '') || '@managed.invalid',
       raw_app_meta_data = jsonb_build_object('managed', true, 'managed_by', t.id('g'))
 WHERE id IN (t.id('mad'), t.id('mkid'), t.id('pre'), t.id('late'), t.id('mnob'));
UPDATE auth.users SET email = 'm' || replace(id::text, '-', '') || '@managed.invalid',
       raw_app_meta_data = jsonb_build_object('managed', true, 'managed_by', t.id('g3'))
 WHERE id = t.id('madb');
-- The guardian's own address, for the "your own mailbox" refusals.
UPDATE auth.users SET email = 'Pat.Smith+family@gmail.com' WHERE id = t.id('g');
INSERT INTO public.managed_accounts (child_user_id, managed_by)
VALUES (t.id('mad'), t.id('g')), (t.id('mkid'), t.id('g')), (t.id('mnob'), t.id('g')), (t.id('pre'), t.id('g')),
       (t.id('late'), t.id('g')), (t.id('madb'), t.id('g3'));
SELECT t.guardian('g', 'mad'), t.guardian('g2', 'mad'), t.guardian('g', 'mkid'), t.guardian('g', 'mnob'), t.guardian('g', 'pre'),
       t.guardian('g', 'late'), t.guardian('g3', 'madb');
-- Live sessions the guardian opened while switched in, and a paired device.
INSERT INTO auth.sessions (id, user_id) VALUES (t.id('sess-mad'), t.id('mad')), (t.id('sess-pre'), t.id('pre'));
INSERT INTO auth.refresh_tokens (user_id, session_id, token, revoked)
VALUES (t.id('mad')::text, t.id('sess-mad'), 'rt-mad', false), (t.id('pre')::text, t.id('sess-pre'), 'rt-pre', false);
INSERT INTO public.managed_device_pairings (child_user_id, created_by, code_hash, status, expires_at)
VALUES (t.id('mad'), t.id('g'), 'code-mad', 'linked', now() + interval '1 day');

-- The audit log refuses updates; the test backdates rows to move past the daily limits (rolled back with everything else).
ALTER TABLE public.family_audit_log DISABLE TRIGGER family_audit_log_no_update;

-- A token hash is 64 hex characters (the app hashes a random token).
CREATE FUNCTION pg_temp.th(_n text) RETURNS text LANGUAGE sql AS $$ SELECT encode(sha256(convert_to('token-' || _n, 'UTF8')), 'hex') $$;
-- start for a signed-in person, the way the app's server does it (service role, with the person's id); the result's code, or the error text.
CREATE FUNCTION pg_temp.start(_who text, _child text, _email text, _tok text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_service();
  BEGIN
    r := public.start_managed_handover(t.id(_who), t.id(_child), _email, pg_temp.th(_tok));
    PERFORM t.reset();
    RETURN CASE WHEN (r ->> 'ok')::boolean THEN 'ok' ELSE r ->> 'code' END;
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN split_part(SQLERRM, ':', 1);
  END;
END $$;
CREATE FUNCTION pg_temp.cancel(_who text, _child text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r boolean;
BEGIN
  PERFORM t.as_user(t.id(_who));
  BEGIN
    r := public.cancel_managed_handover(t.id(_child));
    PERFORM t.reset();
    RETURN r::text;
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN split_part(SQLERRM, ':', 1);
  END;
END $$;
-- The service role's calls, the way the app makes them.
CREATE FUNCTION pg_temp.svc(_fn text, _tok text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_service();
  EXECUTE format('SELECT public.%I($1)', _fn) INTO r USING pg_temp.th(_tok);
  PERFORM t.reset();
  RETURN r;
END $$;
-- What the adult completing the link does to the sign-in record first (the app's Admin API call).
CREATE FUNCTION pg_temp.adult_signs_in_record(_child text, _email text) RETURNS void LANGUAGE sql AS $$
  UPDATE auth.users SET email = _email, email_confirmed_at = now(),
         raw_app_meta_data = raw_app_meta_data || jsonb_build_object('managed', false, 'managed_by', NULL)
   WHERE id = t.id(_child);
$$;
CREATE FUNCTION pg_temp.state(_child text) RETURNS text LANGUAGE sql AS $$
  SELECT concat_ws('|',
    (SELECT count(*) FROM public.managed_accounts WHERE child_user_id = t.id(_child)),
    (SELECT count(*) FROM public.guardian_links WHERE child_user_id = t.id(_child) AND status = 'active'),
    private_sec.guardian_authority_ended(t.id(_child))::text,
    (SELECT count(*) FROM private_sec.managed_handovers WHERE child_user_id = t.id(_child) AND status = 'pending'));
$$;
CREATE FUNCTION pg_temp.pending_of(_who text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(_who));
  SELECT count(*)::int INTO n FROM public.guardian_managed_handovers() WHERE pending;
  PERFORM t.reset();
  RETURN n;
END $$;

-- ---- 1. the shape: who may call what --------------------------------------------------------------------------------
SELECT t.ok(has_function_privilege('authenticated', 'public.cancel_managed_handover(uuid)', 'EXECUTE')
        AND has_function_privilege('authenticated', 'public.guardian_managed_handovers()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.cancel_managed_handover(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.guardian_managed_handovers()', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'public.cancel_managed_handover(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'public.guardian_managed_handovers()', 'EXECUTE'),
  'a signed-in guardian cancels and lists; a visitor cannot; the service role is not a guardian');
SELECT t.ok(has_function_privilege('service_role', 'public.start_managed_handover(uuid, uuid, text, text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.start_managed_handover(uuid, uuid, text, text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.start_managed_handover(uuid, uuid, text, text)', 'EXECUTE'),
  'only the app''s server starts a handover: the token is made there and never reaches the guardian''s browser');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.finish_managed_handover(text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.claim_managed_handover(text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.managed_handover_lookup(text)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.release_managed_handover(text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.finish_managed_handover(text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.claim_managed_handover(text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.managed_handover_lookup(text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.release_managed_handover(text)', 'EXECUTE'),
  'no client, signed in or not, can claim, finish, release or look up a handover by token');
SELECT t.ok(has_function_privilege('service_role', 'public.finish_managed_handover(text)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.claim_managed_handover(text)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.managed_handover_lookup(text)', 'EXECUTE')
        AND has_function_privilege('service_role', 'public.release_managed_handover(text)', 'EXECUTE'),
  'the app''s server (service role) can');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.expire_managed_handovers(uuid, integer)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'private_sec.expire_managed_handovers(uuid, integer)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'private_sec.expire_managed_handovers(uuid, integer)', 'EXECUTE'),
  'the expiry sweep is for the scheduler and a person with database access only');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid IN ('public.start_managed_handover(uuid, uuid, text, text)'::regprocedure,
                                         'public.cancel_managed_handover(uuid)'::regprocedure,
                                         'public.guardian_managed_handovers()'::regprocedure,
                                         'public.finish_managed_handover(text)'::regprocedure,
                                         'public.claim_managed_handover(text)'::regprocedure,
                                         'public.managed_handover_lookup(text)'::regprocedure,
                                         'public.release_managed_handover(text)'::regprocedure,
                                         'private_sec.expire_managed_handovers(uuid, integer)'::regprocedure)
                           AND a.grantee = 0),
  'none of the new functions is granted to PUBLIC');
SELECT t.ok((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']) FROM pg_proc p
              WHERE p.oid IN ('public.start_managed_handover(uuid, uuid, text, text)'::regprocedure,
                              'public.cancel_managed_handover(uuid)'::regprocedure,
                              'public.guardian_managed_handovers()'::regprocedure,
                              'public.finish_managed_handover(text)'::regprocedure,
                              'public.claim_managed_handover(text)'::regprocedure,
                              'public.managed_handover_lookup(text)'::regprocedure,
                              'public.release_managed_handover(text)'::regprocedure,
                              'private_sec.expire_managed_handovers(uuid, integer)'::regprocedure)),
  'all SECURITY DEFINER with search_path pinned to nothing');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private_sec.managed_handovers'::regclass)
        AND NOT has_table_privilege('authenticated', 'private_sec.managed_handovers', 'SELECT')
        AND NOT has_table_privilege('anon', 'private_sec.managed_handovers', 'SELECT')
        AND NOT has_table_privilege('service_role', 'private_sec.managed_handovers', 'SELECT'),
  'the table has row level security on and no API grant (the pending address and token hash are not readable)');

-- A client cannot call the adult''s side at all, even the managing guardian with the right token hash.
SELECT t.as_user(t.id('g'));
SELECT t.throws(format('SELECT public.finish_managed_handover(%L)', pg_temp.th('x')), 'permission denied',
  'the managing guardian cannot call finish');
SELECT t.throws(format('SELECT public.claim_managed_handover(%L)', pg_temp.th('x')), 'permission denied', 'nor claim');
-- Nor start one themselves with a token of their own choosing: that would let them follow their own link without the email.
SELECT t.throws(format('SELECT public.start_managed_handover(%L, %L, ''adult@example.test'', %L)', t.id('g'), t.id('mad'), pg_temp.th('own')),
  'permission denied', 'nor start a handover with a token of their own: only the app''s server does');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws('SELECT public.start_managed_handover(gen_random_uuid(), gen_random_uuid(), ''a@b.co'', repeat(''a'', 64))', 'permission denied',
  'a visitor cannot start one');
SELECT t.reset();

-- ---- 2. a start is refused for everyone who is not the managing guardian of a known adult ------------------------------
SELECT t.eq(pg_temp.start('g', 'mkid', 'kid@example.test', 'k'), 'HANDOVER_NOT_ADULT', 'a 15-year-old managed account: refused');
SELECT t.eq(pg_temp.start('g', 'mnob', 'nob@example.test', 'n'), 'HANDOVER_NOT_ADULT', 'an unknown age: refused (fail closed)');
SELECT t.eq(pg_temp.start('str', 'mad', 'adult@example.test', 's'), 'HANDOVER_NOT_ALLOWED', 'a stranger: refused');
SELECT t.eq(pg_temp.start('g2', 'mad', 'adult@example.test', 's'), 'HANDOVER_NOT_ALLOWED', 'a second guardian who does not manage it: refused');
SELECT t.eq(pg_temp.start('g', 'madb', 'adult@example.test', 's'), 'HANDOVER_NOT_ALLOWED', 'another guardian''s managed account: refused');
SELECT t.eq(pg_temp.start('mad', 'mad', 'adult@example.test', 's'), 'HANDOVER_NOT_ALLOWED', 'the managed account itself (a guardian switched in): refused');
SELECT t.eq(pg_temp.start('g', 'str', 'adult@example.test', 's'), 'HANDOVER_NOT_ALLOWED', 'an account that is not managed at all: refused');
SELECT t.eq(pg_temp.start('g', 'g', 'adult@example.test', 's'), 'HANDOVER_NOT_ALLOWED', 'the guardian''s own account: refused');
SELECT t.throws(format('SELECT public.start_managed_handover(NULL, %L, ''a@b.co'', %L)', t.id('mad'), pg_temp.th('s')), 'AUTH_REQUIRED',
  'no signed-in guardian: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'bad'), 'ok', 'setup: the managing guardian can start for the managed adult');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'true', 'setup: and cancel it');
-- The token hash must be a 64-character hash, never a plain token.
CREATE FUNCTION pg_temp.start_raw(_who text, _child text, _email text, _hash text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_service();
  BEGIN
    PERFORM public.start_managed_handover(t.id(_who), t.id(_child), _email, _hash);
    PERFORM t.reset();
    RETURN 'ok';
  EXCEPTION WHEN OTHERS THEN
    PERFORM t.reset();
    RETURN split_part(SQLERRM, ':', 1);
  END;
END $$;
SELECT t.eq(pg_temp.start_raw('g', 'mad', 'adult@example.test', 'short'), 'HANDOVER_FAILED', 'a token that is not a hash: refused');
SELECT t.eq(pg_temp.start_raw('g', 'mad', 'adult@example.test', upper(pg_temp.th('x'))), 'HANDOVER_FAILED', 'an upper-case token hash: refused');
-- A suspended guardian, a guardian under age review and a guardian who is not confirmed cannot hand anything over.
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('g');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'sus'), 'HANDOVER_NOT_ALLOWED', 'a suspended guardian: refused');
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('g');
UPDATE auth.users SET email_confirmed_at = NULL WHERE id = t.id('g');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'unc'), 'HANDOVER_NOT_ALLOWED', 'a guardian with no confirmed email: refused');
UPDATE auth.users SET email_confirmed_at = now() WHERE id = t.id('g');

-- The address.
SELECT t.eq(pg_temp.start('g', 'mad', 'not an email', 'e1'), 'HANDOVER_EMAIL_INVALID', 'not an address: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'a@b', 'e1'), 'HANDOVER_EMAIL_INVALID', 'no dot in the domain: refused');
SELECT t.eq(pg_temp.start('g', 'mad', '', 'e1'), 'HANDOVER_EMAIL_INVALID', 'empty: refused');
SELECT t.eq(pg_temp.start('g', 'mad', repeat('a', 250) || '@b.co', 'e1'), 'HANDOVER_EMAIL_INVALID', 'longer than an address can be: refused');
SELECT t.eq(pg_temp.start('g', 'mad', E'a\nb@x.co', 'e1'), 'HANDOVER_EMAIL_INVALID', 'a control character: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'Pat.Smith+family@gmail.com', 'e2'), 'HANDOVER_EMAIL_IS_OWN', 'the guardian''s own address: refused');
SELECT t.eq(pg_temp.start('g', 'mad', '  PAT.SMITH+family@GMAIL.com ', 'e2'), 'HANDOVER_EMAIL_IS_OWN', 'in other case and with spaces: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'patsmith@gmail.com', 'e2'), 'HANDOVER_EMAIL_IS_OWN', 'the same Gmail mailbox without the dot or the +tag: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'pat.smith+kid@googlemail.com', 'e2'), 'HANDOVER_EMAIL_IS_OWN', 'the same mailbox on googlemail.com: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'existing@example.test', 'e3'), 'HANDOVER_EMAIL_UNUSABLE', 'an address that already has an account: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'EXISTING@example.test', 'e3'), 'HANDOVER_EMAIL_UNUSABLE', 'whatever its case: refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'g2@example.test', 'e3'), 'HANDOVER_EMAIL_UNUSABLE', 'another guardian''s address (an account): refused');
SELECT t.eq(pg_temp.start('g', 'mad', 'someone@managed.invalid', 'e4'), 'HANDOVER_EMAIL_UNUSABLE', 'a managed placeholder address: refused');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|0', 'none of the refusals changed anything: managed, two links active, authority intact, nothing pending');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'managed.handover_refused' AND actor_user_id = t.id('g')), 8,
  'every refused address (four of the guardian''s own, three that exist, one placeholder) is on the audit trail: reason only, never the address');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.family_audit_log WHERE context::text ILIKE '%existing@%' OR context::text ILIKE '%smith%'),
  'and no audit row holds an address');

-- ---- 3. a started handover changes nothing about the account; only the managing guardian sees it ------------------------
-- (the refused addresses above used up some of the guardian's attempts for the day: start the real one for a different guardian
--  first, then clear the day's counters before the limit checks)
DELETE FROM public.family_audit_log WHERE action IN ('managed.handover_refused', 'managed.handover_started');
DELETE FROM public.notifications;
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'one'), 'ok', 'the managing guardian starts a handover for the known adult');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'one pending; still managed, both links active, authority intact: nothing else changed');
SELECT t.eq(private_sec.is_guardian_of(t.id('g'), t.id('mad')), true, 'the guardian is still their guardian');
SELECT t.eq(private_sec.guardian_link_in_force(t.id('mad'), 'active'), true, 'the link is in force');
SELECT t.eq((SELECT email FROM auth.users WHERE id = t.id('mad')) LIKE '%@managed.invalid', true, 'the sign-in record is untouched (still the placeholder)');
SELECT t.eq((SELECT raw_app_meta_data ->> 'managed' FROM auth.users WHERE id = t.id('mad')), 'true', 'and still says managed');
SELECT t.eq((SELECT count(*)::int FROM auth.sessions WHERE user_id = t.id('mad')), 1, 'the session the guardian opened is still there');
SELECT t.eq((SELECT status FROM public.managed_device_pairings WHERE child_user_id = t.id('mad')), 'linked', 'and the paired device');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id IN (t.id('g'), t.id('g2'), t.id('mad'))), 0, 'nobody was notified yet');
SELECT t.eq(pg_temp.start('g', 'mad', 'again@example.test', 'two'), 'HANDOVER_ALREADY_PENDING', 'a second handover for the same account: refused');
SELECT t.eq(pg_temp.start('g3', 'madb', 'adult@example.test', 'three'), 'HANDOVER_EMAIL_UNUSABLE', 'the same address for another account: refused');
SELECT t.eq((SELECT count(*)::int FROM private_sec.managed_handovers WHERE status = 'pending'), 1, 'still exactly one pending');
SELECT t.eq((SELECT email FROM private_sec.managed_handovers WHERE status = 'pending'), 'adult@example.test', 'the address is kept in lower case');
SELECT t.ok((SELECT token_hash = pg_temp.th('one') AND length(token_hash) = 64 FROM private_sec.managed_handovers WHERE status = 'pending'),
  'only the hash of the token is stored');
SELECT t.eq((SELECT context ->> 'email_domain' FROM public.family_audit_log WHERE action = 'managed.handover_started'), 'example.test',
  'the audit row names the domain, not the address');
SELECT t.ok((SELECT NOT context::text LIKE '%adult@%' FROM public.family_audit_log WHERE action = 'managed.handover_started'),
  'and no address');

-- Who can read it.
SELECT t.eq(pg_temp.pending_of('g'), 1, 'the managing guardian sees the pending handover');
SELECT t.eq(pg_temp.pending_of('g2'), 0, 'the adult''s other guardian does not');
SELECT t.eq(pg_temp.pending_of('mad'), 0, 'nor does the account itself (the guardian switched in)');
SELECT t.eq(pg_temp.pending_of('str'), 0, 'nor a stranger');
SELECT t.eq(pg_temp.pending_of('g3'), 0, 'nor another guardian');
SELECT t.as_user(t.id('g'));
SELECT t.eq((SELECT email_masked FROM public.guardian_managed_handovers() WHERE child_user_id = t.id('mad')), 'a***@example.test',
  'the guardian sees a masked address');
SELECT t.eq((SELECT is_adult FROM public.guardian_managed_handovers() WHERE child_user_id = t.id('mad')), true, 'and that the person is an adult');
SELECT t.eq((SELECT is_adult FROM public.guardian_managed_handovers() WHERE child_user_id = t.id('mkid')), false, 'a 15-year-old is not offered');
SELECT t.eq((SELECT is_adult FROM public.guardian_managed_handovers() WHERE child_user_id = t.id('mnob')), false, 'nor an unknown age');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_managed_handovers()), 5, 'the guardian lists their five managed accounts (not madb)');
SELECT t.eq(t.count('SELECT 1 FROM private_sec.managed_handovers'), 0, 'the table itself is not readable through the API');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_managed_handovers()'), 0, 'a visitor reads nothing');
SELECT t.reset();
-- The audit trail: the family sees "started" while the guardian still has authority, the account itself too.
SELECT t.as_user(t.id('g'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.family_audit_log WHERE child_user_id = %L AND action = ''managed.handover_started''', t.id('mad'))), 1,
  'the guardian reads the audit row');
SELECT t.reset();

-- The landing page read: valid for the token holder, nothing else.
SELECT t.eq((pg_temp.svc('managed_handover_lookup', 'one') ->> 'valid')::boolean, true, 'the link is valid');
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'one') ->> 'guardian_name', 'G', 'it names the adult who manages the account');
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'one') ->> 'child_name', 'Mad', 'and the account');
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'one') ->> 'email_masked', 'a***@example.test', 'and shows only a masked address');
SELECT t.ok(NOT (pg_temp.svc('managed_handover_lookup', 'one')::text LIKE '%adult@%'), 'never the address');
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'wrong') ->> 'code', 'HANDOVER_INVALID', 'a token that was never issued: invalid');

-- ---- 4. cancel ------------------------------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.cancel('g2', 'mad'), 'HANDOVER_NOT_ALLOWED', 'another guardian cannot cancel it');
SELECT t.eq(pg_temp.cancel('str', 'mad'), 'HANDOVER_NOT_ALLOWED', 'nor a stranger');
SELECT t.eq(pg_temp.cancel('mad', 'mad'), 'HANDOVER_NOT_ALLOWED', 'nor the account itself');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'and it is still pending');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'true', 'the managing guardian cancels');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|0', 'nothing pending; still managed and linked');
SELECT t.eq((SELECT status || '|' || coalesce(email, 'no-email') || '|' || coalesce(token_hash, 'no-token') FROM private_sec.managed_handovers
              WHERE child_user_id = t.id('mad') AND status = 'cancelled' ORDER BY created_at DESC LIMIT 1), 'cancelled|no-email|no-token', 'the address and the token hash are cleared');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'false', 'cancelling again is quietly nothing');
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'one') ->> 'code', 'HANDOVER_INVALID', 'the emailed link is dead');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'one') ->> 'code', 'HANDOVER_INVALID', 'it cannot be claimed');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'one') ->> 'code', 'HANDOVER_INVALID', 'or finished');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'managed.handover_cancelled'), 2, 'both cancels are on the audit trail');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'two'), 'ok', 'the address can be used again after a cancel, and a new handover starts');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'true', 'setup: cancelled again');

-- ---- 5. limits --------------------------------------------------------------------------------------------------------------
-- Three starts a day per account (the third cancel above made it three).
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'managed.handover_started' AND child_user_id = t.id('mad')), 2, 'setup: two starts today');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'three'), 'ok', 'a third start is allowed');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'true', 'setup: cancelled');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'four'), 'HANDOVER_LIMIT', 'a fourth in a day: refused');
-- Ten attempts a day per guardian, refused addresses included, so the address check cannot be used to look people up.
DELETE FROM public.family_audit_log WHERE action = 'managed.handover_started';
SELECT pg_temp.start('g', 'mad', 'existing@example.test', 'l' || i) FROM generate_series(1, 10) i;
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'managed.handover_refused' AND actor_user_id = t.id('g')), 10,
  'ten refused addresses are recorded');
SELECT t.eq(pg_temp.start('g', 'mad', 'existing@example.test', 'l11'), 'HANDOVER_LIMIT', 'the eleventh is stopped before the address is looked at');
SELECT t.eq(pg_temp.start('g', 'mad', 'fresh@example.test', 'l12'), 'HANDOVER_LIMIT', 'and so is a good one, until the day passes');
UPDATE public.family_audit_log SET created_at = now() - interval '25 hours' WHERE action IN ('managed.handover_refused', 'managed.handover_started');
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'one'), 'ok', 'a day later it works again');

-- ---- 6. expiry ---------------------------------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'setup: one pending');
SELECT t.ok((SELECT expires_at > now() + interval '6 days 23 hours' AND expires_at <= now() + interval '7 days' FROM private_sec.managed_handovers WHERE status = 'pending'),
  'it expires in seven days');
UPDATE private_sec.managed_handovers SET expires_at = now() - interval '1 minute' WHERE status = 'pending';
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'one') ->> 'code', 'HANDOVER_EXPIRED', 'an expired link says so');
SELECT t.eq(pg_temp.pending_of('g'), 0, 'the guardian no longer sees it as pending');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'one') ->> 'code', 'HANDOVER_EXPIRED', 'it cannot be claimed');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|0', 'closed as expired: still managed and linked');
SELECT t.eq((SELECT status || '|' || coalesce(email, 'no-email') || '|' || coalesce(token_hash, 'no-token') FROM private_sec.managed_handovers
              WHERE child_user_id = t.id('mad') AND status = 'expired' ORDER BY created_at LIMIT 1), 'expired|no-email|no-token', 'no address and no token kept');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g') AND title = 'Handover not finished'), 1, 'the guardian is told once');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'managed.handover_expired'), 1, 'and it is on the audit trail');
SELECT t.eq(private_sec.expire_managed_handovers(), 0, 'the sweep finds nothing more');
-- The sweep closes what nobody touched.
UPDATE public.family_audit_log SET created_at = now() - interval '25 hours' WHERE action = 'managed.handover_started';
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'sw'), 'ok', 'setup: a new one');
UPDATE private_sec.managed_handovers SET expires_at = now() - interval '1 second' WHERE status = 'pending';
SELECT t.eq(private_sec.expire_managed_handovers(), 1, 'the sweep expires it');
SELECT t.eq(private_sec.expire_managed_handovers(), 0, 'once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g') AND title = 'Handover not finished'), 2, 'the guardian was told once for each');
-- A start meets an expired one and carries on.
UPDATE public.family_audit_log SET created_at = now() - interval '25 hours' WHERE action = 'managed.handover_started';
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'fresh'), 'ok', 'setup: a handover that will expire');
UPDATE private_sec.managed_handovers SET expires_at = now() - interval '1 second' WHERE status = 'pending';
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'fresh2'), 'ok', 'a start passes an expired pending one without waiting for the sweep');
SELECT t.eq((SELECT count(*)::int FROM private_sec.managed_handovers WHERE child_user_id = t.id('mad') AND status = 'pending'), 1, 'one pending');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'true', 'setup: cancelled');
-- Being finished right now holds the sweep and the cancel off.
UPDATE public.family_audit_log SET created_at = now() - interval '25 hours' WHERE action = 'managed.handover_started';
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'busy'), 'ok', 'setup: pending');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'busy') ->> 'ok', 'true', 'the adult''s step claims it');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'HANDOVER_BUSY', 'the guardian cannot cancel under it');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'busy') ->> 'code', 'HANDOVER_BUSY', 'a second step is turned away');
UPDATE private_sec.managed_handovers SET expires_at = now() - interval '1 second' WHERE status = 'pending';
SELECT t.eq(private_sec.expire_managed_handovers(), 0, 'and the sweep leaves it alone');
SELECT t.as_service();
SELECT public.release_managed_handover(pg_temp.th('busy'));
SELECT t.reset();
SELECT t.ok((SELECT claimed_at IS NULL FROM private_sec.managed_handovers WHERE status = 'pending'), 'releasing gives it back');
UPDATE private_sec.managed_handovers SET expires_at = now() + interval '1 day' WHERE status = 'pending';
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'true', 'setup: cancelled');
SELECT t.eq(pg_temp.pending_of('g'), 0, 'nothing pending');

-- ---- 7. finish: only by completion -------------------------------------------------------------------------------------------
UPDATE public.family_audit_log SET created_at = now() - interval '25 hours' WHERE action = 'managed.handover_started';
SELECT t.eq(pg_temp.start('g', 'mad', 'adult@example.test', 'fin'), 'ok', 'setup: a pending handover');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_FAILED', 'finish before the step was claimed: refused');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'and nothing changed');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'fin') ->> 'ok', 'true', 'claimed');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'fin') ->> 'code', 'HANDOVER_BUSY', 'claimed once at a time');
-- The sign-in record has not been changed yet: finishing must refuse (a request that skipped the adult's step).
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_FAILED', 'the sign-in record still has the placeholder address: refused');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'and nothing changed');
-- Their address on the record, but not confirmed.
UPDATE auth.users SET email = 'adult@example.test', email_confirmed_at = NULL,
       raw_app_meta_data = raw_app_meta_data || '{"managed": false}' WHERE id = t.id('mad');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_FAILED', 'the address is not confirmed: refused');
-- Confirmed, but still flagged managed.
UPDATE auth.users SET email_confirmed_at = now(), raw_app_meta_data = raw_app_meta_data || '{"managed": true}' WHERE id = t.id('mad');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_FAILED', 'still marked managed on the sign-in record: refused');
-- Confirmed, not managed, but a different address from the one the guardian gave.
UPDATE auth.users SET email = 'someone.else@example.test', raw_app_meta_data = raw_app_meta_data || '{"managed": false}' WHERE id = t.id('mad');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_FAILED', 'a different address from the guardian''s: refused');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'every refusal left the account managed and linked');
SELECT t.eq((SELECT count(*)::int FROM auth.sessions WHERE user_id = t.id('mad')), 1, 'and its session');
-- The lease: a claim that ran out of time cannot finish.
SELECT pg_temp.adult_signs_in_record('mad', 'adult@example.test');
UPDATE private_sec.managed_handovers SET claimed_at = now() - interval '3 minutes' WHERE status = 'pending';
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_FAILED', 'a claim older than two minutes cannot finish');
UPDATE private_sec.managed_handovers SET claimed_at = now() WHERE status = 'pending';
-- Fail closed: if anything inside finish fails, nothing it did is kept.
CREATE FUNCTION pg_temp.boom() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.title = 'This account is yours' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$;
CREATE TRIGGER trg_boom BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION pg_temp.boom();
SELECT t.throws(format('SELECT public.finish_managed_handover(%L)', pg_temp.th('fin')), 'boom', 'a failure inside finish raises');
DROP TRIGGER trg_boom ON public.notifications;
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'and the account is still managed, both links active, the handover pending');
SELECT t.eq((SELECT count(*)::int FROM auth.sessions WHERE user_id = t.id('mad')), 1, 'the session was not removed');
SELECT t.eq((SELECT status FROM public.managed_device_pairings WHERE child_user_id = t.id('mad')), 'linked', 'nor the device pairing revoked');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'guardian_link' AND title IN ('Account handed over', 'This account is yours')), 0,
  'nor anyone told');

-- Before finishing: the person must still be a known adult. A support-approved correction that makes them a minor stops it.
CREATE FUNCTION pg_temp.correct(_who text, _bd date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('openrun.birthday_review', 'on', true);
  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (t.id(_who), _bd)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();
  PERFORM set_config('openrun.birthday_review', 'off', true);
END $$;
SELECT pg_temp.correct('mad', (current_date - interval '16 years')::date);
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_INVALID', 'corrected to 16 before the adult finished: refused');
SELECT t.eq(pg_temp.state('mad'), '1|2|false|1', 'still managed and linked');
SELECT pg_temp.correct('mad', (current_date - interval '19 years')::date);
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'ok', 'true', 'back to 19: finish succeeds');

-- ---- 8. what completion does -------------------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.state('mad'), '0|0|true|0', 'not managed, no active link, no guardian has authority, nothing pending');
SELECT t.eq(private_sec.is_guardian_of(t.id('g'), t.id('mad')), false, 'the managing guardian is no longer their guardian');
SELECT t.eq(private_sec.is_guardian_of(t.id('g2'), t.id('mad')), false, 'nor the other guardian');
SELECT t.eq((SELECT status FROM public.guardian_links WHERE parent_user_id = t.id('g') AND child_user_id = t.id('mad')), 'revoked', 'the link is ended');
SELECT t.eq((SELECT status FROM public.guardian_links WHERE parent_user_id = t.id('g2') AND child_user_id = t.id('mad')), 'revoked', 'both links');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE child_user_id = t.id('mad') AND kind = 'ended'), 2,
  'recorded like the 18 sweep records them (a birthday correction can bring them back)');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE child_user_id = t.id('mad') AND action = 'link.revoked'), 2,
  'the existing trigger wrote the family audit row for each link');
SELECT t.eq((SELECT count(*)::int FROM auth.sessions WHERE user_id = t.id('mad')), 0, 'every session is gone');
SELECT t.eq((SELECT count(*)::int FROM auth.refresh_tokens WHERE user_id = t.id('mad')::text), 0, 'and every refresh token');
SELECT t.eq((SELECT status FROM public.managed_device_pairings WHERE child_user_id = t.id('mad')), 'revoked', 'the paired device is revoked');
SELECT t.eq((SELECT count(*)::int FROM auth.sessions WHERE user_id = t.id('pre')), 1, 'another account''s sessions are untouched');
SELECT t.eq((SELECT status || '|' || coalesce(email, 'no-email') || '|' || coalesce(token_hash, 'no-token') FROM private_sec.managed_handovers
              WHERE child_user_id = t.id('mad') AND status = 'completed'), 'completed|no-email|no-token', 'the handover keeps no address and no token');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE action = 'managed.handover_completed' AND child_user_id = t.id('mad')), 1, 'the audit trail has the completion');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g') AND title = 'Account handed over'), 1, 'the managing guardian is told once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g2') AND title = 'Account handed over'), 1, 'the other guardian once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('mad') AND title = 'This account is yours'), 1, 'the new adult once');
SELECT t.ok((SELECT bool_and(body NOT ILIKE '%law%' AND body NOT ILIKE '%legal%' AND body NOT ILIKE '%consent%') FROM public.notifications WHERE title IN ('Account handed over', 'This account is yours')),
  'the wording makes no legal claim');
SELECT t.eq(pg_temp.pending_of('g'), 0, 'no pending handover');
SELECT t.as_user(t.id('g'));
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview() WHERE child_user_id = t.id('mad')), 0, 'the Parent Center no longer lists them');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_managed_handovers() WHERE child_user_id = t.id('mad')), 0, 'nor the handover list');
SELECT t.eq(t.count(format('SELECT 1 FROM public.child_controls WHERE child_user_id = %L', t.id('mad'))), 0, 'the guardian reads none of their controls');
SELECT t.eq(t.count(format('SELECT 1 FROM public.family_audit_log WHERE child_user_id = %L', t.id('mad'))), 0, 'nor their family activity');
SELECT t.reset();
SELECT t.as_user(t.id('mad'));
SELECT t.eq(public.my_guardian_link_in_force(), false, 'the account has no guardian link in force');
SELECT t.eq(t.count(format('SELECT 1 FROM public.family_audit_log WHERE child_user_id = %L AND action = ''managed.handover_completed''', t.id('mad'))), 1,
  'but reads its own audit row');
SELECT t.reset();
-- Nothing else of the account was touched: consent record, controls, legal acceptances, profile.
SELECT t.eq((SELECT count(*)::int FROM public.child_controls WHERE child_user_id = t.id('mad')), 1, 'the controls row is kept as history');
SELECT t.eq((SELECT display_name FROM public.profiles WHERE id = t.id('mad')), 'Mad', 'the profile is as it was');
-- Once only.
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'fin') ->> 'code', 'HANDOVER_INVALID', 'finishing again: the link is dead');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'fin') ->> 'code', 'HANDOVER_INVALID', 'so is claiming');
SELECT t.eq(pg_temp.svc('managed_handover_lookup', 'fin') ->> 'code', 'HANDOVER_INVALID', 'and the landing read');
SELECT t.eq(pg_temp.start('g', 'mad', 'x@example.test', 'after'), 'HANDOVER_NOT_ALLOWED', 'the guardian cannot start another: they do not manage it');
SELECT t.eq(pg_temp.cancel('g', 'mad'), 'HANDOVER_NOT_ALLOWED', 'or cancel');
-- The 18 sweep and rule agree: nothing more to end, nobody told twice.
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'ended')::int, 0, 'the daily sweep has nothing to end');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g') AND title IN ('Family link ended', 'A managed account has turned 18')
              AND body LIKE 'Mad%'), 0, 'and does not tell the guardian again');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('mad') AND title = 'Your family link has ended'), 0, 'nor the adult');
-- A support-approved correction that makes the person a minor again puts the links back (a non-managed minor with a sign-in of their own).
SELECT pg_temp.correct('mad', (current_date - interval '16 years')::date);
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE child_user_id = t.id('mad') AND status = 'active'), 2,
  'corrected to 16 afterwards: both links are back (fail closed for a minor)');
SELECT t.eq(private_sec.is_guardian_of(t.id('g'), t.id('mad')), true, 'the guardian is their guardian again');
SELECT t.eq((SELECT count(*)::int FROM public.managed_accounts WHERE child_user_id = t.id('mad')), 0, 'but the account is not managed: it keeps its own sign-in');

-- ---- 9. another account in the same run: the guardian's other managed accounts are untouched ---------------------------------
SELECT t.eq(pg_temp.state('pre'), '1|1|false|0', 'an account that was never handed over is as it was');
SELECT t.eq(pg_temp.state('mkid'), '1|1|false|0', 'so is the 15-year-old');
SELECT t.eq(private_sec.guardian_authority_ended(t.id('pre')), false, 'a managed adult nobody handed over still keeps its guardian (nothing strands)');
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'managed_waiting')::int, 3, 'the 18 sweep still reports the managed adults waiting (pre, late, madb)');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE child_user_id IN (t.id('pre'), t.id('madb'), t.id('late')) AND status = 'active'), 3,
  'and never ends their links');

-- ---- 10. a second, independent handover: pre completes with a plain run ----------------------------------------------------
SELECT t.eq(pg_temp.start('g', 'pre', 'pre.adult@example.test', 'pre'), 'ok', 'a second account''s handover starts');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'pre') ->> 'email', 'pre.adult@example.test', 'the claim returns the address to put on the sign-in record');
-- An account takes the address in the meantime: the claim is refused (the adult's step cannot take someone else's address).
SELECT t.as_service();
SELECT public.release_managed_handover(pg_temp.th('pre'));
SELECT t.reset();
INSERT INTO auth.users (id, email, email_confirmed_at) VALUES (t.id('squatter'), 'pre.adult@example.test', now());
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'pre') ->> 'code', 'HANDOVER_EMAIL_UNUSABLE', 'an address taken after the start: refused at the claim');
SELECT t.eq(pg_temp.state('pre'), '1|1|false|1', 'and the account is as it was');
DELETE FROM auth.users WHERE id = t.id('squatter');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'pre') ->> 'ok', 'true', 'free again: the claim succeeds');
SELECT pg_temp.adult_signs_in_record('pre', 'pre.adult@example.test');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'pre') ->> 'ok', 'true', 'finished');
SELECT t.eq(pg_temp.state('pre'), '0|0|true|0', 'a plain account now');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g') AND title = 'Account handed over' AND body LIKE 'Pre%'), 1,
  'the guardian was told once for this account too');
SELECT t.eq((SELECT count(*)::int FROM auth.sessions WHERE user_id = t.id('pre')), 0, 'its session is gone');

-- A guardian whose link row was already gone is still told once.
SELECT t.eq(pg_temp.start('g3', 'madb', 'madb.adult@example.test', 'madb'), 'ok', 'setup: another guardian''s account');
DELETE FROM public.guardian_links WHERE child_user_id = t.id('madb');
SELECT t.eq(pg_temp.svc('claim_managed_handover', 'madb') ->> 'ok', 'true', 'claimed');
SELECT pg_temp.adult_signs_in_record('madb', 'madb.adult@example.test');
SELECT t.eq(pg_temp.svc('finish_managed_handover', 'madb') ->> 'ok', 'true', 'finished without a link row');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('g3') AND title = 'Account handed over'), 1, 'the managing guardian is still told once');

-- ---- 11. the mailbox rule ---------------------------------------------------------------------------------------------------------
SELECT t.eq(private_sec.handover_mailbox_key('Pat.Smith+x@Gmail.com'), 'patsmith@gmail.com', 'Gmail: no dots, no +tag, lower case');
SELECT t.eq(private_sec.handover_mailbox_key('pat.smith@googlemail.com'), 'patsmith@gmail.com', 'googlemail is gmail');
SELECT t.eq(private_sec.handover_mailbox_key('Pat.Smith+x@example.test'), 'pat.smith@example.test', 'elsewhere: dots kept, +tag dropped');
SELECT t.eq(private_sec.handover_mask_email('adult@example.test'), 'a***@example.test', 'the mask shows one letter');

ROLLBACK;
