-- 20261125200000_guardian_links_end_at_18 (owner decision 2026-11-20: a guardian link ends when the child turns 18).
-- docs/guardian-link-age-18.md has the scope. This file checks, in order: the shape (who may call what), the rule at the
-- exact birthday and the day before, that every reader agrees with it BEFORE the sweep has run, what the guardian can
-- still see or do (nothing), the pay gates for a player who just turned 18, the sweep (idempotent, capped, notices once
-- per side, never touches a minor, an unknown age or a managed account) and that the readers do not change when it runs.
--
-- People: teen (16, guarded), dayb (17 years 364 days: the day before 18), turned (18 today), older (25), twoga (20, two
-- guardians), nobday (no birthday), mgd (20, a managed account), stale (19 with a cohort that never aged: under 13, the
-- game switch left off), staleteen (19, cohort teen_16_17, every guardian switch left restrictive), hand (19, a link a
-- guardian ended by hand), splita (21, two guardians, for the capped sweep). ga and gb are the guardians. The managed
-- adult mgd also carries a stale teen cohort, so the guardian's switches must still bind it (the guardian is its only way in).
BEGIN;

SELECT t.person('host', 40), t.person('ga', 41), t.person('gb', 42), t.person('teen', 16), t.person('older', 25),
       t.person('twoga', 20), t.person('mgd', 20), t.person('stale', 19), t.person('staleteen', 19);
