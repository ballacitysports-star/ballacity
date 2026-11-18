-- docs/paid-path-gates.md section 6 (d) (20261120100000_manual_claim_guardian_ready): the pay page's view of the
-- manual-claim guardian rule. public.game_manual_claim_guardian_ready(game) must give exactly the answer the payment
-- trigger (enforce_guardian_before_payment) gives the caller's own manual claim, including for an adult whose guardian
-- link from before 18 is still active, whom game_payment_guardian_ready (PayPal) lets pay. The trigger itself is
-- unchanged: that adult's manual claim is still refused (owner decision 2026-11-18).
--
-- teen (16) has a guardian, ga. solo (17) has none. adult (28) has none. grown (18) and older (25) still have the link
-- made before 18. nobday has a link and no birthday.
BEGIN;

SELECT t.person('host', 40), t.person('ga', 41), t.person('teen', 16), t.person('solo', 17), t.person('adult', 28),
       t.person('grown', 18), t.person('older', 25);
SELECT t.guardian('ga', 'teen');
-- Links made at 16-17 that were never ended once the player turned 18: nothing ends them automatically.
SELECT t.guardian('ga', 'grown');
SELECT t.guardian('ga', 'older');
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobday'), 'nobday@example.test', now(), jsonb_build_object('display_name', 'Nobday', 'account_type', 'player'));
SELECT t.guardian('ga', 'nobday');

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('mg', t.id('host'), 'Manual run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10),
       ('mg2', t.id('host'), 'Manual run 2', 'Basketball', now() + interval '4 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('mg', t.id('host'), 10, false), ('mg2', t.id('host'), 10, false);

-- What the caller is told: the new check, the PayPal-side check, and whether the trigger records their own claim
-- (the guardian trigger's code, or NULL when the claim is recorded; the claim is never kept).
CREATE FUNCTION pg_temp.manual(_who text, _game text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r boolean;
BEGIN
  PERFORM t.as_user(t.id(_who));
  r := public.game_manual_claim_guardian_ready(_game);
  PERFORM t.reset();
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.ready(_who text, _game text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE r boolean;
BEGIN
  PERFORM t.as_user(t.id(_who));
  r := public.game_payment_guardian_ready(_game);
  PERFORM t.reset();
  RETURN r;
END $$;
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
-- The check agrees with the trigger: true exactly when the trigger records the claim.
CREATE FUNCTION pg_temp.agrees(_who text, _game text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE m boolean := pg_temp.manual(_who, _game); c text := pg_temp.claim(_who, _game);
BEGIN
  RETURN (m AND c IS NULL) OR (NOT m AND c = 'GUARDIAN_APPROVAL_REQUIRED');
END $$;

-- ---- 1. the shape: who may call it ------------------------------------------------------------------------------
SELECT t.ok(has_function_privilege('authenticated', 'public.game_manual_claim_guardian_ready(text)', 'EXECUTE'),
  'a signed-in player can ask');
SELECT t.ok(NOT has_function_privilege('anon', 'public.game_manual_claim_guardian_ready(text)', 'EXECUTE'),
  'a signed-out visitor cannot');
SELECT t.ok(NOT has_function_privilege('service_role', 'public.game_manual_claim_guardian_ready(text)', 'EXECUTE'),
  'nor can the service role (it has no signed-in player to answer for)');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid = 'public.game_manual_claim_guardian_ready(text)'::regprocedure
                           AND a.grantee = 0),
  'it is not granted to PUBLIC');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.guardian_payment_approval_missing(uuid, text)',
                                       'EXECUTE'),
  'the rule itself is still not callable through the API');
SELECT t.eq((SELECT p.proconfig FROM pg_proc p WHERE p.oid = 'public.game_manual_claim_guardian_ready(text)'::regprocedure),
  ARRAY['search_path=""'], 'search_path pinned to nothing');
SELECT t.ok((SELECT p.prosecdef AND p.provolatile = 's' FROM pg_proc p
              WHERE p.oid = 'public.game_manual_claim_guardian_ready(text)'::regprocedure),
  'SECURITY DEFINER and STABLE (read-only)');
SELECT t.eq(pg_get_function_identity_arguments('public.game_manual_claim_guardian_ready(text)'::regprocedure),
  '_game_id text', 'it takes only the game: it answers about the caller and nobody else');
SELECT t.eq(public.game_manual_claim_guardian_ready('mg'), false, 'with nobody signed in it is never true');
CREATE TEMP TABLE manual_q AS SELECT 'SELECT public.game_manual_claim_guardian_ready(''mg'')' AS sql;
GRANT SELECT ON manual_q TO anon;
SELECT t.as_anon();
SELECT t.throws((SELECT sql FROM manual_q), 'permission denied', 'a signed-out visitor is refused');
SELECT t.reset();

-- ---- 2. the case this is for: an adult whose guardian link from before 18 is still active -------------------------
SELECT t.eq(pg_temp.ready('grown', 'mg'), true, 'setup: PayPal''s check lets an 18-year-old with an old link pay');
SELECT t.eq(pg_temp.manual('grown', 'mg'), false, 'the manual-claim check says no for them');
SELECT t.eq(pg_temp.claim('grown', 'mg'), 'GUARDIAN_APPROVAL_REQUIRED',
  'because the trigger refuses their manual claim (unchanged: the guardian rule is not loosened)');
SELECT t.eq(pg_temp.ready('older', 'mg'), true, 'setup: a 25-year-old with an old link, the same for PayPal');
SELECT t.eq(pg_temp.manual('older', 'mg'), false, 'and the manual-claim check says no');
SELECT t.eq(pg_temp.claim('older', 'mg'), 'GUARDIAN_APPROVAL_REQUIRED', 'as the trigger does');

-- The guardian approves the adult's request for this game: the claim passes, and the check says so.
SELECT t.as_user(t.id('grown'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
                        VALUES (%L, 'mg', %L, %L, 'k-grown')$q$, t.id('req-grown'), t.id('grown'), t.id('host')),
  'the adult asks to join');
SELECT t.reset();
SELECT t.eq(pg_temp.manual('grown', 'mg'), false, 'a request waiting on the guardian: still no');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-grown')),
  'the guardian approves this game');
SELECT t.reset();
SELECT t.eq(pg_temp.manual('grown', 'mg'), true, 'with the approval the manual-claim check says yes');
SELECT t.eq(pg_temp.claim('grown', 'mg'), NULL::text, 'and the trigger records their claim');
SELECT t.eq(pg_temp.manual('grown', 'mg2'), false, 'the approval counts only for its own game');
SELECT t.eq(pg_temp.claim('grown', 'mg2'), 'GUARDIAN_APPROVAL_REQUIRED', 'as the trigger does');

-- The guardian ends the link (Parent Center, revoke_guardian_link): no approval is needed any more.
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.revoke_guardian_link(%L, %L)', t.id('older'), 'ended after 18'),
  'the guardian ends the link with the 25-year-old');
