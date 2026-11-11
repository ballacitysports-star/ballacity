-- P2-1 stage 5 / Home feed slice E (decision F3): venues create events.
-- Design: docs/design/p2-1-events.md (stage 5), docs/design/home-feed.md (F3, F5).
--
-- 1. Kinds: 'open_gym' is added. Venues create clinic, camp, tournament and open gym events; tryouts stay a team thing.
-- 2. Staff: a facility event's staff are the venue's owner and its admins (trainer_orgs owner_id, is_trainer_org_admin),
--    as a team event's staff are its owner, managers and coaches. Every rule that asks private_sec.is_event_staff
--    (editing, hiding, cancelling for someone, reading registrations, the venue) now covers venues.
-- 3. Listing: a hidden venue (hidden by anyone) hides its events, as a hidden team does.
-- 4. create_facility_event(org, payload): like create_event. Staff only, an adult host, a venue that is not hidden, a
--    required age range (D1), and it starts pending until moderation approves it. Sign-ups use register_for_event with
--    the stage 1 rules (age range, capacity). There is no waiver: waivers stay per team (D2).
-- 5. app_settings 'venue_events' = {"enabled": false}, public. The app shows the venue events section and the feed's
--    venue cards only when it is on. Off until the owner turns it on.
--
-- Rollback: docs/rollbacks/20261108130000_events_stage5_facility_events.down.sql.

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_kind_check;
ALTER TABLE public.events ADD CONSTRAINT events_kind_check
  CHECK (kind IN ('tryout', 'clinic', 'camp', 'tournament', 'open_gym'));

-- Is this person staff of the venue (owner or admin)?
CREATE OR REPLACE FUNCTION private_sec.is_facility_staff(_org uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT _org IS NOT NULL AND _user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.id = _org AND o.owner_id = _user)
    OR public.is_trainer_org_admin(_org, _user));
$$;
REVOKE ALL ON FUNCTION private_sec.is_facility_staff(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private_sec.is_event_staff(_event uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT CASE e.host_kind
             WHEN 'team' THEN public.is_team_manager(e.team_id, _user)
             WHEN 'facility' THEN private_sec.is_facility_staff(public.try_uuid(e.host_ref), _user)
             ELSE false
           END
      FROM public.events e WHERE e.id = _event), false);
$$;

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
       AND (e.host_kind <> 'facility' OR EXISTS (
             SELECT 1 FROM public.trainer_orgs o
              WHERE o.id = public.try_uuid(e.host_ref) AND o.hidden_at IS NULL
                AND o.owner_hidden_at IS NULL AND o.moderator_hidden_at IS NULL))
      FROM public.events e WHERE e.id = _event), false);
$$;

-- Create a venue event. Venue staff only, never a minor, never for a hidden venue. It starts 'pending'.
CREATE OR REPLACE FUNCTION public.create_facility_event(_org uuid, _e jsonb)
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
                   'cancel_cutoff_min', 'refund_rule', 'late_refund_pct', 'location');
  IF _unknown IS NOT NULL THEN
    RAISE EXCEPTION 'UNKNOWN_FIELD: %', _unknown USING ERRCODE = '22023';
  END IF;
  IF NOT private_sec.is_facility_staff(_org, _me) THEN
    RAISE EXCEPTION 'NOT_FACILITY_STAFF' USING ERRCODE = '42501';
  END IF;
  IF public.age_cohort_of(_me) IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'ADULT_HOST_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.id = _org AND o.hidden_at IS NULL
                   AND o.owner_hidden_at IS NULL AND o.moderator_hidden_at IS NULL) THEN
    RAISE EXCEPTION 'FACILITY_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(_e->>'kind', '') NOT IN ('clinic', 'camp', 'tournament', 'open_gym') THEN
    RAISE EXCEPTION 'KIND_NOT_ALLOWED' USING ERRCODE = '22023';
  END IF;
  IF _e->'min_age' IS NULL OR _e->'max_age' IS NULL
     OR jsonb_typeof(_e->'min_age') <> 'number' OR jsonb_typeof(_e->'max_age') <> 'number' THEN
    RAISE EXCEPTION 'AGE_RANGE_REQUIRED' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.events (
    host_kind, host_ref, team_id, kind, title, body, image_url, starts_at, ends_at,
    min_age, max_age, venue_label, price_cents, currency, capacity, cancel_cutoff_min,
    refund_rule, late_refund_pct, author_id, moderation_status)
  VALUES (
    'facility', _org::text, NULL, _e->>'kind', btrim(_e->>'title'), NULLIF(btrim(_e->>'body'), ''),
    NULLIF(btrim(_e->>'image_url'), ''), (_e->>'starts_at')::timestamptz,
    (_e->>'ends_at')::timestamptz, (_e->>'min_age')::int, (_e->>'max_age')::int,
    NULLIF(btrim(_e->>'venue_label'), ''), (_e->>'price_cents')::int,
    COALESCE(_e->>'currency', 'usd'), (_e->>'capacity')::int, (_e->>'cancel_cutoff_min')::int,
    _e->>'refund_rule', (_e->>'late_refund_pct')::int, _me, 'pending')
  RETURNING id INTO _id;

  IF _e ? 'location' THEN
    PERFORM private_sec.write_event_location(_id, _e->'location');
  END IF;
  RETURN _id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_facility_event(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_facility_event(uuid, jsonb) TO authenticated, service_role;

-- ------------------------------------------------------------------ feature flag
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('venue_events', '{"enabled": false}'::jsonb,
        'Venue events (P2-1 stage 5, Home feed slice E). Off until released.', true)
ON CONFLICT (key) DO NOTHING;
