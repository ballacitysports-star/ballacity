-- Removing an unclaimed listing: only a moderator, only while nobody owns it, no
-- claim is open and nothing else depends on it. A plain delete would cascade into
-- whatever people added after it was listed, so the database refuses instead.
BEGIN;

SELECT t.person('modrem', 40), t.person('plainrem', 30), t.person('claimantrem', 35), t.person('memberrem', 28);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modrem'), 'moderator');

-- A moderator lists two teams and a gym, as discovery does when a find is approved.
SELECT t.as_user(t.id('modrem'));
SELECT t.lives($q$SELECT public.create_unclaimed_team('rem-team', 'team', 'Remove Team', 'rem-team', 'Atlanta', '{}')$q$,
  'a moderator lists an unclaimed team');
SELECT t.lives($q$SELECT public.create_unclaimed_team('rem-coach', 'coach', 'Remove Coach', 'rem-coach', 'Atlanta', '{}')$q$,
  'and a trainer');
SELECT t.lives($q$SELECT public.create_unclaimed_gym('Remove Gym', 'rem-gym', 'Atlanta', 'Gym', '1 Court St', NULL)$q$,
  'and a gym');
SELECT t.reset();

-- ---- who may remove --------------------------------------------------------
SELECT t.as_user(t.id('plainrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-team')$q$,
  'NOT_MODERATOR', 'an ordinary member cannot remove a listing');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-team')$q$,
  'permission denied', 'a visitor cannot call it at all');
SELECT t.reset();
SELECT t.ok(EXISTS (SELECT 1 FROM public.teams WHERE id = 'rem-team'), 'so the team is still there');

-- ---- the happy path ----------------------------------------------------------
SELECT t.as_user(t.id('modrem'));
SELECT t.lives($q$SELECT public.remove_unclaimed_listing('team', 'rem-team')$q$,
  'a moderator removes an untouched unclaimed team');
SELECT t.lives($q$SELECT public.remove_unclaimed_listing('team', 'rem-coach')$q$,
  'and an untouched trainer');
SELECT t.lives(format('SELECT public.remove_unclaimed_listing(''gym'', %L)',
  (SELECT id FROM public.trainer_orgs WHERE handle = 'rem-gym')),
  'and an untouched gym');
SELECT t.reset();
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.teams WHERE id IN ('rem-team', 'rem-coach')), 'the teams are gone');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.trainer_orgs WHERE handle = 'rem-gym'), 'and the gym');

SELECT t.as_user(t.id('modrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-team')$q$,
  'LISTING_NOT_FOUND', 'removing it again says it is already gone');
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('gym', 'not-a-uuid')$q$,
  'LISTING_NOT_FOUND', 'a malformed gym id is a missing listing, not a server error');
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('court', 'x')$q$,
  'INVALID_TYPE', 'only teams and gyms');
SELECT t.reset();

-- ---- not once someone owns it -------------------------------------------------
SELECT t.as_user(t.id('modrem'));
SELECT t.lives($q$SELECT public.create_unclaimed_team('rem-owned', 'team', 'Owned Team', 'rem-owned', 'Atlanta', '{}')$q$,
  'a moderator lists another team');
SELECT t.reset();
-- Ownership only changes through an approved claim; this is the switch that path sets.
SELECT set_config('app.listing_claim', 'on', true);
UPDATE public.teams SET owner_id = t.id('claimantrem'), claimed_at = now() WHERE id = 'rem-owned';
SELECT set_config('app.listing_claim', 'off', true);
SELECT t.as_user(t.id('modrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-owned')$q$,
  'ALREADY_CLAIMED', 'a listing an owner has claimed cannot be removed');
SELECT t.reset();

-- A team nobody listed through the moderator path is not an unclaimed listing.
INSERT INTO public.teams (id, owner_id, kind, name, handle, city)
VALUES ('rem-plain', NULL, 'team', 'Plain Team', 'rem-plain', 'Atlanta');
SELECT t.as_user(t.id('modrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-plain')$q$,
  'NOT_UNCLAIMED_LISTING', 'nor a team that was never listed as unclaimed');
SELECT t.reset();

-- ---- not while a claim is open --------------------------------------------------
SELECT t.as_user(t.id('modrem'));
SELECT t.lives($q$SELECT public.create_unclaimed_team('rem-claim', 'team', 'Claimed Soon', 'rem-claim', 'Atlanta', '{}')$q$,
  'a moderator lists a team that someone then claims');
SELECT t.as_user(t.id('claimantrem'));
SELECT t.lives($q$SELECT public.submit_listing_claim_details('team', 'rem-claim', 'coach', true, 'I coach them', NULL)$q$,
  'a coach files a claim');
SELECT t.as_user(t.id('modrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-claim')$q$,
  'CLAIM_OPEN', 'an open claim stops the removal');
SELECT t.reset();
UPDATE public.listing_claims SET status = 'needs_info' WHERE subject_id = 'rem-claim';
SELECT t.as_user(t.id('modrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-claim')$q$,
  'CLAIM_OPEN', 'so does one waiting on more information');
SELECT t.reset();
UPDATE public.listing_claims SET status = 'denied' WHERE subject_id = 'rem-claim';
SELECT t.as_user(t.id('modrem'));
SELECT t.lives($q$SELECT public.remove_unclaimed_listing('team', 'rem-claim')$q$,
  'once the claim is decided the listing can go');
SELECT t.reset();
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.listing_claims WHERE subject_id = 'rem-claim'),
  'and its finished claims are swept with it');

-- ---- not once anything depends on it ---------------------------------------------
SELECT t.as_user(t.id('modrem'));
SELECT t.lives($q$SELECT public.create_unclaimed_team('rem-used', 'team', 'Used Team', 'rem-used', 'Atlanta', '{}')$q$,
  'a moderator lists a team that people then start using');
SELECT t.lives($q$SELECT public.create_unclaimed_gym('Used Gym', 'rem-usedgym', 'Atlanta', 'Gym', NULL, NULL)$q$,
  'and a gym');
SELECT t.reset();
SELECT t.member('rem-used', 'memberrem');
INSERT INTO public.org_members (org_id, user_id)
VALUES ((SELECT id FROM public.trainer_orgs WHERE handle = 'rem-usedgym'), t.id('memberrem'));

SELECT t.as_user(t.id('modrem'));
SELECT t.throws($q$SELECT public.remove_unclaimed_listing('team', 'rem-used')$q$,
  'LISTING_IN_USE', 'a team someone has joined cannot be removed');
SELECT t.throws(format('SELECT public.remove_unclaimed_listing(''gym'', %L)',
  (SELECT id FROM public.trainer_orgs WHERE handle = 'rem-usedgym')),
  'LISTING_IN_USE', 'nor a gym someone has joined');
SELECT t.reset();
SELECT t.ok(EXISTS (SELECT 1 FROM public.teams WHERE id = 'rem-used'), 'the team is still listed');
SELECT t.ok(EXISTS (SELECT 1 FROM public.team_members WHERE team_id = 'rem-used' AND user_id = t.id('memberrem')),
  'and the member is still on it');
SELECT t.ok(EXISTS (SELECT 1 FROM public.org_members WHERE user_id = t.id('memberrem')),
  'the gym keeps its member too');

ROLLBACK;
