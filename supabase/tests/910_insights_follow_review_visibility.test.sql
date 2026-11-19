-- 20261120100000_insights_follow_review_visibility: an AI review summary is readable only while a public, unflagged,
-- publishable review of the same subject (same kind) exists, and never when its subject's minor protection hides it (the
-- protection from 20261108100000 stays).
BEGIN;
SELECT t.person('subj', 30), t.person('rev', 34), t.person('rev2', 41), t.person('member', 27), t.person('teen', 16),
       t.person('grad', 18);

-- ---- the rule set ---------------------------------------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM pg_policy WHERE polrelid = 'public.reputation_insights'::regclass AND polcmd IN ('r', '*')), 1,
  'one read rule on summaries');
SELECT t.eq((SELECT polname::text FROM pg_policy WHERE polrelid = 'public.reputation_insights'::regclass AND polcmd IN ('r', '*')),
  'Insights follow review visibility', 'it is the review-visibility rule');
SELECT t.ok(pg_get_expr((SELECT polqual FROM pg_policy WHERE polrelid = 'public.reputation_insights'::regclass AND polcmd IN ('r', '*')),
  'public.reputation_insights'::regclass) LIKE '%insight_is_publishable%', 'it keeps the minor protection');
SELECT t.ok(pg_get_expr((SELECT polqual FROM pg_policy WHERE polrelid = 'public.reputation_insights'::regclass AND polcmd IN ('r', '*')),
  'public.reputation_insights'::regclass) LIKE '%insight_has_public_review%', 'and adds the public-review condition');
SELECT t.eq(has_function_privilege('public', 'private_sec.insight_has_public_review(text,text)', 'EXECUTE'), false,
  'the helper is not granted to PUBLIC');

-- ---- fixtures ---------------------------------------------------------------------------------------
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body) VALUES
  (t.id('r-pub'),  t.id('rev'),  'player', 'player', t.id('subj')::text, 'Subj', 5, 'Great teammate, always on time.'),
  (t.id('r-host'), t.id('rev2'), 'player', 'host',   t.id('subj')::text, 'Subj', 4, 'Well organised and started on time.'),
  (t.id('r-team'), t.id('rev'),  'player', 'team',   'tm910',            'Team', 5, 'A well run team with good vibes.');
INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model) VALUES
  (t.id('subj')::text, 'player', 'Reliable teammate.', ARRAY['effort'], ARRAY['focus'], 1, 'fixture'),
  ('tm910',            'team',   'Well run.',          ARRAY['effort'], ARRAY['focus'], 1, 'fixture');

CREATE FUNCTION t.sees_insight(_id text, _kind text) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.reputation_insights WHERE reviewee_id = _id AND reviewee_kind = _kind
$f$;
CREATE FUNCTION t.check_all(_id text, _kind text, _want int, _what text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  PERFORM t.as_anon();
  PERFORM t.eq(t.sees_insight(_id, _kind), _want, 'anonymous: ' || _what);
  PERFORM t.as_user(t.id('member'));
  PERFORM t.eq(t.sees_insight(_id, _kind), _want, 'a member: ' || _what);
  PERFORM t.as_user(t.id('subj'));
  PERFORM t.eq(t.sees_insight(_id, _kind), _want, 'the subject: ' || _what);
  PERFORM t.reset();
END $f$;

-- ---- a summary follows the reviews behind it -----------------------------------------------------------
SELECT t.check_all(t.id('subj')::text, 'player', 1, 'a summary backed by a public review is readable');
SELECT t.check_all('tm910', 'team', 1, 'a team summary backed by a public team review is readable');

UPDATE public.reviews SET is_private = true WHERE id = t.id('r-pub');
SELECT t.check_all(t.id('subj')::text, 'player', 0, 'once its only review is made private, the summary is not readable');
SELECT t.eq(t.sees_insight(t.id('subj')::text, 'player'), 1, 'the server still has it (nothing is deleted)');
SELECT t.as_anon();
SELECT t.eq(t.sees_insight(t.id('subj')::text, 'host'), 0, 'a public review of another kind (host) does not back the player summary');
SELECT t.reset();

UPDATE public.reviews SET is_private = false WHERE id = t.id('r-pub');
SELECT t.check_all(t.id('subj')::text, 'player', 1, 'made public again, it is readable again');

UPDATE public.reviews SET flagged = true WHERE id = t.id('r-pub');
SELECT t.check_all(t.id('subj')::text, 'player', 0, 'once its review is flagged by moderation, the summary is not readable');
UPDATE public.reviews SET flagged = false WHERE id = t.id('r-pub');

-- two reviews, one hidden: the other still backs it
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, is_private) VALUES
  (t.id('r-priv'), t.id('rev2'), 'player', 'player', t.id('subj')::text, 'Subj', 3, 'Quiet today but solid.', true);