-- A birthday on the exact date: 18 years ago today, and a day later.
CREATE FUNCTION pg_temp.person_bd(h text, bd date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (t.id(h), h || '@example.test', now(), jsonb_build_object('display_name', initcap(h), 'account_type', 'player'));
  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (t.id(h), bd);
END $$;
SELECT pg_temp.person_bd('turned', (current_date - interval '18 years')::date);
SELECT pg_temp.person_bd('dayb', (current_date - interval '18 years' + interval '1 day')::date);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobday'), 'nobday@example.test', now(), jsonb_build_object('display_name', 'Nobday', 'account_type', 'player'));

-- A cohort that never aged (it is set when a birthday is saved, and nothing moves it on).
UPDATE public.profiles SET age_cohort = 'child_under_13' WHERE id = t.id('stale');
UPDATE public.profiles SET age_cohort = 'teen_16_17' WHERE id = t.id('staleteen');

SELECT t.guardian('ga', 'teen'), t.guardian('ga', 'dayb'), t.guardian('ga', 'turned'), t.guardian('ga', 'older'),
       t.guardian('ga', 'twoga'), t.guardian('gb', 'twoga'), t.guardian('ga', 'nobday'), t.guardian('ga', 'mgd'),
       t.guardian('ga', 'stale'), t.guardian('ga', 'staleteen');
INSERT INTO public.managed_accounts (child_user_id, managed_by) VALUES (t.id('mgd'), t.id('ga'));
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('stale');
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('staleteen');
-- Every other guardian switch, left restrictive, for the stale-cohort adult, the managed adult and a real 16-year-old.
UPDATE public.profiles SET age_cohort = 'teen_16_17' WHERE id = t.id('mgd');
UPDATE public.child_controls SET ai_analysis = false, public_xp = true, notifications = false, messaging = 'off'
 WHERE child_user_id IN (t.id('staleteen'), t.id('mgd'), t.id('teen'));
-- A consent record for an adult (an old approval) and for the 17-year-old.
INSERT INTO public.parental_consents (child_user_id, parent_user_id, status, method, approved_at, requested_at)
VALUES (t.id('turned'), t.id('ga'), 'approved', 'email_confirmation', now(), now()),
       (t.id('dayb'), t.id('ga'), 'approved', 'email_confirmation', now(), now());

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('pg', t.id('host'), 'Paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('pg', t.id('host'), 10, false);
-- Requests the guardian approved before the child turned 18 (stamped as the server would), and one for the 17-year-old.
SELECT t.as_user(t.id('turned'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
VALUES (t.id('req-turned'), 'pg', t.id('turned'), t.id('host'), 'k-turned');
SELECT t.as_user(t.id('dayb'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
VALUES (t.id('req-dayb'), 'pg', t.id('dayb'), t.id('host'), 'k-dayb');
SELECT t.reset();
UPDATE public.join_requests SET guardian_approved_at = now(), guardian_approved_by = t.id('ga')
 WHERE id = t.id('req-turned');
SELECT t.team('squad', 'host');
SELECT t.member('squad', 'staleteen');
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('staleteen');

CREATE FUNCTION pg_temp.as_ready(_who text, _game text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r boolean;
BEGIN PERFORM t.as_user(t.id(_who)); r := public.game_payment_guardian_ready(_game); PERFORM t.reset(); RETURN r; END $$;
CREATE FUNCTION pg_temp.as_manual(_who text, _game text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r boolean;
BEGIN PERFORM t.as_user(t.id(_who)); r := public.game_manual_claim_guardian_ready(_game); PERFORM t.reset(); RETURN r; END $$;
-- PayPal's own check: does its precondition stop on the guardian rule?
CREATE FUNCTION pg_temp.paypal_guardian_stops(_who text, _game text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN PERFORM t.as_user(t.id(_who)); r := public.paypal_payment_precondition(_game); PERFORM t.reset();
  RETURN COALESCE(r, '') = 'GUARDIAN_APPROVAL_REQUIRED'; END $$;
CREATE FUNCTION pg_temp.claim(_who text, _game text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  PERFORM t.as_user(t.id(_who));
  BEGIN
    EXECUTE format('INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, notes) '
                   'VALUES (%L, %L, %L, ''venmo'', ''Sent on Venmo'')', _game, t.id('host'), t.id(_who));
    RAISE EXCEPTION 'CLAIM_RECORDED';
  EXCEPTION WHEN OTHERS THEN
    c := NULLIF(split_part(SQLERRM, ':', 1), 'CLAIM_RECORDED');
  END;
  PERFORM t.reset();
  RETURN c;
END $$;
-- Everything a reader says about one person, as one string: compared before and after the sweep.
CREATE FUNCTION pg_temp.readers(_who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  s := concat_ws('|',
    private_sec.is_guardian_of(t.id('ga'), t.id(_who)), private_sec.is_guardian_of(t.id('gb'), t.id(_who)),
    public.is_guardian_of(t.id('ga'), t.id(_who)),
    private_sec.guardian_payment_approval_missing(t.id(_who), 'pg'),
    private_sec.child_game_participation_allowed(t.id(_who)),
    private_sec.guardian_authority_ended(t.id(_who)),
    pg_temp.as_ready(_who, 'pg'), pg_temp.as_manual(_who, 'pg'), pg_temp.paypal_guardian_stops(_who, 'pg'),
    private_sec.ai_analysis_allowed(t.id(_who)), public.minor_messaging_block(t.id(_who), t.id('host')),
    public.minor_messaging_block(t.id('host'), t.id(_who)), public.public_xp_enabled(t.id(_who)),
    private_sec.guardian_switches_apply(t.id(_who)), public.guardian_authority_has_ended(t.id(_who)));
  PERFORM t.as_user(t.id(_who));
  s := s || '|' || public.my_guardian_link_in_force();
  PERFORM t.reset();
  RETURN s;
END $$;

-- ---- 1. the shape: who may call what ----------------------------------------------------------------------------
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.is_known_adult(uuid)', 'EXECUTE'),
  'the adult check is not callable through the API');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.guardian_link_in_force(uuid, text)', 'EXECUTE'),
  'nor is the link rule');
SELECT t.ok(has_function_privilege('authenticated', 'private_sec.guardian_authority_ended(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'private_sec.guardian_authority_ended(uuid)', 'EXECUTE'),
  'the consent policy can call guardian_authority_ended as a signed-in user; a visitor cannot');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.end_adult_guardian_links(integer)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'private_sec.end_adult_guardian_links(integer)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'private_sec.end_adult_guardian_links(integer)', 'EXECUTE'),
  'the sweep is for the scheduler and a person with database access only');
SELECT t.ok(has_function_privilege('service_role', 'public.guardian_links_in_force(uuid[])', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.guardian_links_in_force(uuid[])', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.guardian_links_in_force(uuid[])', 'EXECUTE'),
  'the server-side list is for the service role only');
SELECT t.ok(has_function_privilege('authenticated', 'public.my_guardian_link_in_force()', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.my_guardian_link_in_force()', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'public.my_guardian_link_in_force()', 'EXECUTE'),
  'a signed-in user can ask about themself; a visitor and the service role cannot');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid IN ('public.guardian_links_in_force(uuid[])'::regprocedure,
                                         'public.my_guardian_link_in_force()'::regprocedure,
                                         'private_sec.end_adult_guardian_links(integer)'::regprocedure,
                                         'private_sec.is_known_adult(uuid)'::regprocedure,
                                         'private_sec.guardian_authority_ended(uuid)'::regprocedure,
                                         'private_sec.guardian_link_in_force(uuid, text)'::regprocedure)
                           AND a.grantee = 0),
  'none of the new functions is granted to PUBLIC');
SELECT t.ok((SELECT bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']) FROM pg_proc p
              WHERE p.oid IN ('public.guardian_links_in_force(uuid[])'::regprocedure,
                              'public.my_guardian_link_in_force()'::regprocedure,
                              'private_sec.end_adult_guardian_links(integer)'::regprocedure,
                              'private_sec.is_known_adult(uuid)'::regprocedure,
                              'private_sec.guardian_authority_ended(uuid)'::regprocedure,
                              'private_sec.guardian_link_in_force(uuid, text)'::regprocedure)),
  'all SECURITY DEFINER with search_path pinned to nothing');
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private_sec.guardian_link_age_events'::regclass)
        AND NOT has_table_privilege('authenticated', 'private_sec.guardian_link_age_events', 'SELECT')
        AND NOT has_table_privilege('anon', 'private_sec.guardian_link_age_events', 'SELECT')
        AND NOT has_table_privilege('service_role', 'private_sec.guardian_link_age_events', 'SELECT'),
  'the record of ended links has row level security on and no API grant');

-- ---- 2. the rule: the exact birthday and the day before --------------------------------------------------------
SELECT t.eq(private_sec.is_known_adult(t.id('turned')), true, 'on the 18th birthday: a known adult');
SELECT t.eq(private_sec.is_known_adult(t.id('dayb')), false, 'the day before (17 years 364 days): not');
SELECT t.eq(private_sec.is_known_adult(t.id('teen')), false, 'a 16-year-old: not');
SELECT t.eq(private_sec.is_known_adult(t.id('older')), true, 'a 25-year-old: yes');
SELECT t.eq(private_sec.is_known_adult(t.id('nobday')), false, 'no birthday on file: not an adult (fail closed)');
SELECT t.eq(private_sec.is_known_adult(gen_random_uuid()), false, 'nobody at all: not an adult');
SELECT t.eq(private_sec.guardian_authority_ended(t.id('mgd')), false, 'a managed adult: the guardian keeps authority (owner decision)');
SELECT t.eq(private_sec.guardian_authority_ended(t.id('turned')), true, 'an unmanaged adult: authority ended');
SELECT t.eq(private_sec.guardian_link_in_force(t.id('turned'), 'active'), false, 'an active link to an 18-year-old is not in force');
SELECT t.eq(private_sec.guardian_link_in_force(t.id('dayb'), 'active'), true, 'an active link to a 17-year-old is');
SELECT t.eq(private_sec.guardian_link_in_force(t.id('dayb'), 'revoked'), false, 'a revoked link never is');
SELECT t.eq(private_sec.guardian_link_in_force(t.id('mgd'), 'active'), true, 'an active link to a managed adult is');
-- The same computation as is_minor and as the pay RPC's exemption: they never disagree for a known birthday.
SELECT t.ok(private_sec.is_known_adult(t.id(h)) = NOT private_sec.is_minor(t.id(h)), 'is_known_adult is the opposite of is_minor: ' || h)
  FROM unnest(ARRAY['teen', 'dayb', 'turned', 'older', 'twoga', 'mgd', 'stale', 'staleteen']) h;

-- ---- 3. before the sweep has run: every link is still 'active', and the readers already agree ---------------------
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE status = 'active'), 10, 'setup: ten links, all active');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('turned')), false, 'the guardian of an 18-year-old is not their guardian');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('older')), false, 'nor of a 25-year-old');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('dayb')), true, 'still the guardian of the 17-year-old');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('teen')), true, 'and of the 16-year-old');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('nobday')), true, 'unknown age: the link stays');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('mgd')), true, 'a managed account: the link stays');
SELECT t.eq(public.is_guardian_of(t.id('ga'), t.id('turned')), false, 'the public wrapper says the same');

