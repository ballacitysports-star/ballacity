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
       t.person('guardian14', 40), t.person('guardian8', 41),
       t.person('revokedguard', 42), t.person('unverifiedguard', 43);
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
SELECT t.reset();
-- The server releases a review after its AI screening (hotfix 0032); do the same here.
SELECT public.release_review_screening(r.id, r.title, r.body) FROM public.reviews r
 WHERE r.reviewer_id = t.id('adultrev') AND r.reviewee_id = t.id('adultsubj')::text;
SELECT t.as_user(t.id('adultrev'));
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
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('teen14'))), 0,
  'even the server''s statistics do not count the preserved historical review about a minor (protected content feeds no aggregate)');
SELECT t.eq((SELECT positive FROM public.player_trait_counts(t.id('teen14'))), 0, 'nor its trait counts');

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
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('adultpeer')::text)), 0,
  'a review written directly is held until the server has screened it (hotfix 0032 still applies)');
SELECT t.reset();
-- The server releases a review after its AI screening (hotfix 0032); do the same here.
SELECT public.release_review_screening(r.id, r.title, r.body) FROM public.reviews r
 WHERE r.reviewer_id = t.id('adultrev') AND r.reviewee_id = t.id('adultpeer')::text;
SELECT t.eq((SELECT is_private FROM public.reviews WHERE reviewer_id = t.id('adultrev') AND reviewee_id = t.id('adultpeer')::text), false,
  'and that review is created normally (verified by the trigger, public)');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('adultpeer')::text)), 1,
  'and anonymous visitors can read it');

-- ---- 9. guardian access is decided by the link, on the server --------------------------------
-- A revoked link and an unverified link give a "guardian" nothing; only a verified, active link does.
SELECT t.reset();
INSERT INTO public.guardian_links (parent_user_id, child_user_id, relationship, status, verified_at) VALUES
  (t.id('revokedguard'), t.id('teen14'), 'parent', 'revoked', now()),
  (t.id('unverifiedguard'), t.id('teen14'), 'parent', 'active', NULL);
SELECT t.as_user(t.id('revokedguard'));
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('teen14'))), 0, 'a guardian whose link was revoked gets no attendance counts');
SELECT t.as_user(t.id('unverifiedguard'));
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('teen14'))), 0, 'an active but unverified link gets none');
SELECT t.as_user(t.id('guardian14'));
SELECT t.eq((SELECT games_joined FROM public.player_activity_stats(t.id('teen14'))), 1, 'the verified, active guardian does (control)');
SELECT t.reset();

-- ---- 10. adult review features still work -------------------------------------------------------
SELECT t.member('tm', 'adultpeer');
SELECT t.as_user(t.id('adultpeer'));
SELECT t.lives(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'team', 'tm', 'Team', 5, 'A well run team with good vibes.')$q$, t.id('adultpeer')),
  'an adult team member can review the team');
SELECT t.lives(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'host', %L, 'Host', 4, 'Well organised and started on time.', 'g-rv')$q$, t.id('adultpeer'), t.id('adultrev')::text),
  'an adult who played in a game can review its adult host');
SELECT t.reset();
-- The server releases a review after its AI screening (hotfix 0032); do the same here.
SELECT public.release_review_screening(r.id, r.title, r.body) FROM public.reviews r
 WHERE r.reviewer_id = t.id('adultpeer') AND r.reviewee_id = t.id('adultrev')::text AND r.reviewee_kind = 'host';
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(format('SELECT public.report_review(%L)', t.id('r-adult-pub')), 'any adult member can still report a public review');
SELECT t.as_anon();
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE reviewee_id = %L AND reviewee_kind = 'host'$q$, t.id('adultrev')::text)), 1,
  'the host review about an adult is public');
SELECT t.reset();


-- ---- 11. a team or gym keyed to a minor's account id cannot carry public text about them -------------
-- teams.id and trainer_orgs.id are chosen by whoever creates them, so the id of a "team" can be a child's user id.
SELECT t.reset();
SELECT t.person('gymowner', 45);
SELECT t.as_user(t.id('adultrev'));
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES (t.id('teen14')::text, t.id('adultrev'), 'team', 'NotAKid', 'notakid');
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'team', %L, 'x', 1, 'He is a terrible person, avoid him.')$q$, t.id('adultrev'), t.id('teen14')::text),
  'not available for this person', 'a team whose id is a 14-year-old''s user id cannot be reviewed');
