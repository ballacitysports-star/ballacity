-- P2-1 stage 2: team tryouts and clinics are copied into events and kept in step
-- (supabase/migrations/20261107120000_events_stage2_backfill_mirror.sql).
-- It covers:
--   * the age range each copy gets from its team (D1), with youth teams' venues staying
--     private (D0);
--   * that the venue never becomes the public label;
--   * that edits, kind changes, deletes, RSVPs and availability follow;
--   * that a copy that cannot be made is logged, not fatal;
--   * that the backfill is idempotent;
--   * that nothing is callable or readable by clients.
BEGIN;

SELECT t.person('owner', 40), t.person('adultplayer', 28), t.person('coach', 35),
       t.person('kid', 11), t.person('teen', 15), t.person('stranger', 33);

-- Adult team: listed for adults, an adult player, no minors.
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('grown', t.id('owner'), 'team', 'Grown', 'grown', ARRAY['adult']);
SELECT t.member('grown', 'adultplayer', 'player');
-- Youth team: listed for youth, a child on the roster.
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('cubs', t.id('coach'), 'team', 'Cubs', 'cubs', ARRAY['youth']);
SELECT t.member('cubs', 'kid', 'player');
-- Mixed team: teens and adults, with a teen on it, so not known adult-only.
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('mixed', t.id('owner'), 'team', 'Mixed', 'mixed', ARRAY['teen', 'adult']);
SELECT t.member('mixed', 'teen', 'player');
-- New team: owner only, no age groups.
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES ('fresh', t.id('coach'), 'team', 'Fresh', 'fresh');

INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, location, formatted_address, lat, lng, price, spots_max, moderation_status)
VALUES (t.id('post-adult'), 'grown', t.id('owner'), 'tryout', 'Adult tryout', now() + interval '5 days', 'Main Gym', '1 Main St', 40.1, -73.9, 15, 20, 'approved');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, location, moderation_status)
VALUES (t.id('post-youth'), 'cubs', t.id('coach'), 'clinic', 'U12 clinic', now() + interval '6 days', 'School Field, 9 Oak Rd', 'approved');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, moderation_status)
VALUES (t.id('post-mixed'), 'mixed', t.id('owner'), 'tryout', 'Open tryout', now() + interval '7 days', 'approved'),
       (t.id('post-fresh'), 'fresh', t.id('coach'), 'tryout', 'First tryout', now() + interval '8 days', 'approved');
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, moderation_status)
VALUES (t.id('post-notice'), 'grown', t.id('owner'), 'announcement', 'Hello', 'approved');

-- ---- copies made by the mirror on insert -------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id IN (t.id('post-adult'), t.id('post-youth'), t.id('post-mixed'), t.id('post-fresh'), t.id('post-notice'))), 4,
  'each tryout and clinic gets an event; the announcement does not');
SELECT t.eq((SELECT min_age || '-' || max_age FROM public.events WHERE legacy_post_id = t.id('post-adult')),
  '18-99', 'an adult-only team''s event is 18 to 99');
SELECT t.eq((SELECT min_age || '-' || max_age FROM public.events WHERE legacy_post_id = t.id('post-youth')),
  '4-12', 'a youth team''s event takes the youth range');
SELECT t.eq((SELECT min_age || '-' || max_age FROM public.events WHERE legacy_post_id = t.id('post-mixed')),
  '13-99', 'a teen-and-adult team with a teen on it is youth: its minimum stays under 18');
SELECT t.eq((SELECT min_age || '-' || max_age FROM public.events WHERE legacy_post_id = t.id('post-fresh')),
  '4-99', 'a new team with no age groups is youth until known otherwise');
SELECT t.eq((SELECT kind || '|' || title || '|' || price_cents || '|' || capacity || '|' || moderation_status || '|' || coalesce(venue_label, '(none)')
               FROM public.events WHERE legacy_post_id = t.id('post-adult')),
  'tryout|Adult tryout|1500|20|approved|(none)', 'fields are copied, price in cents, and the public venue label stays empty');
SELECT t.eq((SELECT formatted_address || '|' || lat FROM public.event_locations l JOIN public.events e ON e.id = l.event_id
               WHERE e.legacy_post_id = t.id('post-adult')),
  '1 Main St|40.1', 'the exact venue goes to event_locations');
SELECT t.eq((SELECT formatted_address FROM public.event_locations l JOIN public.events e ON e.id = l.event_id
               WHERE e.legacy_post_id = t.id('post-youth')),
  'School Field, 9 Oak Rd', 'a post with only a free-text location keeps it as the exact (private) venue');

-- ---- venue privacy carries over (D0) -------------------------------------------------
SELECT t.as_anon();
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM public.events WHERE legacy_post_id = t.id('post-youth')))), 0,
  'an anonymous visitor gets no venue for the copied youth clinic');
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM public.events WHERE legacy_post_id = t.id('post-adult')))),
  '1 Main St', 'but does for the adult-only tryout');
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 1, 'and sees only the adult-only event');
SELECT t.reset();

-- ---- edits follow -----------------------------------------------------------------------
UPDATE public.team_posts SET title = 'Adult tryout (moved)', moderation_status = 'held', spots_max = 25
 WHERE id = t.id('post-adult');
SELECT t.eq((SELECT title || '|' || moderation_status || '|' || capacity FROM public.events WHERE legacy_post_id = t.id('post-adult')),
  'Adult tryout (moved)|held|25', 'title, moderation and capacity edits follow');
UPDATE public.team_posts SET location = NULL, formatted_address = NULL, lat = NULL, lng = NULL
 WHERE id = t.id('post-adult');