-- Parent Center: only the children the guardian still has.
SELECT t.as_user(t.id('ga'));
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview()), 4,
  'the Parent Center lists the 16-year-old, the 17-year-old, the unknown age and the managed account');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview() WHERE child_user_id = t.id('turned')), 0,
  'not the 18-year-old (even before the sweep)');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview() WHERE child_user_id IN (t.id('mgd'), t.id('nobday'))), 2,
  'the managed account and the unknown age stay listed');
-- What the guardian can read through the family policies.
SELECT t.eq(t.count(format('SELECT 1 FROM public.child_controls WHERE child_user_id = %L', t.id('turned'))), 0,
  'the 18-year-old''s controls are not readable');
SELECT t.eq(t.count(format('SELECT 1 FROM public.child_controls WHERE child_user_id = %L', t.id('dayb'))), 1,
  'the 17-year-old''s are');
SELECT t.eq(t.count(format('SELECT 1 FROM public.join_requests WHERE player_id = %L', t.id('turned'))), 0,
  'the 18-year-old''s join requests are not readable');
SELECT t.eq(t.count(format('SELECT 1 FROM public.join_requests WHERE player_id = %L', t.id('dayb'))), 1, 'the 17-year-old''s are');
SELECT t.eq(t.count(format('SELECT 1 FROM public.family_audit_log WHERE child_user_id = %L', t.id('turned'))), 0,
  'the 18-year-old''s family activity log is not readable');
SELECT t.eq(t.count(format('SELECT 1 FROM public.parental_consents WHERE child_user_id = %L', t.id('turned'))), 0,
  'the consent record of the 18-year-old is no longer readable by the guardian who held it');
SELECT t.eq(t.count(format('SELECT 1 FROM public.parental_consents WHERE child_user_id = %L', t.id('dayb'))), 1,
  'the 17-year-old''s is');
SELECT t.throws(format('SELECT public.set_child_controls(%L, ''{"game_participation": false}'')', t.id('turned')), 'NOT_AUTHORIZED',
  'the guardian cannot change the 18-year-old''s controls');
SELECT t.throws(format('SELECT public.revoke_parental_consent(%L, ''x'')', t.id('turned')), 'NOT_AUTHORIZED',
  'nor withdraw their consent');
SELECT t.throws(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-turned')), 'NOT_GUARDIAN',
  'nor answer their join request');
SELECT t.throws(format('SELECT public.guardian_cancel_child_game(%L, ''pg'')', t.id('turned')), 'linked to your account',
  'nor cancel their game');
