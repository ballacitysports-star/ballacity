-- Behaviour checks for 20261021130000_listing_claim_review.sql. Same setup as content-studio.sql.
\set ON_ERROR_STOP 1
SET client_min_messages = warning;
CREATE OR REPLACE FUNCTION pg_temp.act(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN PERFORM set_config('request.jwt.claim.sub', COALESCE(_uid::text, ''), false); END $$;
CREATE TABLE pg_temp.results (n serial, name text, ok boolean, detail text);
GRANT ALL ON pg_temp.results TO PUBLIC;
CREATE OR REPLACE FUNCTION pg_temp.check(_name text, _role text, _uid uuid, _sql text, _want text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE _err text := NULL;
BEGIN
  PERFORM pg_temp.act(_uid);
  BEGIN EXECUTE format('SET LOCAL ROLE %I', _role); EXECUTE _sql; RESET ROLE;
  EXCEPTION WHEN OTHERS THEN _err := SQLERRM; RESET ROLE; END;
  INSERT INTO pg_temp.results(name, ok, detail) VALUES (_name,
    CASE WHEN _want IS NULL THEN _err IS NULL ELSE COALESCE(_err, '') LIKE '%' || _want || '%' END, COALESCE(_err, 'ok'));
END $$;

INSERT INTO auth.users (id, email, email_confirmed_at) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'mod1@test.local', now()),
 ('00000000-0000-0000-0000-0000000000a2', 'mod2@test.local', now()),
 ('00000000-0000-0000-0000-0000000000c1', 'coach@test.local', now()),
 ('00000000-0000-0000-0000-0000000000c2', 'rival@test.local', now());
INSERT INTO public.user_roles (user_id, role) VALUES
 ('00000000-0000-0000-0000-0000000000a1', 'moderator'), ('00000000-0000-0000-0000-0000000000a2', 'moderator');
\set M1 '''00000000-0000-0000-0000-0000000000a1'''
\set M2 '''00000000-0000-0000-0000-0000000000a2'''
\set C1 '''00000000-0000-0000-0000-0000000000c1'''
\set C2 '''00000000-0000-0000-0000-0000000000c2'''

SELECT pg_temp.check('moderator lists an unclaimed team', 'authenticated', :M1,
  $q$SELECT public.create_unclaimed_team('t-self', 'team', 'Self Team', 'tself', 'Austin', '{}')$q$, NULL);
SELECT pg_temp.check('moderator lists a second team', 'authenticated', :M1,
  $q$SELECT public.create_unclaimed_team('t-coach', 'team', 'Coach Team', 'tcoach', 'Austin', '{}')$q$, NULL);

-- self-review
SELECT pg_temp.check('moderator files a claim on a team', 'authenticated', :M1,
  $q$SELECT public.submit_listing_claim_details('team', 't-self', 'owner', true, 'mine', NULL)$q$, NULL);
SELECT pg_temp.check('moderator cannot approve own claim', 'authenticated', :M1,
  $q$SELECT public.approve_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-self'))$q$, 'OWN_CLAIM');
SELECT pg_temp.check('moderator cannot deny own claim', 'authenticated', :M1,
  $q$SELECT public.deny_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-self'), 'x')$q$, 'OWN_CLAIM');
SELECT pg_temp.check('moderator cannot request info on own claim', 'authenticated', :M1,
  $q$SELECT public.request_listing_claim_info((SELECT id FROM public.listing_claims WHERE subject_id = 't-self'), 'x')$q$, 'OWN_CLAIM');
SELECT pg_temp.check('self-approval left the team unowned', 'postgres', NULL,
  $q$DO $x$ BEGIN IF (SELECT owner_id FROM public.teams WHERE id = 't-self') IS NOT NULL THEN RAISE EXCEPTION 'OWNED'; END IF; END $x$$q$, NULL);
SELECT pg_temp.check('another moderator may review it', 'authenticated', :M2,
  $q$SELECT public.deny_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-self'), 'conflict of interest')$q$, NULL);

-- filing rules
SELECT pg_temp.check('relationship is required', 'authenticated', :C1,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', NULL, true, 'hi', NULL)$q$, 'RELATIONSHIP_REQUIRED');
SELECT pg_temp.check('an invented relationship is refused', 'authenticated', :C1,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'ceo', true, 'hi', NULL)$q$, 'RELATIONSHIP_REQUIRED');
SELECT pg_temp.check('attestation is required', 'authenticated', :C1,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'coach', false, 'hi', NULL)$q$, 'ATTESTATION_REQUIRED');
SELECT pg_temp.check('anon cannot file', 'anon', NULL,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'coach', true, 'hi', NULL)$q$, 'permission denied');
SELECT pg_temp.check('coach files a claim', 'authenticated', :C1,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'coach', true, 'I coach this team', 'https://example.org/roster')$q$, NULL);
SELECT pg_temp.check('duplicate open claim is refused', 'authenticated', :C1,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'coach', true, 'again', NULL)$q$, 'CLAIM_ALREADY_PENDING');
SELECT pg_temp.check('rival files a competing claim', 'authenticated', :C2,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'authorized_rep', true, 'me too', NULL)$q$, NULL);
SELECT pg_temp.check('claimant cannot rewrite the relationship', 'authenticated', :C1,
  $q$UPDATE public.listing_claims SET relationship = 'owner', status = 'withdrawn' WHERE subject_id = 't-coach' AND user_id = auth.uid()$q$, 'IMMUTABLE_FIELDS');
