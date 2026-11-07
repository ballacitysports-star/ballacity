-- P2-1 stage 1: one events model for tryouts, clinics, camps and tournaments.
-- Design and owner decisions: docs/design/p2-1-events.md (approved 2026-11-06).
--
-- Additive only. The app does not read or write these tables yet, nothing is
-- backfilled, and team_posts / tryout_rsvps / team_event_availability are not
-- touched. Rollback: docs/rollbacks/20261106220000_events_stage1.down.sql.
--
-- What stage 1 builds, and the rules it carries:
--   events               the event itself. Team-hosted only for now (facility
--                        events are stage 5). An age range is required (D1), so
--                        youth status is explicit.
--   event_locations      the exact venue, kept apart from events. The public sees
--                        it only for adult-only events (D0); otherwise only host
--                        staff, registrants and the guardians of registrants do.
--   event_registrations  tryout_rsvps generalised: the guardian-on-behalf rule,
--                        the team waiver gate (D2: waivers stay per team), and
--                        capacity counted from registrations under a row lock.
--                        New: the registrant's age must fall in the event's range.
--   event_availability   team_event_availability generalised.
--
-- Clients get SELECT (row level security decides which rows) and nothing else;
-- every write goes through a SECURITY DEFINER function below. Moderation stays
-- with server code (the service role), as for team_posts.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

CREATE TABLE public.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  host_kind text NOT NULL CHECK (host_kind IN ('team', 'facility')),
  host_ref text NOT NULL,
  team_id text REFERENCES public.teams(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('tryout', 'clinic', 'camp', 'tournament')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  body text CHECK (body IS NULL OR char_length(body) <= 5000),
  image_url text CHECK (image_url IS NULL OR char_length(image_url) <= 1000),
  starts_at timestamptz,
  ends_at timestamptz,
  min_age int NOT NULL CHECK (min_age BETWEEN 4 AND 99),
  max_age int NOT NULL CHECK (max_age BETWEEN 4 AND 99),
  venue_label text CHECK (venue_label IS NULL OR char_length(venue_label) <= 120),
  price_cents int CHECK (price_cents IS NULL OR price_cents BETWEEN 0 AND 10000000),
  currency text NOT NULL DEFAULT 'usd' CHECK (currency ~ '^[a-z]{3}$'),
  capacity int CHECK (capacity IS NULL OR capacity BETWEEN 1 AND 10000),
  cancel_cutoff_min int CHECK (cancel_cutoff_min IS NULL OR cancel_cutoff_min BETWEEN 0 AND 10080),
  refund_rule text CHECK (refund_rule IS NULL OR refund_rule IN ('until_cutoff', 'before_start', 'none')),
  late_refund_pct int CHECK (late_refund_pct IS NULL OR late_refund_pct BETWEEN 0 AND 100),
  share_scores boolean NOT NULL DEFAULT false,
  share_notes boolean NOT NULL DEFAULT false,
  pinned boolean NOT NULL DEFAULT false,
  author_id uuid NOT NULL,
  moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending', 'approved', 'held')),
  hidden_at timestamptz,
  owner_hidden_at timestamptz,
  moderator_hidden_at timestamptz,
  legacy_post_id uuid UNIQUE REFERENCES public.team_posts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT events_age_range CHECK (max_age >= min_age),
  CONSTRAINT events_time_order CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at),
  -- A team event names its team twice (host_ref for the generic host, team_id for
  -- the foreign key); they must agree. Facility events carry no team.
  CONSTRAINT events_team_host CHECK (
    (host_kind = 'team' AND team_id IS NOT NULL AND team_id = host_ref)
    OR (host_kind <> 'team' AND team_id IS NULL))
);
CREATE INDEX events_team_starts_idx ON public.events (team_id, starts_at);
CREATE INDEX events_starts_idx ON public.events (starts_at) WHERE moderation_status = 'approved';

CREATE TABLE public.event_locations (
  event_id uuid PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
  place_id text CHECK (place_id IS NULL OR char_length(place_id) <= 300),
  formatted_address text CHECK (formatted_address IS NULL OR char_length(formatted_address) <= 300),
  lat numeric CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng numeric CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.event_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  registered_by uuid NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered', 'cancelled')),
  waiver_signature_id uuid REFERENCES public.team_waiver_signatures(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX event_registrations_user_idx ON public.event_registrations (user_id);

CREATE TABLE public.event_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('available', 'maybe', 'unavailable')),
  note text CHECK (note IS NULL OR char_length(note) <= 200),
  set_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);