SELECT t.lives(format('SELECT public.set_child_controls(%L, ''{"game_participation": true}'')', t.id('dayb')),
  'the 17-year-old''s controls are still the guardian''s');
SELECT t.reset();
-- The adult still reads their own consent record and link.
SELECT t.as_user(t.id('turned'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.parental_consents WHERE child_user_id = %L', t.id('turned'))), 1,
  'the adult still reads their own consent record');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_links'), 1, 'and their own link row');
SELECT t.reset();
-- Notices to the guardian about the child: none for an adult, still for a minor.
DELETE FROM public.notifications;
SELECT public.notify_guardians(t.id('turned'), 'x', 'x', 'x', '/x');
SELECT public.notify_guardians(t.id('dayb'), 'x', 'x', 'x', '/x');
SELECT public.notify_guardians_of(t.id('turned'), 'y', 'y', 'y', '/y');
SELECT public.notify_guardians_of(t.id('dayb'), 'y', 'y', 'y', '/y');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND type IN ('x', 'y')), 2,
  'the guardian is told about the 17-year-old (twice) and not about the 18-year-old');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND link = '/x'), 1, 'notify_guardians: one, for the minor');
SELECT public.notify_guardians_of(t.id('mgd'), 'z', 'z', 'z', '/z');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND type = 'z'), 1,
  'the managing guardian is still told about the managed account');
DELETE FROM public.notifications;

-- The adult is not held by a switch the guardian left off, nor by a teen's chat rule.
SELECT t.eq(private_sec.child_game_participation_allowed(t.id('stale')), true,
  'game participation: an adult with a cohort that never aged and the switch left off is allowed');
SELECT t.eq(private_sec.child_game_participation_allowed(t.id('turned')), true, 'an adult is allowed');
SELECT t.eq(private_sec.team_chat_member('squad', t.id('staleteen')), true,
  'team chat: an adult with a teen cohort is a member like any adult');
UPDATE public.child_controls SET messaging = 'off' WHERE child_user_id = t.id('staleteen');
SELECT t.eq(private_sec.team_chat_member('squad', t.id('staleteen')), true,
  'whatever the messaging switch says (it was the guardian''s)');

-- Every other switch a guardian sets in child_controls binds only while a guardian has authority. The stored cohort of
-- 'staleteen' never aged (still teen_16_17), every switch is left restrictive, and nobody can change them any more.
SELECT t.eq(private_sec.guardian_switches_apply(t.id('staleteen')), false, 'the switches no longer bind the adult with a stale teen cohort');
SELECT t.eq(private_sec.guardian_switches_apply(t.id('teen')), true, '... they still bind a 16-year-old');
SELECT t.eq(private_sec.guardian_switches_apply(t.id('mgd')), true, '... and a managed adult (the guardian is the only way in)');
SELECT t.eq(private_sec.guardian_switches_apply(t.id('nobday')), false, '... unknown age: the cohort is not a minor one, as before');
-- Everyone tries to turn their own AI setting on (the sign-up default for a minor is off).
UPDATE public.privacy_preferences SET ai_processing = true WHERE user_id IN (t.id('staleteen'), t.id('teen'), t.id('mgd'));
SELECT t.eq(private_sec.ai_analysis_allowed(t.id('staleteen')), true, 'AI: the adult''s own setting decides (the guardian''s "off" does not hold them)');
SELECT t.eq(private_sec.ai_analysis_allowed(t.id('teen')), false, 'AI: a 16-year-old with the guardian''s switch off is still blocked');
SELECT t.eq(private_sec.ai_analysis_allowed(t.id('mgd')), false, 'AI: a managed adult is still held by the guardian''s switch');
SELECT t.eq(public.minor_messaging_block(t.id('staleteen'), t.id('host')), NULL::text, 'messaging: the adult can write to anyone');
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('staleteen')), NULL::text, 'messaging: and anyone can write to the adult');
SELECT t.eq(public.minor_messaging_block(t.id('teen'), t.id('host')), 'messaging_off:self', 'messaging: a 16-year-old with messaging off is still blocked');
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('teen')), 'messaging_off:other', '... from either side');
SELECT t.eq(public.minor_messaging_block(t.id('mgd'), t.id('host')), 'messaging_off:self', 'messaging: a managed adult is still held');
SELECT t.eq(public.public_xp_enabled(t.id('staleteen')), false, 'public XP: the guardian''s opt-in does not apply to an adult');
SELECT t.eq(public.public_xp_enabled(t.id('teen')), true, 'public XP: a 16-year-old''s opt-in still applies');
SELECT t.eq(public.public_xp_enabled(t.id('mgd')), true, 'public XP: the managed adult''s opt-in still applies');
-- The AI clamp on the adult's own privacy settings (set above).
SELECT t.eq((SELECT ai_processing FROM public.privacy_preferences WHERE user_id = t.id('staleteen')), true,
  'the AI clamp leaves the adult''s own choice alone');
SELECT t.eq((SELECT ai_processing FROM public.privacy_preferences WHERE user_id = t.id('teen')), false,
  'and still clamps the 16-year-old (guardian switch off)');
