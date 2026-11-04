-- Production-only hand fixes captured in source, and the unauthorized-access rules around them:
--   enforce_gym_review (system updates pass the author-edit lock), review_ring_suspects (runs, moderators only),
--   EXECUTE on the trigger functions enforce_skill_vote and enforce_review_integrity (service_role only).
BEGIN;
SELECT t.person('owner', 40), t.person('rev1', 30), t.person('rev2', 31), t.person('rev3', 32), t.person('rev4', 33),
       t.person('modone', 38), t.person('kid', 12), t.person('adult', 29);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator');
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('org'), t.id('owner'), 'Test Gym', 'test-gym');

-- ---- grants: the trigger functions are not callable by any API role
SELECT t.eq(has_function_privilege('anon', 'public.enforce_gym_review()', 'EXECUTE'), false, 'anon cannot execute enforce_gym_review');
SELECT t.eq(has_function_privilege('authenticated', 'public.enforce_gym_review()', 'EXECUTE'), false, 'authenticated cannot execute enforce_gym_review');
SELECT t.eq(has_function_privilege('service_role', 'public.enforce_gym_review()', 'EXECUTE'), true, 'service_role can execute enforce_gym_review');
SELECT t.eq(has_function_privilege('anon', 'public.enforce_skill_vote()', 'EXECUTE'), false, 'anon cannot execute enforce_skill_vote');
SELECT t.eq(has_function_privilege('authenticated', 'public.enforce_skill_vote()', 'EXECUTE'), false, 'authenticated cannot execute enforce_skill_vote');
SELECT t.eq(has_function_privilege('service_role', 'public.enforce_skill_vote()', 'EXECUTE'), true, 'service_role can execute enforce_skill_vote');
SELECT t.eq(has_function_privilege('anon', 'public.enforce_review_integrity()', 'EXECUTE'), false, 'anon cannot execute enforce_review_integrity');
SELECT t.eq(has_function_privilege('authenticated', 'public.enforce_review_integrity()', 'EXECUTE'), false, 'authenticated cannot execute enforce_review_integrity');
SELECT t.eq(has_function_privilege('service_role', 'public.enforce_review_integrity()', 'EXECUTE'), true, 'service_role can execute enforce_review_integrity');
SELECT t.eq((SELECT count(*)::int FROM pg_proc p WHERE p.proname IN ('enforce_gym_review', 'enforce_skill_vote', 'enforce_review_integrity')
  AND p.pronamespace = 'public'::regnamespace AND p.prosecdef AND p.proconfig @> ARRAY['search_path=public']), 3,
  'all three stay SECURITY DEFINER with search_path pinned to public');
SELECT t.eq(has_function_privilege('anon', 'public.review_ring_suspects(integer)', 'EXECUTE'), false, 'anon cannot execute review_ring_suspects');
SELECT t.eq(has_function_privilege('authenticated', 'public.review_ring_suspects(integer)', 'EXECUTE'), true, 'authenticated can call review_ring_suspects (it checks moderator itself)');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.enforce_gym_review()$q$, 'permission denied', 'an anonymous caller is refused when calling enforce_gym_review directly');
SELECT t.throws($q$SELECT * FROM public.review_ring_suspects(60)$q$, 'permission denied', 'and review_ring_suspects');
SELECT t.reset();
SELECT t.as_user(t.id('rev1'));
SELECT t.throws($q$SELECT public.enforce_skill_vote()$q$, 'permission denied', 'a signed-in user cannot call enforce_skill_vote directly');
SELECT t.throws($q$SELECT public.enforce_review_integrity()$q$, 'permission denied', 'nor enforce_review_integrity');
SELECT t.reset();

-- ---- enforce_gym_review: the lock on authors still holds, system updates pass it
SELECT t.as_user(t.id('rev1'));
SELECT t.lives(format($q$INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, helpful_count, verified, flagged)
  VALUES (%L, %L, 'player', 'gym', %L, 'Test Gym', 5, 'Clean courts and friendly staff.', 50, true, true)$q$, t.id('gymrev'), t.id('rev1'), t.id('org')::text),
  'a member can review a gym');
SELECT t.reset();
SELECT t.ok((SELECT helpful_count = 0 AND verified = false AND flagged = false FROM public.reviews WHERE id = t.id('gymrev')),
  'on insert the forged helpful count, verified and flagged values are replaced');
SELECT t.as_user(t.id('owner'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'gym', %L, 'Test Gym', 5, 'My own gym is the best one.')$q$, t.id('owner'), t.id('org')::text),
  'cannot review your own gym', 'the gym owner cannot review their own gym');
SELECT t.reset();
SELECT t.as_user(t.id('rev1'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'gym', %L, 'Nowhere', 5, 'A review of a gym that is not there.')$q$, t.id('rev1'), t.id('nogym')::text),
  'Unknown gym', 'a review of a gym that does not exist is refused');
SELECT t.eq(t.changed(format($q$UPDATE public.reviews SET helpful_count = 99, verified = true, reviewee_id = %L, body = 'Edited: clean courts, friendly staff.' WHERE id = %L$q$, t.id('other')::text, t.id('gymrev'))), 1,
  'the author can edit their own review');