SELECT pg_temp.check('a claim grants nothing before review', 'postgres', NULL,
  $q$DO $x$ BEGIN IF (SELECT owner_id FROM public.teams WHERE id = 't-coach') IS NOT NULL THEN RAISE EXCEPTION 'OWNED'; END IF; END $x$$q$, NULL);

-- needs more information
SELECT pg_temp.check('claimant cannot ask themselves for info', 'authenticated', :C1,
  $q$SELECT public.request_listing_claim_info((SELECT id FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = auth.uid()), 'x')$q$, 'NOT_MODERATOR');
SELECT pg_temp.check('moderator must say what is needed', 'authenticated', :M1,
  $q$SELECT public.request_listing_claim_info((SELECT id FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c1'), '  ')$q$, 'NOTE_REQUIRED');
SELECT pg_temp.check('moderator requests more information', 'authenticated', :M1,
  $q$SELECT public.request_listing_claim_info((SELECT id FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c1'), 'Please link the league roster that lists you as coach.')$q$, NULL);
SELECT pg_temp.check('claimant was notified with the question only', 'postgres', NULL,
  $q$DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = '00000000-0000-0000-0000-0000000000c1' AND body = 'Please link the league roster that lists you as coach.') THEN RAISE EXCEPTION 'NO_NOTICE'; END IF; END $x$$q$, NULL);
SELECT pg_temp.check('a claim awaiting info cannot be approved', 'authenticated', :M2,
  $q$SELECT public.approve_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c1'))$q$, 'CLAIM_NOT_PENDING');
SELECT pg_temp.check('an open claim awaiting info still blocks a duplicate', 'authenticated', :C1,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'coach', true, 'dup', NULL)$q$, 'CLAIM_ALREADY_PENDING');
SELECT id AS coach_claim FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c1' \gset
SELECT pg_temp.check('someone else cannot answer for the claimant', 'authenticated', :C2,
  format($q$SELECT public.respond_listing_claim(%L, 'fake', NULL)$q$, :'coach_claim'), 'NOT_CLAIM_OWNER');
SELECT pg_temp.check('claimant answers', 'authenticated', :C1,
  $q$SELECT public.respond_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = auth.uid()), 'Roster: https://league.example/teams/9', 'https://league.example/teams/9')$q$, NULL);
SELECT pg_temp.check('answer is back in the queue with both texts', 'postgres', NULL,
  $q$DO $x$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c1' AND status = 'pending' AND message LIKE 'I coach this team%Reply: Roster%' AND evidence_url = 'https://league.example/teams/9') THEN RAISE EXCEPTION 'NOT_REQUEUED'; END IF; END $x$$q$, NULL);

-- approval, competing claims
SELECT pg_temp.check('moderator approves the coach', 'authenticated', :M2,
  $q$SELECT public.approve_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c1'))$q$, NULL);
SELECT pg_temp.check('the coach owns the team', 'postgres', NULL,
  $q$DO $x$ BEGIN IF (SELECT owner_id FROM public.teams WHERE id = 't-coach') <> '00000000-0000-0000-0000-0000000000c1' THEN RAISE EXCEPTION 'NOT_OWNER'; END IF; END $x$$q$, NULL);
SELECT pg_temp.check('the rival claim was declined automatically', 'postgres', NULL,
  $q$DO $x$ BEGIN IF (SELECT status FROM public.listing_claims WHERE subject_id = 't-coach' AND user_id = '00000000-0000-0000-0000-0000000000c2') <> 'denied' THEN RAISE EXCEPTION 'STILL_OPEN'; END IF; END $x$$q$, NULL);
SELECT pg_temp.check('no new claim on an owned team', 'authenticated', :C2,
  $q$SELECT public.submit_listing_claim_details('team', 't-coach', 'owner', true, 'take over', NULL)$q$, 'ALREADY_CLAIMED');
SELECT pg_temp.check('moderator cannot take over an owned team directly', 'authenticated', :M1,
  $q$UPDATE public.teams SET owner_id = '00000000-0000-0000-0000-0000000000a1' WHERE id = 't-coach'$q$, NULL);
SELECT pg_temp.check('...and that update changed nothing', 'postgres', NULL,
  $q$DO $x$ BEGIN IF (SELECT owner_id FROM public.teams WHERE id = 't-coach') <> '00000000-0000-0000-0000-0000000000c1' THEN RAISE EXCEPTION 'TAKEN_OVER'; END IF; END $x$$q$, NULL);

-- old path still works for existing clients
SELECT pg_temp.check('legacy submit still works', 'authenticated', :C2,
  $q$SELECT public.submit_listing_claim('team', 't-self', 'legacy', NULL)$q$, NULL);
SELECT pg_temp.check('withdraw works from pending', 'authenticated', :C2,
  $q$SELECT public.withdraw_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 't-self' AND user_id = auth.uid() AND status = 'pending'))$q$, NULL);

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, name, detail FROM pg_temp.results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok) AS failed FROM pg_temp.results;