CREATE INDEX event_availability_user_idx ON public.event_availability (user_id);

CREATE TRIGGER events_touch_updated_at BEFORE UPDATE ON public.events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER event_locations_touch_updated_at BEFORE UPDATE ON public.event_locations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER event_registrations_touch_updated_at BEFORE UPDATE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER event_availability_touch_updated_at BEFORE UPDATE ON public.event_availability
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Privileges. Supabase's default privileges grant everything on a new table to
-- the API roles; take that back, then grant only reads.
-- ---------------------------------------------------------------------------

REVOKE ALL ON public.events, public.event_locations, public.event_registrations,
  public.event_availability FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.events, public.event_locations, public.event_registrations,
  public.event_availability TO service_role;

GRANT SELECT ON public.events TO anon, authenticated;
GRANT SELECT ON public.event_registrations, public.event_availability TO authenticated;
-- event_locations: no client grant at all. Read through get_event_location().

ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_availability ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Helpers (private_sec: not exposed through the API)
-- ---------------------------------------------------------------------------

-- Host staff of an event: owner, manager or coach of the hosting team.
CREATE OR REPLACE FUNCTION private_sec.is_event_staff(_event uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT e.host_kind = 'team' AND public.is_team_manager(e.team_id, _user)
      FROM public.events e WHERE e.id = _event), false);
$$;

-- Listed to the public: approved, hidden by nobody, and its host not hidden.
CREATE OR REPLACE FUNCTION private_sec.event_is_listed(_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT e.moderation_status = 'approved'
       AND e.hidden_at IS NULL AND e.owner_hidden_at IS NULL AND e.moderator_hidden_at IS NULL
       AND (e.host_kind <> 'team' OR EXISTS (
             SELECT 1 FROM public.teams t
              WHERE t.id = e.team_id AND t.hidden_at IS NULL
                AND t.owner_hidden_at IS NULL AND t.moderator_hidden_at IS NULL))
      FROM public.events e WHERE e.id = _event), false);
$$;

-- A person's age in whole years on a date, from their stored birthday. NULL when
-- no birthday is stored: callers treat that as "not eligible", never as a pass.
CREATE OR REPLACE FUNCTION private_sec.age_on(_user uuid, _on date)
RETURNS int
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT date_part('year', age(_on, b.birthday))::int
    FROM public.profile_birthdays b WHERE b.user_id = _user;
$$;

-- May this viewer see the exact location? (D0, for events.)
--   adult-only and listed  -> everyone, signed in or not;
--   otherwise              -> host staff, a current registrant, or a guardian of one.
CREATE OR REPLACE FUNCTION private_sec.can_see_event_location(_event uuid, _viewer uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT
      (e.min_age >= 18 AND private_sec.event_is_listed(e.id))
      OR (_viewer IS NOT NULL AND (
            private_sec.is_event_staff(e.id, _viewer)
            OR (private_sec.event_is_listed(e.id) AND EXISTS (
                  SELECT 1 FROM public.event_registrations r
                   WHERE r.event_id = e.id AND r.status = 'registered'
                     AND (r.user_id = _viewer OR public.is_guardian_of(_viewer, r.user_id))))))
      FROM public.events e WHERE e.id = _event), false);
$$;