SELECT t.reset();
SELECT t.eq(pg_temp.manual('older', 'mg'), true, 'link ended: the manual-claim check says yes');
SELECT t.eq(pg_temp.claim('older', 'mg'), NULL::text, 'and the trigger records their claim');

-- ---- 3. everyone else: the check gives the trigger's answer -------------------------------------------------------
SELECT t.eq(pg_temp.manual('adult', 'mg'), true, 'an adult with no guardian link: yes');
SELECT t.eq(pg_temp.manual('solo', 'mg'), true, 'a 17-year-old with no guardian link: yes');
SELECT t.eq(pg_temp.manual('teen', 'mg'), false, 'a 16-year-old whose guardian has not approved: no');
SELECT t.eq(pg_temp.manual('nobday', 'mg'), false, 'an unknown age with a guardian link: no');
-- nobday's claim is refused before the guardian trigger is reached (enforce_game_payment_cohort: no age on file), so
-- the trigger's own answer cannot be seen for them; the pay page blocks them on that rule first ('payments').
SELECT t.ok(pg_temp.claim('nobday', 'mg') IS NOT NULL, 'setup: an unknown age''s manual claim is refused anyway');
SELECT t.ok(pg_temp.agrees(w, g), 'the check and the trigger agree: ' || w || ' on ' || g)
  FROM unnest(ARRAY['adult', 'solo', 'teen', 'grown', 'older', 'ga', 'host']) w,
       unnest(ARRAY['mg', 'mg2']) g;
-- Where the adult exemption does not apply, the PayPal-side check and this one say the same.
SELECT t.eq(pg_temp.manual(w, 'mg'), pg_temp.ready(w, 'mg'), 'no adult exemption in play, same answer as PayPal: ' || w)
  FROM unnest(ARRAY['adult', 'solo', 'teen', 'nobday']) w;

-- The teen's guardian approves: yes, then a host rejection takes it away again.
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
                        VALUES (%L, 'mg', %L, %L, 'k-teen')$q$, t.id('req-teen'), t.id('teen'), t.id('host')),
  'the teen asks to join');
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-teen')), 'ga approves');
SELECT t.reset();
SELECT t.eq(pg_temp.manual('teen', 'mg'), true, 'the teen with the approval: yes');
SELECT t.ok(pg_temp.agrees('teen', 'mg'), 'and the trigger agrees');
SELECT t.as_user(t.id('host'));
SELECT t.lives(format($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now() WHERE id = %L$q$,
                      t.id('req-teen')), 'the host says no');
SELECT t.reset();
SELECT t.eq(pg_temp.manual('teen', 'mg'), false, 'a rejected request: no');
SELECT t.ok(pg_temp.agrees('teen', 'mg'), 'and the trigger agrees');

-- ---- 4. nothing else changed ------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.ready('grown', 'mg2'), true, 'PayPal''s check still exempts the adult (unchanged)');
SELECT t.eq((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.payment_submissions'::regclass
                AND tgfoid = 'public.enforce_guardian_before_payment()'::regprocedure), 1,
  'the guardian trigger is still on payment_submissions');

ROLLBACK;
