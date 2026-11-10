-- P2-1 stage 4a (supabase/migrations/20261107180000_events_stage4a_registration_writes.sql).
-- It covers:
--   * the events_v2_writes switch exists, is off and is publicly readable;
--   * on a copied tryout, register_for_event keeps today's rules (owner decision): no age check, the post's
--     seat counter, hidden posts refused, cancelling nothing is not an error;
--   * every sign-up and cancel through events is written back to tryout_rsvps and spots_taken, once;
--   * late cancellations are still recorded; guardians still sign up their children;
--   * the old path still works and is mirrored once (the two mirrors do not feed each other);
--   * events created as events still enforce the age range (D1).
BEGIN;

-- ---- the switch -----------------------------------------------------------------
SELECT t.eq((SELECT value->>'enabled' FROM public.app_settings WHERE key = 'events_v2_writes'), 'false',
  'the events_v2_writes switch exists and is off');
SELECT t.as_anon();
SELECT t.eq(t.count($$SELECT 1 FROM public.app_settings WHERE key = 'events_v2_writes'$$), 1,
  'anyone can read the writes switch');
SELECT t.reset();

-- ---- setup ------------------------------------------------------------------------
SELECT t.person('coach', 35), t.person('teen', 13), t.person('adult', 28), t.person('kid', 11),
       t.person('parent', 41), t.person('kid2', 10), t.person('stranger', 40), t.person('owner', 45);
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobirthday'), 'nobirthday4a@example.test', now(),
        jsonb_build_object('display_name', 'Nobirthday', 'account_type', 'player'));
SELECT t.guardian('parent', 'kid');
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('cubs', t.id('coach'), 'team', 'Cubs', 'cubs', ARRAY['youth']),
       ('grown', t.id('owner'), 'team', 'Grown', 'grown', ARRAY['adult']);

INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, location, moderation_status,
                               spots_max, cancel_cutoff_min)
VALUES (t.id('p-youth'), 'cubs', t.id('coach'), 'tryout', 'U12 tryout', now() + interval '5 days', 'School Field',
        'approved', 3, 10080),
       (t.id('p-adult'), 'grown', t.id('owner'), 'clinic', 'Adult clinic', now() + interval '6 days', 'City Gym',
        'approved', NULL, 0);
CREATE TEMP TABLE ev ON COMMIT DROP AS
  SELECT legacy_post_id AS post, id FROM public.events WHERE legacy_post_id IN (t.id('p-youth'), t.id('p-adult'));
GRANT SELECT ON ev TO anon, authenticated;
CREATE TEMP VIEW youth AS SELECT id FROM ev WHERE post = t.id('p-youth');
GRANT SELECT ON youth TO anon, authenticated;

CREATE TEMP VIEW state AS
  SELECT (SELECT spots_taken FROM public.team_posts WHERE id = t.id('p-youth')) AS spots,
         (SELECT count(*)::int FROM public.tryout_rsvps WHERE post_id = t.id('p-youth') AND status = 'registered') AS rsvps,
         (SELECT count(*)::int FROM public.event_registrations r JOIN youth ON youth.id = r.event_id
           WHERE r.status = 'registered') AS regs;

-- ---- today's rules on a copied tryout ------------------------------------------------------
SELECT t.as_user(t.id('nobirthday'));
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM youth))) IS NOT NULL,
  'someone with no birthday on file can sign up for a copied tryout, as today');
SELECT t.reset();
SELECT t.eq((SELECT spots || '|' || rsvps || '|' || regs FROM state), '1|1|1',
  'the sign-up is written back to tryout_rsvps and spots_taken, once');

SELECT t.as_user(t.id('teen'));
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM youth))) IS NOT NULL,
  'a 13-year-old can sign up for a youth (4-12) team''s copied tryout, as today');
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM youth))', 'ALREADY_REGISTERED',
  'signing up twice is refused');
SELECT t.reset();

SELECT t.as_user(t.id('parent'));
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM youth), t.id('kid'))) IS NOT NULL,
  'a guardian signs up their child');
SELECT t.reset();
SELECT t.eq((SELECT registered_by FROM public.tryout_rsvps WHERE post_id = t.id('p-youth') AND user_id = t.id('kid')),
  t.id('parent'), 'tryout_rsvps records the guardian who signed up');