SELECT t.eq((SELECT count(*)::int FROM public.event_locations l JOIN public.events e ON e.id = l.event_id
               WHERE e.legacy_post_id = t.id('post-adult')), 0, 'clearing the venue clears the copy''s venue');
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'grown';
UPDATE public.team_posts SET title = 'Adult tryout' WHERE id = t.id('post-adult');
SELECT t.eq((SELECT min_age || '-' || max_age FROM public.events WHERE legacy_post_id = t.id('post-adult')),
  '18-99', 'the age range is set once, not recomputed on later edits');
UPDATE public.teams SET age_groups = ARRAY['adult'] WHERE id = 'grown';

-- ---- registrations follow ------------------------------------------------------------------
INSERT INTO public.tryout_rsvps (post_id, team_id, user_id, registered_by, status)
VALUES (t.id('post-youth'), 'cubs', t.id('kid'), t.id('coach'), 'registered');
SELECT t.eq((SELECT status FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
               WHERE e.legacy_post_id = t.id('post-youth') AND r.user_id = t.id('kid')),
  'registered', 'an RSVP becomes a registration');
UPDATE public.tryout_rsvps SET status = 'cancelled' WHERE post_id = t.id('post-youth') AND user_id = t.id('kid');
SELECT t.eq((SELECT status FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
               WHERE e.legacy_post_id = t.id('post-youth') AND r.user_id = t.id('kid')),
  'cancelled', 'a cancellation follows');
DELETE FROM public.tryout_rsvps WHERE post_id = t.id('post-youth') AND user_id = t.id('kid');
SELECT t.eq((SELECT count(*)::int FROM public.event_registrations r JOIN public.events e ON e.id = r.event_id
               WHERE e.legacy_post_id = t.id('post-youth')), 0, 'a deleted RSVP removes the registration');

-- ---- availability follows -------------------------------------------------------------------
INSERT INTO public.team_event_availability (post_id, team_id, user_id, status, note, set_by)
VALUES (t.id('post-youth'), 'cubs', t.id('kid'), 'maybe', 'After school', t.id('kid'));
UPDATE public.team_event_availability SET status = 'available' WHERE post_id = t.id('post-youth');
SELECT t.eq((SELECT a.status || '|' || a.note FROM public.event_availability a JOIN public.events e ON e.id = a.event_id
               WHERE e.legacy_post_id = t.id('post-youth')), 'available|After school', 'availability and its edits follow');
DELETE FROM public.team_event_availability WHERE post_id = t.id('post-youth');
SELECT t.eq((SELECT count(*)::int FROM public.event_availability a JOIN public.events e ON e.id = a.event_id
               WHERE e.legacy_post_id = t.id('post-youth')), 0, 'and so does its removal');

-- ---- kind change and delete --------------------------------------------------------------------
UPDATE public.team_posts SET kind = 'announcement' WHERE id = t.id('post-fresh');
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id = t.id('post-fresh')), 0,
  'a tryout turned into an announcement loses its event');
DELETE FROM public.team_posts WHERE id = t.id('post-mixed');
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id = t.id('post-mixed')), 0,
  'deleting a post deletes its event');
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id IS NULL AND host_ref = 'mixed'), 0,
  'and leaves no unlinked copy behind');

-- ---- a copy that cannot be made is logged, and the post is still saved -----------------------------
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, price, moderation_status)
VALUES (t.id('post-pricey'), 'grown', t.id('owner'), 'clinic', 'Gold clinic', 200000, 'approved');
SELECT t.eq((SELECT count(*)::int FROM public.team_posts WHERE id = t.id('post-pricey')), 1,
  'a post whose copy fails is still saved');
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id = t.id('post-pricey')), 0,
  'it has no event');
SELECT t.ok((SELECT error LIKE '23514%' FROM private_sec.event_mirror_failures WHERE source_id = t.id('post-pricey')::text),
  'and the failure is logged with its error code');

-- ---- backfill is idempotent --------------------------------------------------------------------
SET LOCAL session_replication_role = replica;  -- a post written without the mirror, as before this migration
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, moderation_status)
VALUES (t.id('post-old'), 'cubs', t.id('coach'), 'tryout', 'Old tryout', 'approved');
SET LOCAL session_replication_role = origin;
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id = t.id('post-old')), 0,
  'a post written with the mirror off has no event yet');
SELECT t.lives('SELECT * FROM private_sec.events_backfill_from_team_posts()', 'the backfill runs');
SELECT t.lives('SELECT * FROM private_sec.events_backfill_from_team_posts()', 'and runs again');
SELECT t.eq((SELECT count(*)::int FROM public.events WHERE legacy_post_id = t.id('post-old')), 1,
  'the backfill copies it exactly once');
SELECT t.eq((SELECT count(*)::int FROM public.events e JOIN public.team_posts tp ON tp.id = e.legacy_post_id),
            (SELECT count(*)::int FROM public.team_posts WHERE kind IN ('tryout', 'clinic')) - 1,
  'every tryout and clinic has one event, except the one whose copy fails');

-- ---- nothing for clients -------------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM private_sec.event_mirror_failures'), 0, 'a member cannot read the failure log');
SELECT t.throws(format('SELECT private_sec.mirror_team_post(%L)', t.id('post-adult')),
  'permission denied', 'a member cannot run the mirror');
SELECT t.throws('SELECT * FROM private_sec.events_backfill_from_team_posts()', 'permission denied', 'or the backfill');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws('SELECT * FROM private_sec.events_backfill_from_team_posts()', 'permission denied', 'nor can an anonymous visitor');
SELECT t.reset();

ROLLBACK;