SELECT t.check_all(t.id('subj')::text, 'player', 1, 'one public review among private ones is enough');

DELETE FROM public.reviews WHERE id = t.id('r-pub');
SELECT t.check_all(t.id('subj')::text, 'player', 0, 'once the public review is deleted and only a private one is left, it is not readable');

DELETE FROM public.reviews WHERE id = t.id('r-team');
SELECT t.check_all('tm910', 'team', 0, 'a team summary whose review was deleted is not readable');

-- a review written by a minor about an adult is not publishable, so it does not back a summary
SET LOCAL session_replication_role = replica;
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, minor_protected) VALUES
  (t.id('r-by-teen'), t.id('teen'), 'player', 'player', t.id('subj')::text, 'Subj', 5, 'Played well and was friendly.', true);
SET LOCAL session_replication_role = origin;
SELECT t.check_all(t.id('subj')::text, 'player', 0, 'a review written by a minor does not back a summary');

-- ---- minor protection is kept (the sandbox's earlier version dropped it) ----------------------------
-- a 16-year-old with a public, unflagged review row (written historically) and a summary: hidden from everyone
SET LOCAL session_replication_role = replica;
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body) VALUES
  (t.id('r-teen'), t.id('rev'), 'player', 'player', t.id('teen')::text, 'Teen', 2, 'Argued with everyone all game.');
INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model) VALUES
  (t.id('teen')::text, 'player', 'Often argumentative.', ARRAY['effort'], ARRAY['teamwork'], 1, 'fixture');
SET LOCAL session_replication_role = origin;
SELECT t.as_anon();
SELECT t.eq(t.sees_insight(t.id('teen')::text, 'player'), 0, 'anonymous: no summary about a 16-year-old');
SELECT t.as_user(t.id('member'));
SELECT t.eq(t.sees_insight(t.id('teen')::text, 'player'), 0, 'a member: none either');
SELECT t.as_user(t.id('teen'));
SELECT t.eq(t.sees_insight(t.id('teen')::text, 'player'), 0, 'nor the minor themself');
SELECT t.reset();

-- a summary generated while its subject was 17 stays hidden after they turn 18, even once an adult-era public review exists
INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model, generated_at) VALUES
  (t.id('grad')::text, 'player', 'Generated while they were 17.', '{}', '{}', 1, 'm', now() - interval '2 months');
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body) VALUES
  (t.id('r-grad-adult'), t.id('rev'), 'player', 'player', t.id('grad')::text, 'Grad', 5, 'Written after they turned 18.');
SELECT t.ok((SELECT minor_protected FROM public.reputation_insights WHERE reviewee_id = t.id('grad')::text), 'fixture: the old summary is flagged');
SELECT t.ok(NOT (SELECT minor_protected FROM public.reviews WHERE id = t.id('r-grad-adult')), 'fixture: the adult-era review is not');
SELECT t.check_all(t.id('grad')::text, 'player', 0, 'a summary from when its subject was a minor stays hidden although a public review now exists');
-- regenerated now, from adult-era reviews, it is readable
UPDATE public.reputation_insights SET summary = 'Regenerated.', generated_at = now() WHERE reviewee_id = t.id('grad')::text;
SELECT t.as_anon();
SELECT t.eq(t.sees_insight(t.id('grad')::text, 'player'), 1, 'regenerated after 18 and backed by a public review, it is readable');
SELECT t.reset();

-- ---- writes are unchanged: clients still cannot write summaries -----------------------------------
SELECT t.as_user(t.id('subj'));
SELECT t.throws(format($q$INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model)
  VALUES (%L, 'host', 'Self-written praise.', '{}', '{}', 9, 'x')$q$, t.id('subj')::text), 'row-level security', 'a member cannot write a summary');
SELECT t.reset();

ROLLBACK;
