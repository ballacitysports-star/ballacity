-- P2-1 stage 4c (supabase/migrations/20261107200000_events_stage4c_evaluation_writes.sql).
-- It covers:
--   * team staff save an evaluation through events, and it is written back to tryout_evaluations, once;
--   * players, other teams' staff and strangers cannot; unregistered people cannot be scored;
--   * a copied tryout keeps today's limits (score 1-10, notes up to 1000);
--   * the old path (writing tryout_evaluations) still reaches events, and the two mirrors do not loop;
--   * a registration made through events picks up an evaluation written before it;
--   * deleting a post with scored sign-ups still works;
--   * events created as events: 0-100 scores, and nothing written to tryout_evaluations.
BEGIN;

-- ---- setup ------------------------------------------------------------------------
SELECT t.person('coach', 35), t.person('kid', 11), t.person('kid2', 10), t.person('kid3', 12),
       t.person('othercoach', 40), t.person('stranger', 39);
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('cubs', t.id('coach'), 'team', 'Cubs', 'cubs', ARRAY['youth']),
       ('rivals', t.id('othercoach'), 'team', 'Rivals', 'rivals', ARRAY['youth']);
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, moderation_status, cancel_cutoff_min)
VALUES (t.id('p-youth'), 'cubs', t.id('coach'), 'tryout', 'U12 tryout', now() + interval '5 days', 'approved', 0),
       (t.id('p-gone'), 'cubs', t.id('coach'), 'tryout', 'Deleted tryout', now() + interval '6 days', 'approved', 0);
INSERT INTO public.tryout_rsvps (id, post_id, team_id, user_id, registered_by, status)
VALUES (t.id('rsvp-kid'), t.id('p-youth'), 'cubs', t.id('kid'), t.id('coach'), 'registered'),
       (t.id('rsvp-kid2'), t.id('p-youth'), 'cubs', t.id('kid2'), t.id('coach'), 'registered'),
       (t.id('rsvp-gone'), t.id('p-gone'), 'cubs', t.id('kid'), t.id('coach'), 'registered');
CREATE TEMP TABLE ev ON COMMIT DROP AS
  SELECT legacy_post_id AS post, id FROM public.events WHERE legacy_post_id IN (t.id('p-youth'), t.id('p-gone'));
GRANT SELECT ON ev TO anon, authenticated;
CREATE TEMP VIEW youth AS SELECT id FROM ev WHERE post = t.id('p-youth');
GRANT SELECT ON youth TO anon, authenticated;

CREATE TEMP VIEW kid_eval AS
  SELECT (SELECT attended || '|' || score || '|' || notes || '|' || (updated_by = t.id('coach'))
            FROM public.tryout_evaluations WHERE rsvp_id = t.id('rsvp-kid')) AS old_row,
         (SELECT attended || '|' || score || '|' || notes
            FROM public.event_evaluations v JOIN public.event_registrations g ON g.id = v.registration_id
           WHERE g.user_id = t.id('kid') AND g.event_id = (SELECT id FROM youth)) AS new_row,
         (SELECT count(*)::int FROM public.tryout_evaluations WHERE post_id = t.id('p-youth')) AS old_n,
         (SELECT count(*)::int FROM public.event_evaluations WHERE event_id = (SELECT id FROM youth)) AS new_n;

-- ---- staff save through events ----------------------------------------------------------
SELECT t.as_user(t.id('coach'));
SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), true, 7::smallint, 'Good first touch');
SELECT t.reset();
SELECT t.eq((SELECT old_row FROM kid_eval), 'true|7|Good first touch|true',
  'an evaluation saved through events is written back to tryout_evaluations, by the coach');
SELECT t.eq((SELECT new_row || '#' || old_n || '#' || new_n FROM kid_eval), 'true|7|Good first touch#1#1',
  'and is held once on each side');

SELECT t.as_user(t.id('coach'));
SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), false, 9::smallint, '  ');
SELECT t.reset();
SELECT t.eq((SELECT attended || '|' || score || '|' || coalesce(notes, '<none>')
               FROM public.tryout_evaluations WHERE rsvp_id = t.id('rsvp-kid')),
  'false|9|<none>', 'an edit follows, and blank notes are stored as none');

-- ---- who may ---------------------------------------------------------------------------------
SELECT t.as_user(t.id('kid'));
SELECT t.throws($$SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), true, 10::smallint)$$,
  'NOT_ALLOWED', 'a player cannot score themselves');