SELECT t.reset();
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('teen14'), t.id('gymowner'), 'Innocent Gym', 'innocentgym');
SELECT t.as_user(t.id('adultpeer'));
SELECT t.throws(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (%L, 'player', 'gym', %L, 'x', 1, 'He is a terrible person, avoid him.')$q$, t.id('adultpeer'), t.id('teen14')::text),
  'not available for this person', 'nor a gym whose id is a 14-year-old''s user id');
-- the same pair, written historically, is hidden from everyone, and so is a summary keyed the same way
SELECT t.reset();
SET LOCAL session_replication_role = replica;
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, is_private, verified, flagged) VALUES
  (t.id('r-team-keyed'), t.id('adultrev'),  'player', 'team', t.id('teen14')::text, 'x', 1, 'He is a terrible person, avoid him.', false, true, false),
  (t.id('r-gym-keyed'),  t.id('adultpeer'), 'player', 'gym',  t.id('teen14')::text, 'x', 1, 'He is a terrible person, avoid him.', false, true, false),
  (t.id('r-team-adultkeyed'), t.id('adultrev'), 'player', 'team', t.id('adultsubj')::text, 'x', 5, 'A well run team with good vibes.', false, true, false);
INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model) VALUES
  (t.id('teen14')::text, 'team', 'Keyed to a minor.', ARRAY['x'], ARRAY['y'], 1, 'fixture'),
  (t.id('adultsubj')::text, 'team', 'Keyed to an adult.', ARRAY['x'], ARRAY['y'], 1, 'fixture');
SET LOCAL session_replication_role = origin;
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('teen14')::text)), 0, 'anonymous: nothing keyed to the 14-year-old''s id, whatever the kind');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reputation_insights WHERE reviewee_id = %L AND reviewee_kind = 'team'$q$, t.id('teen14')::text)), 0, 'anonymous: no team-kind summary keyed to the 14-year-old');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE id = %L', t.id('r-team-adultkeyed'))), 1, 'a team keyed to an ADULT''s id stays visible (control)');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reputation_insights WHERE reviewee_id = %L AND reviewee_kind = 'team'$q$, t.id('adultsubj')::text)), 1, 'and so does its summary');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('teen14')::text)), 0, 'a member: the same');
-- the offer list does not name the child through such a team, nor offer it
SELECT t.as_user(t.id('adultrev'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.my_reviewable(NULL, %L)', t.id('teen14')::text)), 0, 'my_reviewable does not offer a team keyed to a minor''s id');
SELECT t.reset();

-- ---- 12. a private review written by a minor is not readable by its adult subject --------------------
SET LOCAL session_replication_role = replica;
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, is_private, verified, flagged) VALUES
  (t.id('r-priv-by-teen'),  t.id('teen17'),   'player', 'player', t.id('adultsubj')::text, 'Adult', 3, 'Kept to themselves a lot today.', true, true, false),
  (t.id('r-priv-by-adult'), t.id('adultrev'), 'player', 'player', t.id('adultsubj')::text, 'Adult', 3, 'Kept to themselves a lot today.', true, true, false);
INSERT INTO public.review_ai_analysis (review_id, traits, sentiment, mismatch, model) VALUES
  (t.id('r-priv-by-teen'), ARRAY['positive'], 0.1, false, 'fixture'), (t.id('r-priv-by-adult'), ARRAY['positive'], 0.1, false, 'fixture');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('adultsubj'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE id = %L', t.id('r-priv-by-teen'))), 0, 'the adult subject cannot read a private review written by a minor (or learn the minor''s id)');
SELECT t.eq(t.count(format('SELECT 1 FROM public.review_ai_analysis WHERE review_id = %L', t.id('r-priv-by-teen'))), 0, 'nor its analysis');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE id = %L', t.id('r-priv-by-adult'))), 1, 'a private review written by an adult is still readable by its subject (control)');
SELECT t.reset();

-- ---- 13. gym admins do not read gym reviews written by a minor --------------------------------------
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES (t.id('gym1'), t.id('gymowner'), 'Gym One', 'gymone');
SET LOCAL session_replication_role = replica;
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, is_private, verified, flagged) VALUES
  (t.id('r-gym1-by-teen'),  t.id('teen17'),   'player', 'gym', t.id('gym1')::text, 'Gym One', 4, 'Clean courts and friendly staff.', false, true, false),
  (t.id('r-gym1-by-adult'), t.id('adultrev'), 'player', 'gym', t.id('gym1')::text, 'Gym One', 4, 'Clean courts and friendly staff.', false, true, false);
INSERT INTO public.review_ai_analysis (review_id, traits, sentiment, mismatch, model) VALUES (t.id('r-gym1-by-teen'), ARRAY['positive'], 0.5, false, 'fixture');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('gymowner'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('gym1')::text)), 1, 'the gym owner reads the adult-authored review only');
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE id = %L', t.id('r-gym1-by-teen'))), 0, 'not the one written by a minor (no minor id, no analysis)');
SELECT t.eq(t.count(format('SELECT 1 FROM public.review_ai_analysis WHERE review_id = %L', t.id('r-gym1-by-teen'))), 0, 'and no analysis of it');
SELECT t.as_anon();
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE reviewee_id = %L', t.id('gym1')::text)), 1, 'anonymous: the same one');
SELECT t.reset();

