-- Reviews and minors (PRIV-1).
--
-- Nobody under 18 (or of unconfirmed age) is the subject of a review, public or private, and nobody
-- under 18 writes one for now. Reviews, AI summaries and review-derived statistics about a person
-- under 18 are not readable by anonymous visitors, unrelated members, guardians of other children or
-- other minors. Existing rows are preserved: they are hidden, not changed or deleted.
--
-- Cohorts used: under 13 (8), 13-15 (14), 16-17 (16, 17), adult (28-41), and an account whose
-- cohort is unknown (no profile row), which must be treated as not an adult.
BEGIN;

SELECT t.person('adultrev', 30), t.person('adultsubj', 31), t.person('adultpeer', 32),
       t.person('stranger', 28), t.person('modone', 35),
       t.person('child8', 8), t.person('teen14', 14), t.person('teen17', 17), t.person('teen16', 16),
       t.person('nullcohort', 30),
       t.person('guardian14', 40), t.person('guardian8', 41);
SELECT t.guardian('guardian14', 'teen14');
SELECT t.guardian('guardian8', 'child8');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'admin');
-- A person whose age is unknown: an account with no profile row (age_cohort_of() answers
-- 'unknown'). profiles.age_cohort itself is NOT NULL, so this is the only way to be unknown.
DELETE FROM public.profiles WHERE id = t.id('nullcohort');
SELECT t.eq(public.age_cohort_of(t.id('nullcohort')), 'unknown', 'fixture: one account has an unknown cohort');
SELECT t.team('tm', 'adultrev');

-- One finished game that everyone played in, so the eligibility rules would allow a review.
INSERT INTO public.hosted_games (id, host_id, sport, title, date, status, completed_at)
VALUES ('g-rv', t.id('adultrev'), 'basketball', 'Review fixture', now() - interval '2 days', 'completed', now() - interval '2 days');
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id, attended)
SELECT 'g-rv', t.id(h), true FROM unnest(ARRAY['adultrev','adultsubj','adultpeer','child8','teen14','teen17','teen16','nullcohort']) h;
SET LOCAL session_replication_role = origin;

-- ---- 1. writing a review about someone ---------------------------------------------------------
SELECT t.as_user(t.id('adultrev'));
SELECT t.lives(format($q$INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, %L, 'player', 'player', %L, 'Adult', 4, 'Good teammate, communicated well.', 'g-rv')$q$,
  t.id('new-adult'), t.id('adultrev'), t.id('adultsubj')::text),
  'an adult can review an adult they played with');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Kid', 2, 'Not a great teammate today.', 'g-rv')$q$, t.id('adultrev'), t.id('child8')::text),
  'not available for this person', 'under 13: nobody can review them');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id, is_private)
  VALUES (%L, 'player', 'player', %L, 'Teen', 2, 'Not a great teammate today.', 'g-rv', false)$q$, t.id('adultrev'), t.id('teen14')::text),
  'not available for this person', '13-15: no public review of them');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id, is_private)
  VALUES (%L, 'player', 'player', %L, 'Teen', 2, 'Not a great teammate today.', 'g-rv', true)$q$, t.id('adultrev'), t.id('teen14')::text),
  'not available for this person', '13-15: and no private review either (it used to be forced public)');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Teen', 2, 'Not a great teammate today.', 'g-rv')$q$, t.id('adultrev'), t.id('teen17')::text),
  'not available for this person', '16-17: no review of a player');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'host', %L, 'Teen host', 2, 'Late and disorganised.')$q$, t.id('adultrev'), t.id('teen17')::text),
  'not available for this person', '16-17: no review of a host');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Unknown', 2, 'Not a great teammate today.', 'g-rv')$q$, t.id('adultrev'), t.id('nullcohort')::text),
  'not available for this person', 'unknown age (no profile): treated as not an adult');
SELECT t.reset();

-- ---- 2. minors cannot write reviews at all (for now) ------------------------------------------
SELECT t.as_user(t.id('teen17'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Adult', 4, 'Good teammate, communicated well.', 'g-rv')$q$, t.id('teen17'), t.id('adultpeer')::text),
  'adults only', '16-17 author: refused');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'team', 'tm', 'Team', 5, 'A great team to be around.')$q$, t.id('teen17')),
  'adults only', '16-17 author: refused for a team review too');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'gym', 'some-gym', 'Gym', 5, 'Clean courts and friendly staff.')$q$, t.id('teen17')),
  'adults only', '16-17 author: refused for a gym review too');
