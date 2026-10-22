-- Listing claims: nobody reviews their own claim, a claimant states how they are
-- connected and attests it, a reviewer can ask for more information, and a
-- claim still grants nothing until another moderator approves it.
BEGIN;

SELECT t.person('modone', 40), t.person('modtwo', 41), t.person('coachclaim', 35), t.person('rivalclaim', 33);
INSERT INTO public.user_roles (user_id, role) VALUES
  (t.id('modone'), 'moderator'), (t.id('modtwo'), 'moderator');

SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$SELECT public.create_unclaimed_team('selfteam', 'team', 'Self Team', 'selfteam', 'Austin', '{}')$q$,
  'a moderator lists an unclaimed team');
SELECT t.lives($q$SELECT public.create_unclaimed_team('coachteam', 'team', 'Coach Team', 'coachteam', 'Austin', '{}')$q$,
  'and a second one');

-- ---- no self-review --------------------------------------------------------
SELECT t.lives($q$SELECT public.submit_listing_claim_details('team', 'selfteam', 'owner', true, 'mine', NULL)$q$,
  'a moderator may file a claim like anyone else');
SELECT t.throws($q$SELECT public.approve_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 'selfteam'))$q$,
  'OWN_CLAIM', 'a moderator cannot approve their own claim');
SELECT t.throws($q$SELECT public.deny_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 'selfteam'), 'x')$q$,
  'OWN_CLAIM', 'or decline it');
SELECT t.throws($q$SELECT public.request_listing_claim_info((SELECT id FROM public.listing_claims WHERE subject_id = 'selfteam'), 'x')$q$,
  'OWN_CLAIM', 'or ask themselves for more information');
SELECT t.reset();
SELECT t.ok((SELECT owner_id IS NULL FROM public.teams WHERE id = 'selfteam'), 'so the team stays unowned');
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives($q$SELECT public.deny_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 'selfteam'), 'conflict of interest')$q$,
  'another moderator can review it');

-- ---- filing --------------------------------------------------------------
SELECT t.as_user(t.id('coachclaim'));
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', NULL, true, 'hi', NULL)$q$,
  'RELATIONSHIP_REQUIRED', 'a claimant must say how they are connected');
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'ceo', true, 'hi', NULL)$q$,
  'RELATIONSHIP_REQUIRED', 'only the listed relationships are accepted');
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'coach', false, 'hi', NULL)$q$,
  'ATTESTATION_REQUIRED', 'a claimant must attest the claim is accurate');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'coach', true, 'hi', NULL)$q$,
  'permission denied', 'a visitor cannot file a claim');
SELECT t.as_user(t.id('coachclaim'));
SELECT t.lives($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'coach', true, 'I coach this team', 'https://example.org/roster')$q$,
  'a coach files a claim');
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'coach', true, 'again', NULL)$q$,
  'CLAIM_ALREADY_PENDING', 'one open claim per person per listing');
SELECT t.throws($q$UPDATE public.listing_claims SET relationship = 'owner', status = 'withdrawn' WHERE subject_id = 'coachteam' AND user_id = auth.uid()$q$,
  'IMMUTABLE_FIELDS', 'the stated relationship cannot be changed after filing');
SELECT t.as_user(t.id('rivalclaim'));
SELECT t.lives($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'authorized_rep', true, 'me too', NULL)$q$,
  'someone else files a competing claim');
SELECT t.reset();
SELECT t.ok((SELECT owner_id IS NULL FROM public.teams WHERE id = 'coachteam'), 'filing a claim grants nothing');

-- ---- asking for more ---------------------------------------------------------
SELECT t.as_user(t.id('coachclaim'));
SELECT t.throws(format('SELECT public.request_listing_claim_info(%L, ''x'')',
  (SELECT id FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('coachclaim'))),
  'NOT_MODERATOR', 'only a moderator asks for more information');
SELECT t.as_user(t.id('modone'));
SELECT t.throws(format('SELECT public.request_listing_claim_info(%L, ''  '')',
  (SELECT id FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('coachclaim'))),
  'NOTE_REQUIRED', 'the moderator must say what is needed');