SELECT t.eq((SELECT spots || '|' || rsvps || '|' || regs FROM state), '3|3|3', 'three seats taken, in all three places');

SELECT t.as_user(t.id('kid2'));
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM youth))', 'EVENT_FULL',
  'the post''s seat counter still decides when it is full');
SELECT t.reset();

-- ---- cancelling ---------------------------------------------------------------------------------
SELECT t.as_user(t.id('teen'));
SELECT public.cancel_event_registration((SELECT id FROM youth));
SELECT t.reset();
SELECT t.eq((SELECT status FROM public.tryout_rsvps WHERE post_id = t.id('p-youth') AND user_id = t.id('teen')),
  'cancelled', 'a cancellation is written back to tryout_rsvps');
SELECT t.eq((SELECT spots || '|' || rsvps || '|' || regs FROM state), '2|2|2', 'and frees the seat');
SELECT t.eq((SELECT count(*)::int FROM public.late_cancellations WHERE ref_id = t.id('p-youth')::text AND user_id = t.id('teen')),
  1, 'a cancellation inside the cutoff is still recorded as late');
SELECT t.as_user(t.id('teen'));
SELECT t.ok((SELECT count(*) FROM (SELECT public.cancel_event_registration((SELECT id FROM youth))) c) = 1,
  'cancelling with nothing to cancel is not an error on a copied tryout, as today');
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM youth))) IS NOT NULL, 'signing up again works');
SELECT t.reset();
SELECT t.eq((SELECT spots || '|' || rsvps || '|' || regs FROM state), '3|3|3', 'and takes the seat again');

-- ---- the old path, still mirrored once ------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT public.rsvp_tryout(t.id('p-adult'));
SELECT t.reset();
SELECT t.eq((SELECT spots_taken || '|'
                 || (SELECT count(*) FROM public.tryout_rsvps WHERE post_id = t.id('p-adult')) || '|'
                 || (SELECT count(*) FROM public.event_registrations r JOIN ev ON ev.id = r.event_id
                      WHERE ev.post = t.id('p-adult'))
               FROM public.team_posts WHERE id = t.id('p-adult')),
  '1|1|1', 'an old-path sign-up is copied to events once and its seat is counted once');

-- ---- hidden posts --------------------------------------------------------------------------------------
UPDATE public.team_posts SET hidden_at = now() WHERE id = t.id('p-adult');
SELECT t.as_user(t.id('adult'));
SELECT t.throws($$SELECT public.register_for_event((SELECT id FROM ev WHERE post = t.id('p-adult')))$$,
  'EVENT_NOT_FOUND', 'a hidden post cannot be signed up for through events');
SELECT t.reset();

-- ---- events created as events keep the age range (D1) ----------------------------------------------------
SELECT t.as_user(t.id('coach'));
CREATE TEMP TABLE native ON COMMIT DROP AS
  SELECT public.create_event('cubs', jsonb_build_object('kind', 'clinic', 'title', 'Native clinic',
    'min_age', 10, 'max_age', 14, 'starts_at', now() + interval '9 days')) AS id;
SELECT t.reset();
GRANT SELECT ON native TO anon, authenticated;
UPDATE public.events SET moderation_status = 'approved' WHERE id = (SELECT id FROM native);
SELECT t.as_user(t.id('nobirthday'));
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM native))', 'AGE_UNKNOWN',
  'an event created as an event still needs a birthday');
SELECT t.reset();
SELECT t.as_user(t.id('adult'));
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM native))', 'OUTSIDE_AGE_RANGE',
  'and still enforces its age range');
SELECT t.reset();
SELECT t.as_user(t.id('teen'));
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM native))) IS NOT NULL, 'an in-range player signs up');
SELECT t.throws('SELECT public.cancel_event_registration((SELECT id FROM native), t.id(''kid2''))', 'NOT_ALLOWED',
  'a player cannot cancel someone else');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.tryout_rsvps WHERE user_id = t.id('teen')), 1,
  'a native event''s registration is not written to tryout_rsvps');

SELECT t.eq((SELECT count(*)::int FROM private_sec.event_mirror_failures), 0, 'no mirror failures');

ROLLBACK;