SELECT t.as_user(t.id('teen14'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Adult', 4, 'Good teammate, communicated well.', 'g-rv')$q$, t.id('teen14'), t.id('adultpeer')::text),
  'adults only', '13-15 author: refused');
SELECT t.as_user(t.id('child8'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Adult', 4, 'Good teammate, communicated well.', 'g-rv')$q$, t.id('child8'), t.id('adultpeer')::text),
  'adults only', 'under-13 author: refused');
SELECT t.as_user(t.id('nullcohort'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Adult', 4, 'Good teammate, communicated well.', 'g-rv')$q$, t.id('nullcohort'), t.id('adultpeer')::text),
  'adults only', 'unknown-age author: refused');
SELECT t.reset();

-- ---- 3. historical rows: kept, but not readable ------------------------------------------------
-- Written as the server would have before this change (triggers off for the fixture only).
SET LOCAL session_replication_role = replica;
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, is_private, verified, flagged) VALUES
  (t.id('r-teen14-pub'),  t.id('adultrev'), 'player', 'player', t.id('teen14')::text,     'Teen14',  2, 'Argued with everyone all game.',   false, true, false),
  (t.id('r-teen14-priv'), t.id('adultrev'), 'player', 'player', t.id('teen14')::text,     'Teen14',  3, 'Needs to work on communication.', true,  true, false),
  (t.id('r-teen17-host'), t.id('adultrev'), 'player', 'host',   t.id('teen17')::text,     'Teen17',  2, 'Started late and disorganised.',   false, true, false),
  (t.id('r-child8'),      t.id('adultrev'), 'player', 'player', t.id('child8')::text,     'Child8',  4, 'Fun to play with, very keen.',     false, true, false),
  (t.id('r-null-pub'),    t.id('adultrev'), 'player', 'player', t.id('nullcohort')::text, 'Unknown', 3, 'Average game from this player.',   false, true, false),
  (t.id('r-adult-pub'),   t.id('adultrev'), 'player', 'player', t.id('adultsubj')::text,  'Adult',   5, 'Great teammate, always on time.',  false, true, false),
  (t.id('r-team-pub'),    t.id('adultrev'), 'player', 'team',   'tm',                     'Team',    5, 'A well run team with good vibes.', false, true, false),
  (t.id('r-by-teen'),     t.id('teen17'),   'player', 'player', t.id('adultsubj')::text,  'Adult',   4, 'Played well and was friendly.',    false, true, false),
  (t.id('r-gym-by-teen'), t.id('teen17'),   'player', 'gym',    'some-gym',               'Gym',     4, 'Clean courts and friendly staff.', false, true, false);
INSERT INTO public.review_ai_analysis (review_id, traits, sentiment, mismatch, model) VALUES
  (t.id('r-teen14-pub'), ARRAY['positive'], 0.2, false, 'fixture'),
  (t.id('r-adult-pub'),  ARRAY['positive','onTime'], 0.9, false, 'fixture'),
  (t.id('r-by-teen'),    ARRAY['positive'], 0.8, false, 'fixture');
INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model) VALUES
  (t.id('teen14')::text,     'player', 'Often argumentative in games.', ARRAY['effort'], ARRAY['teamwork'], 2, 'fixture'),
  (t.id('child8')::text,     'player', 'Keen player.',                  ARRAY['effort'], ARRAY['focus'],    1, 'fixture'),
  (t.id('teen17')::text,     'host',   'Often starts late.',            ARRAY['effort'], ARRAY['timing'],   1, 'fixture'),
  (t.id('nullcohort')::text, 'player', 'Average.',                      ARRAY['effort'], ARRAY['focus'],    1, 'fixture'),
  (t.id('adultsubj')::text,  'player', 'Reliable teammate.',            ARRAY['effort'], ARRAY['focus'],    3, 'fixture'),
  (t.id('adultsubj')::text,  'host',   'Well organised.',               ARRAY['effort'], ARRAY['focus'],    3, 'fixture'),
  ('tm',                     'team',   'Well run.',                     ARRAY['effort'], ARRAY['focus'],    3, 'fixture');
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.vis_reviews() RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.reviews WHERE id IN (
    SELECT t.id(x) FROM unnest(ARRAY['r-teen14-pub','r-teen14-priv','r-teen17-host','r-child8','r-null-pub',
      'r-adult-pub','r-team-pub','r-by-teen','r-gym-by-teen']) x)
$f$;

SELECT t.eq(t.vis_reviews(), 9, 'the server sees all nine historical rows: nothing was deleted or altered');

-- Only the adult-about-adult review and the team review (both adult-authored) are public.
SELECT t.as_anon();
SELECT t.eq(t.vis_reviews(), 2, 'anonymous: only reviews with an adult subject and an adult author');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('teen14')::text)), 0, 'anonymous: nothing about the 13-15 player');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('teen17')::text)), 0, 'anonymous: nothing about the 16-17 host');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('child8')::text)), 0, 'anonymous: nothing about the under-13');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('nullcohort')::text)), 0, 'anonymous: nothing about an unknown-age profile');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewer_id = %L', t.id('teen17'))), 0, 'anonymous: nothing written by a minor (the author is not identified)');

SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.vis_reviews(), 2, 'an unrelated signed-in member: the same two');
SELECT t.as_user(t.id('teen16'));
SELECT t.eq(t.vis_reviews(), 2, 'another minor: the same two');
SELECT t.as_user(t.id('teen14'));
SELECT t.eq(t.vis_reviews(), 2, 'the 13-15 player cannot read reviews about themselves, public or private');
SELECT t.as_user(t.id('child8'));
SELECT t.eq(t.vis_reviews(), 2, 'the under-13 cannot read reviews about themselves');
SELECT t.as_user(t.id('guardian14'));
SELECT t.eq(t.vis_reviews(), 2, 'their verified guardian cannot read them either (a private-feedback workflow comes later)');
SELECT t.as_user(t.id('guardian8'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('teen14')::text)), 0, 'a guardian of a different child: nothing about this one');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.vis_reviews(), 2, 'a moderator through the member API sees the same two (moderation reads through the service role)');
SELECT t.as_user(t.id('adultsubj'));
SELECT t.eq(t.vis_reviews(), 2, 'the adult reviewee: their public review and the team review; the minor-authored one stays hidden');
SELECT t.as_user(t.id('adultrev'));
SELECT t.eq(t.vis_reviews(), 7, 'an author still reads every review they wrote (7); they do not read others'' hidden ones');
SELECT t.as_user(t.id('teen17'));
SELECT t.eq(t.vis_reviews(), 4, 'a minor author reads their own two plus the two public ones');
SELECT t.reset();

-- ---- 4. AI analysis of a review follows the review's visibility -------------------------------
CREATE FUNCTION t.vis_analyses() RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.review_ai_analysis
$f$;
SELECT t.eq(t.vis_analyses(), 3, 'the server sees all three analyses');
SELECT t.as_anon();
SELECT t.eq(t.vis_analyses(), 1, 'anonymous: only the analysis of the adult review');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.vis_analyses(), 1, 'a member: only the analysis of the adult review');
SELECT t.as_user(t.id('guardian14'));
SELECT t.eq(t.vis_analyses(), 1, 'a guardian: no analysis about their child');
SELECT t.reset();

-- ---- 5. AI reputation summaries ----------------------------------------------------------------
CREATE FUNCTION t.vis_insights() RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.reputation_insights
$f$;
SELECT t.eq(t.vis_insights(), 7, 'the server sees all seven summaries');
SELECT t.as_anon();
SELECT t.eq(t.vis_insights(), 3, 'anonymous: only the adult player, the adult host and the team');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reputation_insights WHERE reviewee_id = ANY (%L)',
  ARRAY[t.id('teen14')::text, t.id('child8')::text, t.id('teen17')::text, t.id('nullcohort')::text])), 0,
  'anonymous: no summary about under-13, 13-15, 16-17 or an unknown-age profile');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.vis_insights(), 3, 'a member: the same three');
SELECT t.as_user(t.id('teen14'));
SELECT t.eq(t.vis_insights(), 3, 'the minor: no summary about themselves');
SELECT t.as_user(t.id('guardian14'));
SELECT t.eq(t.vis_insights(), 3, 'their guardian: no summary about the child');
SELECT t.reset();