-- ---- 14. host attendance statistics follow the same rule ------------------------------------------
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, status, completed_at)
VALUES ('g-teenhost', t.id('teen17'), 'basketball', 'teen host game', now() - interval '3 days', 13, 17, 'completed', now() - interval '3 days');
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id, attended) VALUES ('g-teenhost', t.id('teen16'), true);
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT marked + attended + completed_games FROM public.host_attendance_stats(t.id('teen17'))), 0, 'host stats about a 16-17 host, asked by a member: zeros');
SELECT t.eq((SELECT completed_games FROM public.host_attendance_stats(t.id('adultrev'))), 1, 'an adult host''s stats are unchanged for a member (control)');
SELECT t.as_user(t.id('teen17'));
SELECT t.eq((SELECT completed_games FROM public.host_attendance_stats(t.id('teen17'))), 1, 'the 16-17 host sees their own');
SELECT t.as_anon();
SELECT t.throws(format('SELECT * FROM public.host_attendance_stats(%L)', t.id('adultrev')), 'permission denied', 'anonymous visitors still cannot call it');
SELECT t.reset();



-- ==== 9. PERMANENT protection: content from the time someone was a minor never becomes public ====
-- "grad" is 18 now and was 17 two months ago; "fraud" is 17 and will have a birthday "correction"; "noage" has no birthday.
SELECT t.person('grad', 18), t.person('fraud', 17), t.person('peer30', 30), t.person('peer31', 31);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data) VALUES (t.id('noage'), 'noage@example.test', now(), '{"display_name":"Noage","account_type":"player"}');
-- written while "grad" was a minor: by them, and about them (inserted by the server, as legacy rows would be)
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, created_at) VALUES
  (t.id('h-by-grad'),   t.id('grad'),   'player', 'player', t.id('peer30')::text, 'Peer', 4, 'Written by someone who was 17 then.', now() - interval '2 months'),
  (t.id('h-about-grad'), t.id('peer30'), 'player', 'player', t.id('grad')::text,   'Grad', 4, 'Written about someone who was 17 then.', now() - interval '2 months'),
  (t.id('h-by-noage'),  t.id('noage'),  'player', 'player', t.id('peer30')::text, 'Peer', 4, 'Written by someone of unknown age.', now() - interval '2 months'),
  (t.id('h-adult-old'), t.id('peer31'), 'player', 'player', t.id('peer30')::text, 'Peer', 5, 'Adult to adult, long ago, stays public.', now() - interval '2 months'),
  (t.id('h-adult-new'), t.id('grad'),   'player', 'player', t.id('peer30')::text, 'Peer', 5, 'Written after turning 18, public.', now());