SELECT t.reset();
SELECT t.ok((SELECT helpful_count = 0 AND verified = false AND reviewee_id = t.id('org')::text AND body LIKE 'Edited:%' FROM public.reviews WHERE id = t.id('gymrev')),
  'but cannot raise the helpful count, mark it verified or re-point it at another gym; only the text changed');
SELECT t.as_user(t.id('rev2'));
SELECT t.eq(t.changed(format($q$UPDATE public.reviews SET body = 'Vandalised by someone else.' WHERE id = %L$q$, t.id('gymrev'))), 0,
  'another member cannot edit the review');
SELECT t.lives(format($q$INSERT INTO public.review_helpfuls (review_id, user_id) VALUES (%L, %L)$q$, t.id('gymrev'), t.id('rev2')), 'another member can mark it helpful');
SELECT t.as_user(t.id('rev3'));
SELECT t.lives(format($q$INSERT INTO public.review_helpfuls (review_id, user_id) VALUES (%L, %L)$q$, t.id('gymrev'), t.id('rev3')), 'and a third');
SELECT t.reset();
SELECT t.eq((SELECT helpful_count FROM public.reviews WHERE id = t.id('gymrev')), 2,
  'the vote counter, an update issued from a trigger, is not undone by the author-edit lock (this is what production does and a rebuild from source did not)');
SELECT t.as_user(t.id('rev2'));
SELECT t.lives(format($q$DELETE FROM public.review_helpfuls WHERE review_id = %L AND user_id = %L$q$, t.id('gymrev'), t.id('rev2')), 'a vote can be withdrawn');
SELECT t.reset();
SELECT t.eq((SELECT helpful_count FROM public.reviews WHERE id = t.id('gymrev')), 1, 'and the count follows it down');

-- the other system-write path: report_review flags a row while app.review_system = '1' (the only place in the code that sets it).
-- Without it the author's own flag is reverted; with it the update passes the lock. The setting cannot be chosen through the API:
-- no exposed function takes it from the caller (checked in review of this change).
SELECT t.as_user(t.id('rev1'));
SELECT t.eq(t.changed(format($q$UPDATE public.reviews SET flagged = true WHERE id = %L$q$, t.id('gymrev'))), 1, 'the author''s update of their own review is accepted');
SELECT t.reset();
SELECT t.eq((SELECT flagged FROM public.reviews WHERE id = t.id('gymrev')), false, 'but the author cannot flag it themselves: the lock reverts the flag');
SELECT t.as_user(t.id('rev1'));
SELECT set_config('app.review_system', '1', true);
SELECT t.eq(t.changed(format($q$UPDATE public.reviews SET flagged = true WHERE id = %L$q$, t.id('gymrev'))), 1, 'under app.review_system = 1 the same update is accepted');
SELECT set_config('app.review_system', '', true);
SELECT t.reset();
SELECT t.eq((SELECT flagged FROM public.reviews WHERE id = t.id('gymrev')), true, 'and this time it sticks: this is the path report_review uses, which the lock must let through');

-- ---- review_ring_suspects: runs (no ambiguous column), moderators only
SELECT t.person('ringa', 30), t.person('ringb', 31);
INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id) VALUES
  (t.id('ringa'), 'player', 'player', t.id('ringb')::text, 'B', 5, 'Great teammate every time.', 'rg1'),
  (t.id('ringa'), 'player', 'player', t.id('ringb')::text, 'B', 5, 'Great teammate again today.', 'rg2'),
  (t.id('ringb'), 'player', 'player', t.id('ringa')::text, 'A', 5, 'Great teammate every time.', 'rg1'),
  (t.id('ringb'), 'player', 'player', t.id('ringa')::text, 'A', 5, 'Great teammate again today.', 'rg2');
SELECT t.as_user(t.id('modone'));
SELECT t.eq((SELECT count(*)::int FROM public.review_ring_suspects(60)), 1, 'a moderator gets the mutual five-star pair (the function runs)');
SELECT t.ok((SELECT a_to_b = 2 AND b_to_a = 2 AND avg_rating = 5.00 FROM public.review_ring_suspects(60)), 'with both directions counted and the average');
SELECT t.reset();
SELECT t.as_user(t.id('rev1'));
SELECT t.throws($q$SELECT * FROM public.review_ring_suspects(60)$q$, 'Moderators only', 'a signed-in member who is not a moderator is refused');
SELECT t.as_user(t.id('adult'));
SELECT t.throws($q$SELECT * FROM public.review_ring_suspects(60)$q$, 'Moderators only', 'so is another member');
SELECT t.reset();

-- ---- the guard triggers still fire for signed-in users after the EXECUTE revocations
SELECT t.as_user(t.id('rev1'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'player', %L, 'Stranger', 4, 'Never played with this person.')$q$, t.id('rev1'), t.id('adult')::text),
  'only review people', 'enforce_review_integrity still refuses a review of someone the author never played with');
SELECT t.as_user(t.id('kid'));
SELECT t.throws(format($q$INSERT INTO public.skill_votes (game_id, voter_id, subject_id, sport, vote) VALUES ('sv1', %L, %L, 'basketball', 1)$q$, t.id('kid'), t.id('adult')),
  'only available between adults', 'enforce_skill_vote still refuses a minor''s skill vote');
SELECT t.reset();
ROLLBACK;