-- ---- 6. review-derived statistics --------------------------------------------------------------
-- teen14 played one game and has two historical reviews; adultsubj played one game and has one
-- adult-authored review (the minor-authored one is hidden, so it is not counted either).
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT games_joined + review_count FROM public.player_activity_stats(t.id('teen14'))), 0,
  'stats about the 13-15 player, asked by a member: all zero (no attendance, no review data)');
SELECT t.eq((SELECT respectful + communicative + fair_play + positive + on_time FROM public.player_trait_counts(t.id('teen14'))), 0,
  'trait counts about the 13-15 player, asked by a member: zero');
SELECT t.eq((SELECT games_joined + review_count FROM public.player_activity_stats(t.id('child8'))), 0, 'under-13: zero for a member');
SELECT t.eq((SELECT games_joined + review_count FROM public.player_activity_stats(t.id('teen17'))), 0, '16-17: zero for a member');
SELECT t.eq((SELECT games_joined + review_count FROM public.player_activity_stats(t.id('nullcohort'))), 0, 'unknown age: zero for a member');
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('adultsubj'))), 1, 'an adult subject: attendance unchanged for a member');
-- Two adult-authored reviews (the historical one and the one written in section 1); the minor-authored one is not counted.
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('adultsubj'))), 2, 'an adult subject: counts the adult-authored reviews, not the hidden minor-authored one');
SELECT t.eq((SELECT positive FROM public.player_trait_counts(t.id('adultsubj'))), 1, 'an adult subject: trait counts still work (adult-authored review only)');
SELECT t.as_user(t.id('guardian8'));
SELECT t.eq((SELECT games_joined + review_count FROM public.player_activity_stats(t.id('teen14'))), 0, 'a guardian of a different child: zero');
SELECT t.as_user(t.id('teen14'));
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('teen14'))), 1, 'the 13-15 player sees their own attendance');
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('teen14'))), 0, 'but not review-derived numbers about themselves');
SELECT t.as_user(t.id('guardian14'));
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('teen14'))), 1, 'their verified guardian sees the child''s attendance');
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('teen14'))), 0, 'and no review-derived numbers');
SELECT t.as_anon();
SELECT t.throws(format('SELECT * FROM public.player_activity_stats(%L)', t.id('adultsubj')), 'permission denied', 'anonymous visitors still cannot call the statistics');
SELECT t.throws(format('SELECT * FROM public.player_trait_counts(%L)', t.id('adultsubj')), 'permission denied', 'nor the trait counts');
SELECT t.reset();
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('teen14'))), 1,
  'the server (no user) still sees the preserved data: the historical public review is counted (the private one never is)');
SELECT t.eq((SELECT positive FROM public.player_trait_counts(t.id('teen14'))), 1, 'and the preserved trait counts');

-- ---- 7. who is offered to review ---------------------------------------------------------------
SELECT t.as_user(t.id('adultrev'));
SELECT t.ok(EXISTS (SELECT 1 FROM public.my_reviewable('player', t.id('adultpeer')::text)), 'an adult is offered an adult they played with');
SELECT t.eq(t.count(format('SELECT 1 FROM public.my_reviewable(NULL, NULL) WHERE reviewee_id = ANY (%L)',
  ARRAY[t.id('child8')::text, t.id('teen14')::text, t.id('teen17')::text, t.id('teen16')::text, t.id('nullcohort')::text])), 0,
  'but is never offered a person under 18 or of unknown age');
SELECT t.as_user(t.id('teen17'));
SELECT t.eq(t.count('SELECT 1 FROM public.my_reviewable(NULL, NULL)'), 0, 'a minor is offered nobody to review');
SELECT t.reset();

-- ---- 8. unchanged for adults and for non-person reviews ----------------------------------------
SELECT t.as_user(t.id('adultrev'));
SELECT t.lives(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Adult peer', 4, 'Good teammate, communicated well.', 'g-rv')$q$, t.id('adultrev'), t.id('adultpeer')::text),
  'an adult can still review another adult');
SELECT t.reset();
SELECT t.eq((SELECT is_private FROM public.reviews WHERE reviewer_id = t.id('adultrev') AND reviewee_id = t.id('adultpeer')::text), false,
  'and that review is created normally (verified by the trigger, public)');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('adultpeer')::text)), 1,
  'and anonymous visitors can read it');

ROLLBACK;