SELECT t.ok((SELECT minor_protected FROM public.reviews WHERE id = t.id('h-by-grad')), 'written by someone who was a minor then: flagged');
SELECT t.ok((SELECT minor_protected FROM public.reviews WHERE id = t.id('h-about-grad')), 'written about someone who was a minor then: flagged');
SELECT t.ok((SELECT minor_protected FROM public.reviews WHERE id = t.id('h-by-noage')), 'written by someone of unknown age: flagged (fail closed)');
SELECT t.ok(NOT (SELECT minor_protected FROM public.reviews WHERE id = t.id('h-adult-old')), 'adult to adult: not flagged');
SELECT t.ok(NOT (SELECT minor_protected FROM public.reviews WHERE id = t.id('h-adult-new')), 'written after turning 18: not flagged');
SELECT t.eq(public.age_cohort_of(t.id('grad')), 'adult', 'fixture: grad is an adult today');
-- nobody but the author sees the protected ones, whatever their age is today
SELECT t.as_anon();
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE id IN (%L, %L, %L)$q$, t.id('h-by-grad'), t.id('h-about-grad'), t.id('h-by-noage'))), 0, 'anonymous: none of the protected reviews');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE id IN (%L, %L)$q$, t.id('h-adult-old'), t.id('h-adult-new'))), 2, 'anonymous: the adult reviews are public');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE id IN (%L, %L, %L)$q$, t.id('h-by-grad'), t.id('h-about-grad'), t.id('h-by-noage'))), 0, 'a signed-in stranger: none of the protected reviews');
SELECT t.as_user(t.id('grad'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE id = %L$q$, t.id('h-about-grad'))), 0, 'the person themself (now 18) does not see the review written about them as a minor');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE id = %L$q$, t.id('h-by-grad'))), 1, 'the author still reads their own text');
SELECT t.reset();
-- AI analysis follows review visibility
INSERT INTO public.review_ai_analysis (review_id, traits, sentiment, mismatch, model) VALUES (t.id('h-about-grad'), ARRAY['respectful'], 0.5, false, 'm');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.review_ai_analysis WHERE review_id = %L$q$, t.id('h-about-grad'))), 0, 'the AI analysis of a protected review is not readable either');
SELECT t.reset();
-- aggregates and statistics count only what may be published
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('peer30'))), 2, 'a review count includes only the unprotected reviews about a person (2 of 4)');
SELECT t.eq((SELECT review_count FROM public.player_activity_stats(t.id('grad'))), 0, 'and nothing protected is counted for the person it was about');
-- a birthday "correction" later cannot publish the protected content, and the flag cannot be cleared
INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body)
  VALUES (t.id('h-by-fraud'), t.id('fraud'), 'player', 'player', t.id('peer30')::text, 'Peer', 3, 'Written at 17, birthday corrected later.');
SELECT t.ok((SELECT minor_protected FROM public.reviews WHERE id = t.id('h-by-fraud')), 'written by a 17-year-old today: flagged');
SET LOCAL session_replication_role = replica;
UPDATE public.profile_birthdays SET birthday = (current_date - interval '40 years')::date WHERE user_id = t.id('fraud');
SET LOCAL session_replication_role = origin;
UPDATE public.profiles SET age_cohort = 'adult', age_category = 'adult' WHERE id = t.id('fraud');
SELECT t.eq(public.age_cohort_of(t.id('fraud')), 'adult', 'fixture: the corrected account now looks like an adult');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reviews WHERE id = %L$q$, t.id('h-by-fraud'))), 0, 'but its earlier review stays hidden (the flag, not the current age, decides)');
SELECT t.reset();
UPDATE public.reviews SET minor_protected = false WHERE id = t.id('h-by-fraud');
SELECT t.ok((SELECT minor_protected FROM public.reviews WHERE id = t.id('h-by-fraud')), 'and the flag cannot be cleared by an update');
-- summaries
INSERT INTO public.reputation_insights (reviewee_id, reviewee_kind, summary, strengths, growth, review_count, model, generated_at) VALUES
  (t.id('grad')::text, 'player', 'Generated while they were 17.', '{}', '{}', 1, 'm', now() - interval '2 months'),
  (t.id('peer30')::text, 'player', 'Generated for an adult.', '{}', '{}', 2, 'm', now());
