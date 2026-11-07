-- P2-1 stage 2: copy team tryouts and clinics into events, and keep the copy in step.
-- Design: docs/design/p2-1-events.md (approved 2026-11-06). Builds on stage 1
-- (20261106220000_events_stage1.sql). The app still reads and writes team_posts,
-- tryout_rsvps and team_event_availability only. Nothing here changes those tables or
-- what any client sees there.
--
-- What it does:
--   1. Backfill. Every team_posts row of kind tryout or clinic gets an events row
--      (legacy_post_id set), its exact venue goes to event_locations, its RSVPs to
--      event_registrations, and its availability to event_availability.
--   2. Mirror. AFTER triggers on the three old tables write the same changes to the new
--      ones, until stage 4 switches writes. The mirror never blocks the original write:
--      if copying fails, the error is recorded in private_sec.event_mirror_failures (no
--      user data, just the source row id and the error) and the old write goes ahead.
--   3. docs/release/p2-1-stage2-verify.sql compares the two sides by counts per team
--      and per post.
--
-- Age range (D1). An event needs one. A backfilled event takes it from its team:
--   * a team known to be adult-only (private_sec.team_is_youth is false): 18 to 99;
--   * any other team is youth, so its minimum is always under 18 (D0: its venue stays
--     private). The range comes from the team's age_groups: youth 4-12, teen 13-17, adult
--     up to 99. No groups at all means 4 to 99.
--   The range is set when the event is first copied and is not recomputed afterwards.
--
-- The venue. team_posts.location is a free-text place, as exact as the address, so it is
-- treated as the exact venue: it goes to event_locations (formatted_address when the post
-- has none), never to the public venue_label, which stays empty for copied events.
--
-- Not copied in this stage: tryout_evaluations (no events counterpart exists yet; stage 3).
-- Mirrored registrations skip register_for_event's age and waiver checks on purpose: they
-- record what the old flow already accepted.
--
-- Rollback: docs/rollbacks/20261107120000_events_stage2_backfill_mirror.down.sql.