SELECT t.lives(format('SELECT public.request_listing_claim_info(%L, %L)',
  (SELECT id FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('coachclaim')),
  'Please link the league roster that lists you as coach.'),
  'a moderator asks for more information');
SELECT t.reset();
SELECT t.ok(EXISTS (SELECT 1 FROM public.notifications WHERE user_id = t.id('coachclaim')
                    AND body = 'Please link the league roster that lists you as coach.'),
  'the claimant is told exactly what was asked');
SELECT t.as_user(t.id('modtwo'));
SELECT t.throws(format('SELECT public.approve_listing_claim(%L)',
  (SELECT id FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('coachclaim'))),
  'CLAIM_NOT_PENDING', 'a claim waiting on the claimant cannot be approved');
SELECT t.as_user(t.id('coachclaim'));
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'coach', true, 'dup', NULL)$q$,
  'CLAIM_ALREADY_PENDING', 'a claim waiting on information still blocks a duplicate');
SELECT t.reset();
SELECT t.as_user(t.id('rivalclaim'));
SELECT t.throws(format('SELECT public.respond_listing_claim(%L, ''fake'', NULL)',
  t.id('placeholder')), 'CLAIM_NOT_FOUND', 'an unknown claim cannot be answered');
-- Look the claim up as the superuser: the rival cannot see it, so the routine's
-- own ownership check is what has to refuse them.
SELECT t.reset();
SELECT set_config('t.coach_claim',
  (SELECT id::text FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('coachclaim')), true);
SELECT t.as_user(t.id('rivalclaim'));
SELECT t.throws(format('SELECT public.respond_listing_claim(%L, ''fake'', NULL)', current_setting('t.coach_claim')),
  'NOT_CLAIM_OWNER', 'nobody else can answer for the claimant');
SELECT t.as_user(t.id('coachclaim'));
SELECT t.lives($q$SELECT public.respond_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = auth.uid()), 'Roster: https://league.example/teams/nine', 'https://league.example/teams/nine')$q$,
  'the claimant answers');
SELECT t.reset();
SELECT t.ok((SELECT status = 'pending' AND message LIKE 'I coach this team%Reply: Roster%'
                    AND evidence_url = 'https://league.example/teams/nine'
             FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('coachclaim')),
  'the answer goes back into the queue alongside the original claim');

-- ---- approval --------------------------------------------------------------
SELECT t.as_user(t.id('modtwo'));
SELECT t.lives($q$SELECT public.approve_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = md5('t:coachclaim')::uuid))$q$,
  'another moderator approves the coach');
SELECT t.reset();
SELECT t.eq((SELECT owner_id FROM public.teams WHERE id = 'coachteam'), t.id('coachclaim'), 'the coach now owns the team');
SELECT t.eq((SELECT status FROM public.listing_claims WHERE subject_id = 'coachteam' AND user_id = t.id('rivalclaim')),
  'denied', 'the competing claim was declined');
SELECT t.as_user(t.id('rivalclaim'));
SELECT t.throws($q$SELECT public.submit_listing_claim_details('team', 'coachteam', 'owner', true, 'take over', NULL)$q$,
  'ALREADY_CLAIMED', 'an owned team cannot be claimed');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.changed(format('UPDATE public.teams SET owner_id = %L WHERE id = ''coachteam''', t.id('modone'))), 0,
  'a moderator cannot take an owned team over directly');

-- ---- the old path keeps working ----------------------------------------------
SELECT t.as_user(t.id('rivalclaim'));
SELECT t.lives($q$SELECT public.submit_listing_claim('team', 'selfteam', 'legacy', NULL)$q$,
  'the original submit routine still works');
SELECT t.lives($q$SELECT public.withdraw_listing_claim((SELECT id FROM public.listing_claims WHERE subject_id = 'selfteam' AND user_id = auth.uid() AND status = 'pending'))$q$,
  'and a claim can be withdrawn');

ROLLBACK;