SELECT t.eq((SELECT ai_processing FROM public.privacy_preferences WHERE user_id = t.id('mgd')), false, 'and the managed adult');
-- Server code (the push curfew): the same answer, for the service role only.
SELECT t.eq(public.guardian_authority_has_ended(t.id('staleteen')), true, 'authority has ended: the adult with a stale cohort');
SELECT t.eq(public.guardian_authority_has_ended(t.id('turned')), true, '... an 18-year-old');
SELECT t.eq(public.guardian_authority_has_ended(t.id('teen')), false, '... not a 16-year-old');
SELECT t.eq(public.guardian_authority_has_ended(t.id('dayb')), false, '... not the day before 18');
SELECT t.eq(public.guardian_authority_has_ended(t.id('mgd')), false, '... not a managed adult');
SELECT t.eq(public.guardian_authority_has_ended(t.id('nobday')), false, '... not an unknown age');
SELECT t.ok(has_function_privilege('service_role', 'public.guardian_authority_has_ended(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('authenticated', 'public.guardian_authority_has_ended(uuid)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.guardian_authority_has_ended(uuid)', 'EXECUTE'),
  'guardian_authority_has_ended is for the service role only');

-- ---- 4. paying: a player who turned 18, with the link still 'active' ------------------------------------------------
SELECT t.eq(pg_temp.as_ready('turned', 'pg'), true, 'PayPal''s check: ready');
SELECT t.eq(pg_temp.as_manual('turned', 'pg'), true, 'the manual-claim check: ready (it said no before the link ended at 18)');
SELECT t.eq(pg_temp.paypal_guardian_stops('turned', 'pg'), false, 'the PayPal precondition does not stop on the guardian rule');
SELECT t.eq(pg_temp.claim('turned', 'pg'), NULL::text, 'and the trigger records their Venmo claim');
SELECT t.eq(pg_temp.as_ready('older', 'pg'), true, 'a 25-year-old with an old link: ready');
SELECT t.eq(pg_temp.as_manual('older', 'pg'), true, 'manual: ready');
SELECT t.eq(pg_temp.claim('older', 'pg'), NULL::text, 'claim recorded');
SELECT t.eq(pg_temp.as_manual('dayb', 'pg'), false, 'the day before 18: the guardian still has to approve (manual)');
SELECT t.eq(pg_temp.as_ready('dayb', 'pg'), false, '(PayPal)');
SELECT t.eq(pg_temp.paypal_guardian_stops('dayb', 'pg'), true, '(the PayPal precondition)');
SELECT t.eq(pg_temp.claim('dayb', 'pg'), 'GUARDIAN_APPROVAL_REQUIRED', 'and the trigger refuses their claim');
SELECT t.eq(pg_temp.as_manual('teen', 'pg'), false, 'a 16-year-old without approval: no');
SELECT t.eq(pg_temp.as_manual('nobday', 'pg'), false, 'an unknown age with a link: no');
SELECT t.eq(pg_temp.as_manual('mgd', 'pg'), false, 'a managed adult: the guardian''s approval is still needed (manual)');
SELECT t.eq(pg_temp.as_ready('mgd', 'pg'), true, '(PayPal exempts a known adult, as it always did)');
SELECT t.eq(pg_temp.claim('mgd', 'pg'), 'GUARDIAN_APPROVAL_REQUIRED', 'and the trigger refuses their claim: the #440 hold stays for them');
-- The three views and the trigger agree for every player with a birthday on file, except the managed adult the
-- exemption was always about.
SELECT t.ok(pg_temp.as_manual(h, 'pg') = pg_temp.as_ready(h, 'pg')
            AND pg_temp.as_ready(h, 'pg') = NOT pg_temp.paypal_guardian_stops(h, 'pg'),
  'PayPal, game_payment_guardian_ready and game_manual_claim_guardian_ready agree: ' || h)
  FROM unnest(ARRAY['teen', 'dayb', 'turned', 'older', 'twoga', 'stale', 'staleteen']) h;
SELECT t.ok((pg_temp.as_manual(h, 'pg') AND pg_temp.claim(h, 'pg') IS NULL)
         OR (NOT pg_temp.as_manual(h, 'pg') AND pg_temp.claim(h, 'pg') = 'GUARDIAN_APPROVAL_REQUIRED'),
  'the manual-claim check and the trigger agree: ' || h)
  FROM unnest(ARRAY['teen', 'dayb', 'turned', 'older', 'twoga', 'mgd']) h;
-- The 17-year-old's guardian approves: they pay (the minor path is unchanged).
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-dayb')), 'the guardian approves the 17-year-old''s request');
SELECT t.reset();
SELECT t.eq(pg_temp.as_manual('dayb', 'pg'), true, 'the 17-year-old whose request the guardian approved: yes');
SELECT t.eq(pg_temp.claim('dayb', 'pg'), NULL::text, 'and the trigger records their claim');

-- What every reader says about every person, before the sweep (links still all active).
CREATE TEMP TABLE before_readers AS
  SELECT h, pg_temp.readers(h) AS r FROM unnest(ARRAY['teen', 'dayb', 'turned', 'older', 'twoga', 'nobday', 'mgd', 'stale', 'staleteen']) h;
GRANT SELECT ON before_readers TO PUBLIC;

-- ---- 5. the sweep -------------------------------------------------------------------------------------------------
CREATE TEMP TABLE minor_links_before AS
  SELECT id, parent_user_id, child_user_id, status, verified_at, created_at, relationship FROM public.guardian_links
   WHERE child_user_id IN (t.id('teen'), t.id('dayb'), t.id('nobday'), t.id('mgd'));
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events), 0, 'setup: nothing recorded yet');
-- A cap of 2 ends two and leaves four.
CREATE TEMP TABLE sweep1 AS SELECT private_sec.end_adult_guardian_links(2) AS r;
SELECT t.eq((SELECT (r ->> 'ended')::int FROM sweep1), 2, 'a cap of 2 ends 2 links');
SELECT t.eq((SELECT (r ->> 'remaining')::int FROM sweep1), 4, 'and reports 4 waiting');
SELECT t.eq((SELECT (r ->> 'managed_waiting')::int FROM sweep1), 1, 'and 1 managed account that reached 18');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE status = 'revoked'), 2, 'two rows revoked');
CREATE TEMP TABLE sweep2 AS SELECT private_sec.end_adult_guardian_links() AS r;
SELECT t.eq((SELECT (r ->> 'ended')::int FROM sweep2), 4, 'the next run ends the other 4');
SELECT t.eq((SELECT (r ->> 'remaining')::int FROM sweep2), 0, 'none remain');
SELECT t.eq((SELECT (r ->> 'failed')::int FROM sweep2), 0, 'none failed');
CREATE TEMP TABLE sweep3 AS SELECT private_sec.end_adult_guardian_links() AS r;
SELECT t.eq((SELECT (r ->> 'ended')::int FROM sweep3), 0, 'idempotent: a third run ends nothing');
SELECT t.eq((SELECT (r ->> 'notified')::int FROM sweep3), 0, 'and tells nobody again');
SELECT t.eq((SELECT array_agg(c ORDER BY c) FROM (SELECT t.id(h)::text c FROM unnest(ARRAY['turned', 'older', 'twoga', 'stale', 'staleteen']) h) q),
            (SELECT array_agg(DISTINCT child_user_id::text ORDER BY child_user_id::text) FROM public.guardian_links WHERE status = 'revoked'),
  'exactly the adults'' links are revoked');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE status = 'revoked'), 6, '6 links revoked (twoga had two)');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE status = 'active'), 4, '4 stay active');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM minor_links_before b JOIN public.guardian_links g USING (id)
                         WHERE g.status IS DISTINCT FROM b.status OR g.verified_at IS DISTINCT FROM b.verified_at
                            OR g.parent_user_id <> b.parent_user_id OR g.relationship <> b.relationship)
        AND (SELECT count(*) FROM minor_links_before) = 4,
  'a 16-year-old, a 17-year-old (the day before 18), an unknown age and a managed adult are untouched');