REVOKE ALL ON FUNCTION private_sec.is_event_staff(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.event_is_listed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.age_on(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.can_see_event_location(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- The read policies below run these as the querying role.
GRANT EXECUTE ON FUNCTION private_sec.is_event_staff(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private_sec.event_is_listed(uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Read policies
-- ---------------------------------------------------------------------------

CREATE POLICY "events_listed_read" ON public.events FOR SELECT TO anon, authenticated
  USING (private_sec.event_is_listed(id));
CREATE POLICY "events_staff_or_author_read" ON public.events FOR SELECT TO authenticated
  USING (author_id = auth.uid() OR private_sec.is_event_staff(id, auth.uid()));
-- Anonymous visitors see adult-only events only, as with hosted games.
CREATE POLICY "events_anon_adult_only" ON public.events AS RESTRICTIVE FOR SELECT TO anon
  USING (min_age >= 18);

CREATE POLICY "event_registrations_read" ON public.event_registrations FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR registered_by = auth.uid()
         OR public.is_guardian_of(auth.uid(), user_id)
         OR private_sec.is_event_staff(event_id, auth.uid()));

CREATE POLICY "event_availability_read" ON public.event_availability FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_guardian_of(auth.uid(), user_id)
         OR private_sec.is_event_staff(event_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Write the location part of an event payload (`location` key). Absent key:
-- unchanged. JSON null: removed. Internal; called by create/update only.
CREATE OR REPLACE FUNCTION private_sec.write_event_location(_event uuid, _loc jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF _loc IS NULL OR jsonb_typeof(_loc) = 'null' THEN
    DELETE FROM public.event_locations WHERE event_id = _event;
    RETURN;
  END IF;
  IF jsonb_typeof(_loc) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_LOCATION' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.event_locations (event_id, place_id, formatted_address, lat, lng)
  VALUES (_event, NULLIF(btrim(_loc->>'place_id'), ''), NULLIF(btrim(_loc->>'formatted_address'), ''),
          (_loc->>'lat')::numeric, (_loc->>'lng')::numeric)
  ON CONFLICT (event_id) DO UPDATE
    SET place_id = EXCLUDED.place_id, formatted_address = EXCLUDED.formatted_address,
        lat = EXCLUDED.lat, lng = EXCLUDED.lng;
END;
$$;
REVOKE ALL ON FUNCTION private_sec.write_event_location(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Create a team event. Host staff only, never a minor (no minor-hosted events),
-- and never for a hidden team. It starts 'pending'; server moderation approves.
CREATE OR REPLACE FUNCTION public.create_event(_team_id text, _e jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _id uuid;
  _unknown text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _e IS NULL OR jsonb_typeof(_e) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(k, ', ') INTO _unknown FROM jsonb_object_keys(_e) k
   WHERE k NOT IN ('kind', 'title', 'body', 'image_url', 'starts_at', 'ends_at', 'min_age',
                   'max_age', 'venue_label', 'price_cents', 'currency', 'capacity',
                   'cancel_cutoff_min', 'refund_rule', 'late_refund_pct', 'share_scores',
                   'share_notes', 'location');
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_FIELD: %', _unknown USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_team_manager(_team_id, _me) THEN
    RAISE EXCEPTION 'NOT_TEAM_STAFF' USING ERRCODE = '42501';
  END IF;
  IF public.age_cohort_of(_me) <> 'adult' THEN
    RAISE EXCEPTION 'ADULT_HOST_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _team_id AND t.hidden_at IS NULL
                   AND t.owner_hidden_at IS NULL AND t.moderator_hidden_at IS NULL) THEN
    RAISE EXCEPTION 'TEAM_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _e->'min_age' IS NULL OR _e->'max_age' IS NULL
     OR jsonb_typeof(_e->'min_age') <> 'number' OR jsonb_typeof(_e->'max_age') <> 'number' THEN
    RAISE EXCEPTION 'AGE_RANGE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.events (
    host_kind, host_ref, team_id, kind, title, body, image_url, starts_at, ends_at,
    min_age, max_age, venue_label, price_cents, currency, capacity, cancel_cutoff_min,
    refund_rule, late_refund_pct, share_scores, share_notes, author_id, moderation_status)
  VALUES (
    'team', _team_id, _team_id, _e->>'kind', btrim(_e->>'title'), NULLIF(btrim(_e->>'body'), ''),
    NULLIF(btrim(_e->>'image_url'), ''), (_e->>'starts_at')::timestamptz,
    (_e->>'ends_at')::timestamptz, (_e->>'min_age')::int, (_e->>'max_age')::int,
    NULLIF(btrim(_e->>'venue_label'), ''), (_e->>'price_cents')::int,
    COALESCE(_e->>'currency', 'usd'), (_e->>'capacity')::int, (_e->>'cancel_cutoff_min')::int,
    _e->>'refund_rule', (_e->>'late_refund_pct')::int, COALESCE((_e->>'share_scores')::boolean, false),
    COALESCE((_e->>'share_notes')::boolean, false), _me, 'pending')
  RETURNING id INTO _id;

  IF _e ? 'location' THEN
    PERFORM private_sec.write_event_location(_id, _e->'location');
  END IF;
  RETURN _id;
END;
$$;

-- Edit an event. Host staff only. New text goes back to moderation. Once anyone
-- is registered the age range is fixed (it decides who may come and who may see
-- the venue), and capacity cannot drop below the people already registered.
CREATE OR REPLACE FUNCTION public.update_event(_event uuid, _e jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _old public.events;
  _new public.events;
  _unknown text;
  _registered int;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _e IS NULL OR jsonb_typeof(_e) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_EVENT' USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(k, ', ') INTO _unknown FROM jsonb_object_keys(_e) k
   WHERE k NOT IN ('kind', 'title', 'body', 'image_url', 'starts_at', 'ends_at', 'min_age',
                   'max_age', 'venue_label', 'price_cents', 'currency', 'capacity',
                   'cancel_cutoff_min', 'refund_rule', 'late_refund_pct', 'share_scores',
                   'share_notes', 'pinned', 'location');
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_FIELD: %', _unknown USING ERRCODE = '22023';
  END IF;

  SELECT * INTO _old FROM public.events WHERE id = _event FOR UPDATE;
  IF _old.id IS NULL OR NOT private_sec.is_event_staff(_event, _me) THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  _new := _old;
  IF _e ? 'kind' THEN _new.kind := _e->>'kind'; END IF;
  IF _e ? 'title' THEN _new.title := btrim(_e->>'title'); END IF;
  IF _e ? 'body' THEN _new.body := NULLIF(btrim(_e->>'body'), ''); END IF;
  IF _e ? 'image_url' THEN _new.image_url := NULLIF(btrim(_e->>'image_url'), ''); END IF;
  IF _e ? 'starts_at' THEN _new.starts_at := (_e->>'starts_at')::timestamptz; END IF;
  IF _e ? 'ends_at' THEN _new.ends_at := (_e->>'ends_at')::timestamptz; END IF;
  IF _e ? 'min_age' THEN _new.min_age := (_e->>'min_age')::int; END IF;
  IF _e ? 'max_age' THEN _new.max_age := (_e->>'max_age')::int; END IF;
  IF _e ? 'venue_label' THEN _new.venue_label := NULLIF(btrim(_e->>'venue_label'), ''); END IF;
  IF _e ? 'price_cents' THEN _new.price_cents := (_e->>'price_cents')::int; END IF;
  IF _e ? 'currency' THEN _new.currency := _e->>'currency'; END IF;
  IF _e ? 'capacity' THEN _new.capacity := (_e->>'capacity')::int; END IF;
  IF _e ? 'cancel_cutoff_min' THEN _new.cancel_cutoff_min := (_e->>'cancel_cutoff_min')::int; END IF;
  IF _e ? 'refund_rule' THEN _new.refund_rule := _e->>'refund_rule'; END IF;
  IF _e ? 'late_refund_pct' THEN _new.late_refund_pct := (_e->>'late_refund_pct')::int; END IF;
  IF _e ? 'share_scores' THEN _new.share_scores := COALESCE((_e->>'share_scores')::boolean, false); END IF;
  IF _e ? 'share_notes' THEN _new.share_notes := COALESCE((_e->>'share_notes')::boolean, false); END IF;
  IF _e ? 'pinned' THEN _new.pinned := COALESCE((_e->>'pinned')::boolean, false); END IF;

  SELECT count(*) INTO _registered FROM public.event_registrations
   WHERE event_id = _event AND status = 'registered';
  IF _registered > 0 AND (_new.min_age <> _old.min_age OR _new.max_age <> _old.max_age) THEN
    RAISE EXCEPTION 'AGE_RANGE_LOCKED' USING ERRCODE = '22023';
  END IF;
  IF _new.capacity IS NOT NULL AND _new.capacity < _registered THEN
    RAISE EXCEPTION 'CAPACITY_BELOW_REGISTERED' USING ERRCODE = '22023';
  END IF;

  IF _new.title IS DISTINCT FROM _old.title OR _new.body IS DISTINCT FROM _old.body
     OR _new.venue_label IS DISTINCT FROM _old.venue_label
     OR _new.image_url IS DISTINCT FROM _old.image_url THEN
    _new.moderation_status := 'pending';
  END IF;

  UPDATE public.events SET
    kind = _new.kind, title = _new.title, body = _new.body, image_url = _new.image_url,
    starts_at = _new.starts_at, ends_at = _new.ends_at, min_age = _new.min_age,
    max_age = _new.max_age, venue_label = _new.venue_label, price_cents = _new.price_cents,
    currency = _new.currency, capacity = _new.capacity, cancel_cutoff_min = _new.cancel_cutoff_min,
    refund_rule = _new.refund_rule, late_refund_pct = _new.late_refund_pct,
    share_scores = _new.share_scores, share_notes = _new.share_notes, pinned = _new.pinned,
    moderation_status = _new.moderation_status
  WHERE id = _event;

  IF _e ? 'location' THEN
    PERFORM private_sec.write_event_location(_event, _e->'location');
  END IF;
END;
$$;

-- Host staff hide or show their own event (owner_hidden_at). Moderator hides
-- (moderator_hidden_at, hidden_at) stay with server code.
CREATE OR REPLACE FUNCTION public.set_event_hidden(_event uuid, _hidden boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF NOT private_sec.is_event_staff(_event, auth.uid()) THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.events
     SET owner_hidden_at = CASE WHEN _hidden THEN COALESCE(owner_hidden_at, now()) ELSE NULL END
   WHERE id = _event;
END;
$$;

-- The exact venue, for whoever may see it (can_see_event_location). Everyone
-- else gets no row: the same answer as an event with no stored location, so it
-- is not an oracle. Callable by anonymous visitors for adult-only events.
CREATE OR REPLACE FUNCTION public.get_event_location(_event uuid)
RETURNS TABLE (place_id text, formatted_address text, lat numeric, lng numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.place_id, l.formatted_address, l.lat, l.lng
    FROM public.event_locations l
   WHERE l.event_id = _event
     AND private_sec.can_see_event_location(_event, auth.uid());
$$;

-- Register yourself, or your child (_on_behalf_of, verified guardian link only).
-- Carries over rsvp_tryout: the waiver gate and capacity. Adds the age range: the
-- registrant's age on the start date (today when the date is TBA) must be within
-- it, and an unknown birthday does not pass. The event row is locked, so
-- concurrent registrations are counted one at a time and capacity holds.
CREATE OR REPLACE FUNCTION public.register_for_event(
  _event uuid,
  _on_behalf_of uuid DEFAULT NULL,
  _waiver_id uuid DEFAULT NULL,
  _attested boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _signer uuid := COALESCE(_on_behalf_of, auth.uid());
  _ev public.events;
  _w public.team_waivers;
  _sig uuid;
  _age int;
  _taken int;
  _id uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _on_behalf_of IS NOT NULL AND _on_behalf_of <> _me
     AND NOT public.is_guardian_of(_me, _on_behalf_of) THEN
    RAISE EXCEPTION 'NOT_YOUR_GUARDIAN_LINK' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO _ev FROM public.events WHERE id = _event FOR UPDATE;
  IF _ev.id IS NULL OR NOT private_sec.event_is_listed(_event) THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _ev.starts_at IS NOT NULL AND _ev.starts_at < now() THEN
    RAISE EXCEPTION 'EVENT_STARTED' USING ERRCODE = '22023';
  END IF;

  _age := private_sec.age_on(_signer, COALESCE(_ev.starts_at, now())::date);
  IF _age IS NULL THEN
    RAISE EXCEPTION 'AGE_UNKNOWN' USING ERRCODE = '22023';
  END IF;
  IF _age < _ev.min_age OR _age > _ev.max_age THEN
    RAISE EXCEPTION 'OUTSIDE_AGE_RANGE' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
              WHERE event_id = _event AND user_id = _signer AND status = 'registered') THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED' USING ERRCODE = '23505';
  END IF;
  SELECT count(*) INTO _taken FROM public.event_registrations
   WHERE event_id = _event AND status = 'registered';
  IF _ev.capacity IS NOT NULL AND _taken >= _ev.capacity THEN
    RAISE EXCEPTION 'EVENT_FULL' USING ERRCODE = '22023';
  END IF;

  IF _ev.host_kind = 'team' THEN
    SELECT * INTO _w FROM public.team_waivers WHERE team_id = _ev.team_id AND published;
    IF _w.id IS NOT NULL THEN
      SELECT id INTO _sig FROM public.team_waiver_signatures
       WHERE waiver_id = _w.id AND signer_user_id = _signer;
      IF _sig IS NULL THEN
        IF _waiver_id IS DISTINCT FROM _w.id OR NOT COALESCE(_attested, false) THEN
          RAISE EXCEPTION 'WAIVER_REQUIRED' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by, user_agent)
        VALUES (_w.id, _ev.team_id, _signer,
          CASE WHEN _signer <> _me THEN _me ELSE NULL END,
          CASE WHEN _signer <> _me THEN 'guardian-on-behalf:event' ELSE 'event' END)
        RETURNING id INTO _sig;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.event_registrations (event_id, user_id, registered_by, status, waiver_signature_id)
  VALUES (_event, _signer, _me, 'registered', _sig)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET status = 'registered', registered_by = EXCLUDED.registered_by,
        waiver_signature_id = EXCLUDED.waiver_signature_id
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

-- Cancel your own registration or your child's. Host staff can cancel anyone's.
CREATE OR REPLACE FUNCTION public.cancel_event_registration(_event uuid, _user uuid DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _who uuid := COALESCE(_user, auth.uid());
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _who <> _me AND NOT public.is_guardian_of(_me, _who)
     AND NOT private_sec.is_event_staff(_event, _me) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  -- Serialise with register_for_event's count.
  PERFORM 1 FROM public.events WHERE id = _event FOR UPDATE;
  UPDATE public.event_registrations SET status = 'cancelled'
   WHERE event_id = _event AND user_id = _who AND status = 'registered';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'NOT_REGISTERED' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Availability for team members, set by themselves or a guardian. Mirrors
-- set_team_event_availability; NULL status clears it.
CREATE OR REPLACE FUNCTION public.set_event_availability(_event uuid, _user uuid, _status text, _note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _ev public.events;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _status IS NOT NULL AND _status NOT IN ('available', 'maybe', 'unavailable') THEN
    RAISE EXCEPTION 'INVALID_STATUS' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _ev FROM public.events WHERE id = _event;
  IF _ev.id IS NULL OR NOT private_sec.event_is_listed(_event) THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _ev.starts_at IS NOT NULL AND _ev.starts_at < now() THEN
    RAISE EXCEPTION 'EVENT_STARTED' USING ERRCODE = '22023';
  END IF;
  IF _user <> _me AND NOT public.is_guardian_of(_me, _user) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  IF _ev.host_kind <> 'team' OR NOT public.is_team_member(_ev.team_id, _user) THEN
    RAISE EXCEPTION 'NOT_ON_TEAM' USING ERRCODE = '42501';
  END IF;

  IF _status IS NULL THEN
    DELETE FROM public.event_availability WHERE event_id = _event AND user_id = _user;
    RETURN;
  END IF;
  INSERT INTO public.event_availability (event_id, user_id, status, note, set_by)
  VALUES (_event, _user, _status, NULLIF(left(btrim(COALESCE(_note, '')), 200), ''), _me)
  ON CONFLICT (event_id, user_id) DO UPDATE
    SET status = EXCLUDED.status, note = EXCLUDED.note, set_by = EXCLUDED.set_by;
END;
$$;

REVOKE ALL ON FUNCTION public.create_event(text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_event(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_hidden(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_event_location(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_for_event(uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_event_registration(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_event_availability(uuid, uuid, text, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.create_event(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_event(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_hidden(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_event_location(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_for_event(uuid, uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_event_registration(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_event_availability(uuid, uuid, text, text) TO authenticated;

COMMENT ON TABLE public.events IS
  'P2-1: tryouts, clinics, camps and tournaments. Stage 1 (additive): not read by the app yet. '
  'Writes only through create_event / update_event / set_event_hidden; moderation by server code.';
COMMENT ON TABLE public.event_locations IS
  'Exact venue of an event. No client grant: read through get_event_location (D0: public only '
  'for adult-only events; otherwise host staff, registrants and their guardians).';