-- ---------------------------------------------------------------------------
-- While the copy is mirrored, deleting a post deletes its event. Stage 1 declared
-- ON DELETE SET NULL. The foreign-key action would fire before the mirror trigger and
-- leave an unlinked copy behind. Stage 6 (cleanup) decides what happens after the mirror.
-- ---------------------------------------------------------------------------
ALTER TABLE public.events DROP CONSTRAINT events_legacy_post_id_fkey;
ALTER TABLE public.events ADD CONSTRAINT events_legacy_post_id_fkey
  FOREIGN KEY (legacy_post_id) REFERENCES public.team_posts(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------
-- Failure log
-- ---------------------------------------------------------------------------
CREATE TABLE private_sec.event_mirror_failures (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source text NOT NULL,
  source_id text NOT NULL,
  op text NOT NULL,
  error text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private_sec.event_mirror_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON private_sec.event_mirror_failures TO service_role;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.event_age_range_for_team(_team text, OUT min_age int, OUT max_age int)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _groups text[];
BEGIN
  IF NOT private_sec.team_is_youth(_team) THEN
    min_age := 18; max_age := 99; RETURN;
  END IF;
  SELECT coalesce(t.age_groups, '{}') INTO _groups FROM public.teams t WHERE t.id = _team;
  _groups := coalesce(_groups, '{}');
  min_age := CASE WHEN 'youth' = ANY (_groups) THEN 4
                  WHEN 'teen' = ANY (_groups) THEN 13
                  ELSE 4 END;
  max_age := CASE WHEN 'adult' = ANY (_groups) THEN 99
                  WHEN 'teen' = ANY (_groups) THEN 17
                  WHEN 'youth' = ANY (_groups) THEN 12
                  ELSE 99 END;
END;
$$;

-- Copy one post (insert or refresh). Returns the event id, or NULL when the post is not a
-- tryout or clinic (its event, if any, is removed).
CREATE OR REPLACE FUNCTION private_sec.mirror_team_post(_post uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  p public.team_posts;
  _ev uuid;
  _min int;
  _max int;
BEGIN
  SELECT * INTO p FROM public.team_posts WHERE id = _post;
  IF p.id IS NULL OR p.kind NOT IN ('tryout', 'clinic') THEN
    DELETE FROM public.events WHERE legacy_post_id = _post;
    RETURN NULL;
  END IF;

  SELECT e.id INTO _ev FROM public.events e WHERE e.legacy_post_id = _post;
  IF _ev IS NULL THEN
    SELECT r.min_age, r.max_age INTO _min, _max FROM private_sec.event_age_range_for_team(p.team_id) r;
    INSERT INTO public.events (
      host_kind, host_ref, team_id, kind, title, body, image_url, starts_at, min_age, max_age,
      venue_label, price_cents, currency, capacity, cancel_cutoff_min, refund_rule, late_refund_pct,
      share_scores, share_notes, pinned, author_id, moderation_status, hidden_at, owner_hidden_at,
      moderator_hidden_at, legacy_post_id, created_at, updated_at)
    VALUES (
      'team', p.team_id, p.team_id, p.kind,
      left(coalesce(nullif(btrim(p.title), ''), initcap(p.kind)), 200), left(p.body, 5000), p.image_url,
      p.event_date, _min, _max, NULL, p.price * 100, 'usd',
      CASE WHEN p.spots_max BETWEEN 1 AND 10000 THEN p.spots_max END,
      p.cancel_cutoff_min, p.refund_rule, p.late_refund_pct,
      coalesce(p.share_scores, false), coalesce(p.share_notes, false), coalesce(p.pinned, false),
      p.author_id, p.moderation_status, p.hidden_at, p.owner_hidden_at, p.moderator_hidden_at,
      p.id, p.created_at, p.updated_at)
    RETURNING id INTO _ev;
  ELSE
    UPDATE public.events SET
      kind = p.kind,
      title = left(coalesce(nullif(btrim(p.title), ''), initcap(p.kind)), 200),
      body = left(p.body, 5000),
      image_url = p.image_url,
      starts_at = p.event_date,
      price_cents = p.price * 100,
      capacity = CASE WHEN p.spots_max BETWEEN 1 AND 10000 THEN p.spots_max END,
      cancel_cutoff_min = p.cancel_cutoff_min,
      refund_rule = p.refund_rule,
      late_refund_pct = p.late_refund_pct,
      share_scores = coalesce(p.share_scores, false),
      share_notes = coalesce(p.share_notes, false),
      pinned = coalesce(p.pinned, false),
      moderation_status = p.moderation_status,
      hidden_at = p.hidden_at,
      owner_hidden_at = p.owner_hidden_at,
      moderator_hidden_at = p.moderator_hidden_at
    WHERE id = _ev;
  END IF;

  IF coalesce(p.location, p.formatted_address, p.place_id) IS NOT NULL OR p.lat IS NOT NULL OR p.lng IS NOT NULL THEN
    INSERT INTO public.event_locations (event_id, place_id, formatted_address, lat, lng)
    VALUES (_ev, left(p.place_id, 300), left(coalesce(p.formatted_address, p.location), 300), p.lat, p.lng)
    ON CONFLICT (event_id) DO UPDATE
      SET place_id = EXCLUDED.place_id, formatted_address = EXCLUDED.formatted_address,
          lat = EXCLUDED.lat, lng = EXCLUDED.lng;
  ELSE
    DELETE FROM public.event_locations WHERE event_id = _ev;
  END IF;
  RETURN _ev;
END;
$$;

CREATE OR REPLACE FUNCTION private_sec.mirror_tryout_rsvp(_post uuid, _user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.tryout_rsvps;
  _ev uuid;
BEGIN
  SELECT e.id INTO _ev FROM public.events e WHERE e.legacy_post_id = _post;
  IF _ev IS NULL THEN RETURN; END IF;
  SELECT * INTO r FROM public.tryout_rsvps WHERE post_id = _post AND user_id = _user;
  IF r.id IS NULL THEN
    DELETE FROM public.event_registrations WHERE event_id = _ev AND user_id = _user;
    RETURN;
  END IF;
  INSERT INTO public.event_registrations (event_id, user_id, registered_by, status, waiver_signature_id, created_at)
  VALUES (_ev, r.user_id, r.registered_by, r.status, r.waiver_signature_id, r.created_at)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET registered_by = EXCLUDED.registered_by, status = EXCLUDED.status,
        waiver_signature_id = EXCLUDED.waiver_signature_id;
END;
$$;

CREATE OR REPLACE FUNCTION private_sec.mirror_event_availability(_post uuid, _user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  a public.team_event_availability;
  _ev uuid;
BEGIN
  SELECT e.id INTO _ev FROM public.events e WHERE e.legacy_post_id = _post;
  IF _ev IS NULL THEN RETURN; END IF;
  SELECT * INTO a FROM public.team_event_availability WHERE post_id = _post AND user_id = _user;
  IF a.id IS NULL THEN
    DELETE FROM public.event_availability WHERE event_id = _ev AND user_id = _user;
    RETURN;
  END IF;
  INSERT INTO public.event_availability (event_id, user_id, status, note, set_by, created_at)
  VALUES (_ev, a.user_id, a.status, a.note, a.set_by, a.created_at)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET status = EXCLUDED.status, note = EXCLUDED.note, set_by = EXCLUDED.set_by;
END;
$$;

-- ---------------------------------------------------------------------------
-- Mirror triggers. Each copy runs in a subtransaction: a failure is logged and the
-- original write continues.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.mirror_team_posts_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.kind IN ('tryout', 'clinic') THEN
      DELETE FROM public.events WHERE legacy_post_id = OLD.id;
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.kind NOT IN ('tryout', 'clinic') AND (TG_OP = 'INSERT' OR OLD.kind NOT IN ('tryout', 'clinic')) THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM private_sec.mirror_team_post(_id);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
    VALUES ('team_posts', _id::text, TG_OP, SQLSTATE || ': ' || left(SQLERRM, 300));
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private_sec.mirror_tryout_rsvps_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  _user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
  BEGIN
    PERFORM private_sec.mirror_tryout_rsvp(_post, _user);
    IF TG_OP = 'UPDATE' AND (OLD.post_id, OLD.user_id) IS DISTINCT FROM (NEW.post_id, NEW.user_id) THEN
      PERFORM private_sec.mirror_tryout_rsvp(OLD.post_id, OLD.user_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
    VALUES ('tryout_rsvps', _post::text || '/' || _user::text, TG_OP, SQLSTATE || ': ' || left(SQLERRM, 300));
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private_sec.mirror_event_availability_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  _user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
BEGIN
  BEGIN
    PERFORM private_sec.mirror_event_availability(_post, _user);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
    VALUES ('team_event_availability', _post::text || '/' || _user::text, TG_OP, SQLSTATE || ': ' || left(SQLERRM, 300));
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zz_mirror_events ON public.team_posts;
CREATE TRIGGER zz_mirror_events AFTER INSERT OR UPDATE OR DELETE ON public.team_posts
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_team_posts_trg();
DROP TRIGGER IF EXISTS zz_mirror_event_registrations ON public.tryout_rsvps;
CREATE TRIGGER zz_mirror_event_registrations AFTER INSERT OR UPDATE OR DELETE ON public.tryout_rsvps
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_tryout_rsvps_trg();
DROP TRIGGER IF EXISTS zz_mirror_event_availability ON public.team_event_availability;
CREATE TRIGGER zz_mirror_event_availability AFTER INSERT OR UPDATE OR DELETE ON public.team_event_availability
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_event_availability_trg();

-- ---------------------------------------------------------------------------
-- Backfill (idempotent: an existing copy is refreshed, never duplicated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.events_backfill_from_team_posts()
RETURNS TABLE (posts int, registrations int, availability int, failures int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _p record;
  _r record;
  _a record;
  _posts int := 0; _regs int := 0; _avail int := 0; _fail int := 0;
BEGIN
  FOR _p IN SELECT id FROM public.team_posts WHERE kind IN ('tryout', 'clinic') ORDER BY created_at LOOP
    BEGIN
      PERFORM private_sec.mirror_team_post(_p.id);
      _posts := _posts + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
      VALUES ('team_posts', _p.id::text, 'BACKFILL', SQLSTATE || ': ' || left(SQLERRM, 300));
      _fail := _fail + 1;
    END;
  END LOOP;
  FOR _r IN SELECT post_id, user_id FROM public.tryout_rsvps LOOP
    BEGIN
      PERFORM private_sec.mirror_tryout_rsvp(_r.post_id, _r.user_id);
      _regs := _regs + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
      VALUES ('tryout_rsvps', _r.post_id::text || '/' || _r.user_id::text, 'BACKFILL', SQLSTATE || ': ' || left(SQLERRM, 300));
      _fail := _fail + 1;
    END;
  END LOOP;
  FOR _a IN SELECT post_id, user_id FROM public.team_event_availability LOOP
    BEGIN
      PERFORM private_sec.mirror_event_availability(_a.post_id, _a.user_id);
      _avail := _avail + 1;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
      VALUES ('team_event_availability', _a.post_id::text || '/' || _a.user_id::text, 'BACKFILL', SQLSTATE || ': ' || left(SQLERRM, 300));
      _fail := _fail + 1;
    END;
  END LOOP;
  RETURN QUERY SELECT _posts, _regs, _avail, _fail;
END;
$$;

REVOKE ALL ON FUNCTION private_sec.event_age_range_for_team(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_team_post(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_tryout_rsvp(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_event_availability(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_team_posts_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_tryout_rsvps_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_event_availability_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.events_backfill_from_team_posts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.events_backfill_from_team_posts() TO service_role;

SELECT * FROM private_sec.events_backfill_from_team_posts();