SELECT t.eq((SELECT count(*)::int FROM public.family_audit_log WHERE child_user_id = t.id('turned') AND action = 'link.revoked'), 1,
  'the existing audit trigger recorded the end');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE kind = 'ended'), 6, 'six ended links recorded');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE kind = 'managed_notice'), 1, 'one managed notice recorded');

-- Notices: once per side.
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('turned') AND type = 'guardian_link'), 1,
  'the new adult is told once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('twoga') AND type = 'guardian_link'), 1,
  'once however many guardians they had');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('gb') AND type = 'guardian_link'), 1,
  'the second guardian is told once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND title = 'Family link ended'), 5,
  'the first guardian is told once for each of the five adults');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND title = 'A managed account has turned 18'), 1,
  'and once about the managed account');
SELECT t.eq((SELECT count(*)::int FROM public.notifications
              WHERE user_id IN (t.id('teen'), t.id('dayb'), t.id('nobday'), t.id('mgd')) AND type = 'guardian_link'), 0,
  'the 16-year-old, the 17-year-old, the unknown age and the managed account are told nothing');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE type = 'guardian_link'
                         AND (title || body) ~* '(legal|law|consent|revoked|withdrawn|restricted)'),
  'the wording makes no legal claim and does not say anything was withdrawn');
SELECT t.eq((SELECT body FROM public.notifications WHERE user_id = t.id('turned') AND type = 'guardian_link'),
  'You are 18 or over, so the link to your parent or guardian has ended. They can no longer see or change your account settings.',
  'the adult''s notice');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'parental_consent'), 0,
  'no "approval withdrawn" notice went to anyone');

-- The consent record is history: kept as it was.
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('turned')), 'approved',
  'the old consent record is not changed (the stored cohort never ages, so revoking it could lock an adult out)');
-- Approvals the guardian gave stop counting once the link is no longer a link; the minor's stay.
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE id = t.id('req-turned')), NULL::uuid,
  'the guardian''s approval of the adult''s request is cleared');
SELECT t.eq((SELECT guardian_approved_by FROM public.join_requests WHERE id = t.id('req-dayb')), t.id('ga'),
  'the 17-year-old''s approval stays');

