-- A helpful vote moves reviews.helpful_count by exactly one, and there is exactly one trigger doing it.
BEGIN;
SELECT t.person('author', 35), t.person('v1', 30), t.person('v2', 31), t.person('v3', 32);

-- setup runs as the connecting superuser (no auth.uid()), like the service role
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (t.id('rv'), t.id('author'), 'player', 'player', t.id('v1')::text, 'Teammate', 5, 'Good teammate, communicated well.');

SELECT t.eq((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.review_helpfuls'::regclass AND NOT tgisinternal), 1,
  'review_helpfuls has exactly one user trigger');
SELECT t.eq((SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'public.review_helpfuls'::regclass AND NOT tgisinternal),
  'trg_review_helpfuls_count', 'and it is the original, trg_review_helpfuls_count');
SELECT t.eq((SELECT count(*)::int FROM pg_trigger WHERE tgrelid = 'public.review_helpfuls'::regclass AND tgname = 'bump_helpful_count_trg'), 0,
  'the later duplicate (bump_helpful_count_trg) is gone');
SELECT t.eq((SELECT tgenabled::text FROM pg_trigger WHERE tgrelid = 'public.review_helpfuls'::regclass AND tgname = 'trg_review_helpfuls_count'), 'O',
  'the surviving trigger is enabled');

SELECT t.eq((SELECT helpful_count FROM public.reviews WHERE id = t.id('rv')), 0, 'a new review starts at 0');
SELECT t.as_user(t.id('v1'));
SELECT t.lives(format($q$INSERT INTO public.review_helpfuls (review_id, user_id) VALUES (%L, %L)$q$, t.id('rv'), t.id('v1')), 'a user can mark a review helpful');
SELECT t.as_user(t.id('v2'));
SELECT t.lives(format($q$INSERT INTO public.review_helpfuls (review_id, user_id) VALUES (%L, %L)$q$, t.id('rv'), t.id('v2')), 'a second user can too');
SELECT t.reset();
SELECT t.eq((SELECT helpful_count FROM public.reviews WHERE id = t.id('rv')), 2, 'two votes count as 2, not 4');

SELECT t.as_user(t.id('v1'));
SELECT t.lives(format($q$DELETE FROM public.review_helpfuls WHERE review_id = %L AND user_id = %L$q$, t.id('rv'), t.id('v1')), 'a vote can be withdrawn');
SELECT t.reset();
SELECT t.eq((SELECT helpful_count FROM public.reviews WHERE id = t.id('rv')), 1, 'withdrawing one vote takes the count to 1, not 0');

SELECT t.as_user(t.id('v3'));
SELECT t.lives(format($q$INSERT INTO public.review_helpfuls (review_id, user_id) VALUES (%L, %L)$q$, t.id('rv'), t.id('v3')), 'another vote');
SELECT t.reset();
SELECT t.eq((SELECT helpful_count FROM public.reviews WHERE id = t.id('rv')), 2, 'and the count follows (2)');
ROLLBACK;