SELECT t.reset();
SELECT t.as_user(t.id('othercoach'));
SELECT t.throws($$SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), true, 1::smallint)$$,
  'NOT_ALLOWED', 'another team''s coach cannot score this tryout');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), true, 1::smallint)$$,
  'permission denied', 'anonymous visitors cannot call it');
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT t.throws($$SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('stranger'), true, 5::smallint)$$,
  'NOT_REGISTERED', 'someone who did not sign up cannot be scored');

-- ---- today's limits on a copied tryout -----------------------------------------------------------
SELECT t.throws($$SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), true, 11::smallint)$$,
  'INVALID_EVALUATION', 'a copied tryout keeps today''s 1-10 score');
SELECT t.throws($$SELECT public.save_event_evaluation((SELECT id FROM youth), t.id('kid'), true, 5::smallint, repeat('x', 1001))$$,
  'INVALID_EVALUATION', 'and today''s 1000-character notes');
SELECT t.reset();

-- ---- the old path still reaches events, without looping ------------------------------------------
SELECT t.as_user(t.id('coach'));
INSERT INTO public.tryout_evaluations (rsvp_id, post_id, team_id, attended, score, notes, updated_by)
VALUES (t.id('rsvp-kid2'), t.id('p-youth'), 'cubs', true, 4, 'Old path', t.id('coach'));
SELECT t.reset();
SELECT t.eq((SELECT v.score::int FROM public.event_evaluations v JOIN public.event_registrations g ON g.id = v.registration_id
              WHERE g.user_id = t.id('kid2')), 4, 'an evaluation written the old way still reaches events');
SELECT t.eq((SELECT old_n || '|' || new_n FROM kid_eval), '2|2', 'and each side holds exactly two');

-- ---- a registration through events picks up an earlier evaluation ----------------------------------
INSERT INTO public.tryout_rsvps (id, post_id, team_id, user_id, registered_by, status)
VALUES (t.id('rsvp-kid3'), t.id('p-youth'), 'cubs', t.id('kid3'), t.id('coach'), 'cancelled');
INSERT INTO public.tryout_evaluations (rsvp_id, post_id, team_id, attended, score, updated_by)
VALUES (t.id('rsvp-kid3'), t.id('p-youth'), 'cubs', false, 3, t.id('coach'));
DELETE FROM public.event_registrations WHERE user_id = t.id('kid3');  -- as if the copy had not happened yet
SELECT t.as_user(t.id('kid3'));
SELECT public.register_for_event((SELECT id FROM youth));
SELECT t.reset();
SELECT t.eq((SELECT v.score::int FROM public.event_evaluations v JOIN public.event_registrations g ON g.id = v.registration_id
              WHERE g.user_id = t.id('kid3')), 3, 'signing up through events picks up the earlier evaluation');
SELECT t.eq((SELECT score::int FROM public.tryout_evaluations WHERE rsvp_id = t.id('rsvp-kid3')), 3,
  'and leaves the original as it was');

-- ---- deleting a scored post still works ---------------------------------------------------------------
SELECT t.as_user(t.id('coach'));
SELECT public.save_event_evaluation((SELECT id FROM ev WHERE post = t.id('p-gone')), t.id('kid'), true, 6::smallint);
SELECT t.reset();
DELETE FROM public.team_posts WHERE id = t.id('p-gone');
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id = t.id('p-gone'))
            + (SELECT count(*)::int FROM public.tryout_evaluations WHERE rsvp_id = t.id('rsvp-gone')), 0,
  'deleting a post with scored sign-ups removes it and its copies');

-- ---- events created as events ------------------------------------------------------------------------
SELECT t.as_user(t.id('coach'));
CREATE TEMP TABLE native ON COMMIT DROP AS
  SELECT public.create_event('cubs', jsonb_build_object('kind', 'clinic', 'title', 'Native clinic',
    'min_age', 10, 'max_age', 14, 'starts_at', now() + interval '9 days')) AS id;
SELECT t.reset();
GRANT SELECT ON native TO anon, authenticated;
UPDATE public.events SET moderation_status = 'approved' WHERE id = (SELECT id FROM native);
SELECT t.as_user(t.id('kid'));
SELECT public.register_for_event((SELECT id FROM native));
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT public.save_event_evaluation((SELECT id FROM native), t.id('kid'), true, 85::smallint, 'Native');
SELECT t.reset();
SELECT t.eq((SELECT score::int FROM public.event_evaluations WHERE event_id = (SELECT id FROM native)), 85,
  'an event created as an event takes a 0-100 score');
SELECT t.eq((SELECT count(*)::int FROM public.tryout_evaluations WHERE notes = 'Native'), 0,
  'and is not written to tryout_evaluations');

SELECT t.eq((SELECT count(*)::int FROM private_sec.event_mirror_failures), 0, 'no mirror failures');

ROLLBACK;