-- ---- 6. the readers do not change when the sweep runs -------------------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM before_readers b WHERE b.r <> pg_temp.readers(b.h)), 0,
  'no reader answers differently after the sweep than it did before it');
SELECT t.ok(pg_temp.readers(h) = (SELECT r FROM before_readers WHERE before_readers.h = h2.h), 'unchanged: ' || h)
  FROM (SELECT unnest(ARRAY['teen', 'dayb', 'turned', 'older', 'twoga', 'nobday', 'mgd', 'stale', 'staleteen']) AS h) h2(h);
SELECT t.eq(pg_temp.as_manual('turned', 'pg'), true, 'after the sweep: the manual-claim check still says yes');
SELECT t.eq(pg_temp.claim('turned', 'pg'), NULL::text, 'and the trigger still records the claim');
SELECT t.eq(pg_temp.as_manual('mgd', 'pg'), false, 'the managed adult is still held');
SELECT t.eq(private_sec.child_game_participation_allowed(t.id('stale')), true, 'the switch left off still does not block the adult');
SELECT t.eq(private_sec.team_chat_member('squad', t.id('staleteen')), true, 'team chat unchanged for the adult');

-- A revoked link gives the guardian nothing.
SELECT t.as_user(t.id('ga'));
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview()), 4, 'the Parent Center still lists the same four');
SELECT t.eq(t.count('SELECT 1 FROM public.child_controls'), 4, 'the guardian reads four sets of controls');
SELECT t.eq(t.count(format('SELECT 1 FROM public.parental_consents WHERE child_user_id IN (%L, %L, %L)', t.id('turned'), t.id('older'), t.id('twoga'))), 0,
  'no adult''s consent record');
SELECT t.throws(format('SELECT public.set_child_controls(%L, ''{"game_participation": false}'')', t.id('older')), 'NOT_AUTHORIZED',
  'cannot change an adult''s controls');
SELECT t.throws(format('SELECT public.revoke_guardian_link(%L, ''x'')', t.id('older')), 'NOT_FOUND',
  'nothing left to end');
SELECT t.reset();
SELECT t.as_user(t.id('gb'));
SELECT t.eq(t.count('SELECT 1 FROM public.child_controls'), 0, 'the second guardian reads nothing');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview()), 0, 'and has nobody in the Parent Center');
SELECT t.reset();
-- The adult's own side: told, and free.
SELECT t.as_user(t.id('stale'));
SELECT t.eq(public.my_guardian_link_in_force(), false, 'the adult has no link in force');
SELECT t.eq(t.count('SELECT 1 FROM public.guardian_links WHERE status = ''revoked'''), 1, 'and can see their revoked link');
SELECT t.reset();
SELECT t.as_user(t.id('dayb'));
SELECT t.eq(public.my_guardian_link_in_force(), true, 'the 17-year-old still has one');
SELECT t.reset();
SELECT t.as_user(t.id('mgd'));
SELECT t.eq(public.my_guardian_link_in_force(), true, 'the managed adult still has one');
SELECT t.reset();
CREATE TEMP TABLE anon_q AS SELECT 'SELECT public.my_guardian_link_in_force()' AS sql;
GRANT SELECT ON anon_q TO anon;
SELECT t.as_anon();
SELECT t.throws((SELECT sql FROM anon_q), 'permission denied', 'a signed-out visitor is refused');
SELECT t.reset();
SELECT t.as_service();
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links_in_force(ARRAY[t.id('turned'), t.id('dayb'), t.id('mgd'), t.id('nobday'), t.id('twoga')])), 3,
  'the server list: the 17-year-old, the managed adult and the unknown age; not the adults');
SELECT t.reset();

-- ---- 7. the unmanaged-adult rule applies to a link made later, before any sweep ------------------------------------
SELECT t.person('late', 30);
INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at)
VALUES (t.id('ga'), t.id('late'), 'parent', 'active', now());
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('late')), false, 'a link made to an adult is not in force from the start');
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'ended')::int, 1, 'and the next sweep ends it');
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'ended')::int, 0, 'once');

-- ---- 8. a support-approved birthday correction after the sweep ended the link -------------------------------------
-- review_birthday_correction writes profile_birthdays under openrun.birthday_review = 'on' (an upsert). A correction
-- that makes the person a minor again must put the swept links back, so the order the daily job ran in cannot leave a
-- minor without a guardian: before the sweep the rule alone would have brought the link back.
SELECT t.person('hand', 19);
SELECT t.guardian('ga', 'hand');
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('hand');   -- ended by the guardian, by hand
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'ended')::int, 0, 'the sweep does not touch a link a guardian ended by hand');
DELETE FROM public.notifications;
CREATE FUNCTION pg_temp.correct(_who text, _bd date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('openrun.birthday_review', 'on', true);
  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (t.id(_who), _bd)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();
  PERFORM set_config('openrun.birthday_review', 'off', true);
END $$;
SELECT t.eq((SELECT status FROM public.guardian_links WHERE child_user_id = t.id('turned')), 'revoked', 'setup: the 18-year-old''s link was ended by the sweep');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE child_user_id = t.id('turned') AND kind = 'ended'), 1, 'and recorded');