SELECT t.ok((SELECT minor_protected FROM public.reputation_insights WHERE reviewee_id = t.id('grad')::text), 'a summary generated while its subject was a minor is flagged');
SELECT t.ok(NOT (SELECT minor_protected FROM public.reputation_insights WHERE reviewee_id = t.id('peer30')::text), 'an adult''s summary is not');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reputation_insights WHERE reviewee_id = %L$q$, t.id('grad')::text)), 0, 'the old summary of the new adult is not readable');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reputation_insights WHERE reviewee_id = %L$q$, t.id('peer30')::text)), 1, 'an adult''s summary is');
SELECT t.reset();
-- merely editing other columns cannot clear a flag
UPDATE public.reputation_insights SET minor_protected = false, summary = 'edited' WHERE reviewee_id = t.id('grad')::text;
SELECT t.ok((SELECT minor_protected FROM public.reputation_insights WHERE reviewee_id = t.id('grad')::text), 'editing other columns cannot clear the summary flag');
-- a summary regenerated after 18 (the server builds it from unprotected reviews only) is judged at its own time
UPDATE public.reputation_insights SET summary = 'Regenerated from adult-era reviews.', generated_at = now() WHERE reviewee_id = t.id('grad')::text;
SELECT t.ok(NOT (SELECT minor_protected FROM public.reputation_insights WHERE reviewee_id = t.id('grad')::text), 'a regenerated summary is not flagged');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.reputation_insights WHERE reviewee_id = %L$q$, t.id('grad')::text)), 1, 'and is readable');
SELECT t.reset();
-- helpers: no client can ask about ages or the protection of arbitrary subjects
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT private_sec.was_minor_at(%L, now())$q$, t.id('grad')), 'permission denied', 'a signed-in user cannot ask whether someone was a minor at a time');
SELECT t.throws($q$SELECT private_sec.review_subject_is_public('player', 'x')$q$, 'permission denied', 'nor use the old subject helper');
SELECT t.throws(format($q$SELECT * FROM public.publishable_review_ids(ARRAY[%L]::uuid[])$q$, t.id('h-adult-old')), 'permission denied', 'nor the server-only filter');
SELECT t.as_anon();
SELECT t.throws(format($q$SELECT private_sec.review_author_is_adult(%L)$q$, t.id('grad')), 'permission denied', 'anonymous visitors cannot ask whether an account is an adult');
SELECT t.reset();
SELECT t.as_service();
SELECT t.eq((SELECT count(*)::int FROM public.publishable_review_ids(ARRAY[t.id('h-by-grad'), t.id('h-about-grad'), t.id('h-by-noage'), t.id('h-adult-old'), t.id('h-adult-new'), t.id('h-by-fraud')])), 2, 'the server filter keeps only the 2 unprotected reviews');
SELECT t.reset();
-- adult reviews keep working after all of this
SELECT t.as_user(t.id('adultpeer'));
SELECT t.lives(format($q$INSERT INTO public.reviews (reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id)
  VALUES (%L, 'player', 'player', %L, 'Adult', 5, 'Great again, very reliable.', 'g-rv')$q$, t.id('adultpeer'), t.id('adultrev')::text), 'an adult can still review an adult');
SELECT t.reset();
SELECT t.ok(NOT (SELECT minor_protected FROM public.reviews WHERE body = 'Great again, very reliable.'), 'and the new review is public');

-- ---- 11. both rules together on private reviews (PRIV-1 after hotfix 0032) ----------------------
SELECT t.as_user(t.id('adultpeer'));
SELECT t.lives(format($q$INSERT INTO public.reviews (id, reviewer_id, kind, reviewee_kind, reviewee_id, reviewee_name, rating, body, game_id, is_private)
  VALUES (%L, %L, 'player', 'player', %L, 'Adult', 3, 'Could pass the ball more often.', 'g-rv', true)$q$,
  t.id('held-private'), t.id('adultpeer'), t.id('adultsubj')::text),
  'an adult can leave a private review about an adult');
SELECT t.as_user(t.id('adultsubj'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE id = %L', t.id('held-private'))), 0,
  'while it is held for screening, its subject does not see it');
SELECT t.reset();
SELECT public.release_review_screening(id, title, body) FROM public.reviews WHERE id = t.id('held-private');
SELECT t.as_user(t.id('adultsubj'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.reviews WHERE id = %L', t.id('held-private'))), 1,
  'once released, its subject sees it');
SELECT t.reset();

ROLLBACK;