-- A correction that leaves the person an adult changes nothing.
SELECT pg_temp.correct('older', (current_date - interval '30 years')::date);
SELECT t.eq((SELECT status FROM public.guardian_links WHERE child_user_id = t.id('older')), 'revoked', 'adult to another adult age: the link stays ended');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'guardian_link'), 0, 'and nobody is told');

-- A correction that makes them 16: the link is back, for the guardian who had it.
SELECT pg_temp.correct('turned', (current_date - interval '16 years')::date);
SELECT t.eq((SELECT status FROM public.guardian_links WHERE child_user_id = t.id('turned')), 'active', 'corrected to 16: the link is active again');
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('turned')), true, 'and the guardian is their guardian');
SELECT t.eq(private_sec.is_minor(t.id('turned')), true, 'the person is a minor');
SELECT t.eq(private_sec.guardian_payment_approval_missing(t.id('turned'), 'pg'), true,
  'the approval the sweep cleared is not reinstated: as any minor with a guardian, they need it again');
SELECT t.eq(pg_temp.as_manual('turned', 'pg'), false, 'the manual-claim hold is back for them');
SELECT t.eq(pg_temp.as_manual('turned', 'pg'), pg_temp.as_ready('turned', 'pg'), 'the pay gates agree for them');
SELECT t.eq((SELECT count(*)::int FROM private_sec.guardian_link_age_events WHERE child_user_id = t.id('turned')), 0, 'the record of the end is cleared');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND title = 'Family link restored'), 1, 'the guardian is told');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('turned') AND title = 'Your family link is back'), 1, 'and the person, once');
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'ended')::int, 0, 'the next sweep leaves a minor alone');
SELECT t.as_user(t.id('ga'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.child_controls WHERE child_user_id = %L', t.id('turned'))), 1, 'the guardian reads their controls again');
SELECT t.eq((SELECT count(*)::int FROM public.guardian_children_overview() WHERE child_user_id = t.id('turned')), 1, 'and sees them in the Parent Center');
SELECT t.reset();
-- The same person turns 18 again (a later correction back): ended and told again, once.
SELECT pg_temp.correct('turned', (current_date - interval '18 years')::date);
SELECT t.eq(private_sec.is_guardian_of(t.id('ga'), t.id('turned')), false, 'corrected back to 18: the rule ends the link at once');
SELECT t.eq((private_sec.end_adult_guardian_links() ->> 'ended')::int, 1, 'the sweep ends it again');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('turned') AND title = 'Your family link has ended'), 1, 'and tells them');

-- Two guardians: both come back, the person is told once.
DELETE FROM public.notifications;
SELECT pg_temp.correct('twoga', (current_date - interval '15 years')::date);
SELECT t.eq((SELECT count(*)::int FROM public.guardian_links WHERE child_user_id = t.id('twoga') AND status = 'active'), 2, 'both guardians are back');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('twoga') AND type = 'guardian_link'), 1, 'the person is told once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id IN (t.id('ga'), t.id('gb')) AND title = 'Family link restored'), 2, 'each guardian once');

-- A link a guardian ended by hand is never revived by a correction.
SELECT pg_temp.correct('hand', (current_date - interval '15 years')::date);
SELECT t.eq((SELECT status FROM public.guardian_links WHERE child_user_id = t.id('hand')), 'revoked', 'the hand-ended link stays ended');

-- An unknown birthday after the 18th does not exist: the row cannot be deleted by an adult (BIRTHDAY_LOCKED).
SELECT t.throws(format('DELETE FROM public.profile_birthdays WHERE user_id = %L', t.id('older')), 'BIRTHDAY_LOCKED',
  'a stored birthday cannot be removed to make an adult look unknown');

-- ---- 9. one adult, two guardians, the sweep capped at one a run ----------------------------------------------------
-- The adult must be told once even when a cap (or a locked row) splits their guardians across runs, however far apart.
DELETE FROM public.notifications;
SELECT t.person('splita', 21);
SELECT t.guardian('ga', 'splita'), t.guardian('gb', 'splita');
SELECT t.eq((private_sec.end_adult_guardian_links(1) ->> 'ended')::int, 1, 'cap 1: the first run ends one of two');
-- The next run is a later transaction in production: make the first run's records look old.
UPDATE private_sec.guardian_link_age_events SET created_at = created_at - interval '1 day' WHERE child_user_id = t.id('splita');
SELECT t.eq((private_sec.end_adult_guardian_links(1) ->> 'ended')::int, 1, 'the second run ends the other');
SELECT t.eq((private_sec.end_adult_guardian_links(1) ->> 'ended')::int, 0, 'and a third has nothing left');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('splita') AND type = 'guardian_link'), 1,
  'the adult was told once, not once per run');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('ga') AND title = 'Family link ended' AND body LIKE 'Splita%'), 1,
  'the first guardian once');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('gb') AND title = 'Family link ended' AND body LIKE 'Splita%'), 1,
  'the second guardian once');

ROLLBACK;
