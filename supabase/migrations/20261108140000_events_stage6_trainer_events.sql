-- P2-1 stage 6 / Home feed slice F (decisions F4, D7): trainers post group sessions as events.
-- Design: docs/design/p2-1-events.md (D7), docs/design/home-feed.md (F4, F5).
--
-- A trainer is a teams row with kind 'coach' (its page is /trainers/<id>). Its 1-on-1 sessions stay booking requests.
-- 1. Host kind 'trainer': host_ref is the trainer's teams.id; team_id stays NULL, so a trainer event never appears
--    on a team's events page and never gets team-only features (availability, the team roster).
-- 2. Staff: the trainer's owner, managers and coaches (is_team_manager), as for a team. Every rule that asks
--    private_sec.is_event_staff (editing, hiding, cancelling for someone, reading registrations, the venue) covers it.
-- 3. Listing: a hidden trainer (hidden by anyone) hides its events.
-- 4. Sign-ups: register_for_event is unchanged except that a trainer event asks for the trainer's own published
--    waiver, as a team event asks for the team's. Age range and capacity as in stage 1.
-- 5. create_trainer_event(trainer, payload): staff only, an adult host, a trainer (kind 'coach') that is not
--    hidden, kinds clinic and camp only, a required age range (D1), and it starts pending until moderation
--    approves it.
-- 6. get_event_waiver(event): the host's published waiver (a team's or a trainer's) for an event the caller may
--    read, with whether the caller (or their linked child) has signed it, so the sign-up screen can show the text
--    before register_for_event signs it. Signed-in callers only. A venue event has none.
-- 7. app_settings 'trainer_events' = {"enabled": false}, public. Off until the owner turns it on.
--
-- Rollback: docs/rollbacks/20261108140000_events_stage6_trainer_events.down.sql.

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_host_kind_check;
ALTER TABLE public.events ADD CONSTRAINT events_host_kind_check
  CHECK (host_kind IN ('team', 'facility', 'trainer'));

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
             WHEN 'trainer' THEN public.is_team_manager(e.host_ref, _user)
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
       AND (e.host_kind <> 'trainer' OR EXISTS (
             SELECT 1 FROM public.teams t
              WHERE t.id = e.host_ref AND t.kind = 'coach' AND t.hidden_at IS NULL
                AND t.owner_hidden_at IS NULL AND t.moderator_hidden_at IS NULL))
      FROM public.events e WHERE e.id = _event), false);
$$;

-- Sign up (stage 4a's function; only the waiver step changes: a trainer event asks for the trainer's waiver).
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
  _post public.team_posts;
  _legacy uuid;
  _w public.team_waivers;
  _waiver_team text;
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

  -- Lock order: the post (copied events only), then the event.
  SELECT legacy_post_id INTO _legacy FROM public.events WHERE id = _event;
  IF _legacy IS NOT NULL THEN
    SELECT * INTO _post FROM public.team_posts WHERE id = _legacy FOR UPDATE;
  END IF;
  SELECT * INTO _ev FROM public.events WHERE id = _event FOR UPDATE;

  IF _ev.id IS NULL THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _ev.legacy_post_id IS NOT NULL THEN
    -- Today's rule (rsvp_tryout): the post exists, is a tryout or clinic, and is not hidden.
    IF _post.id IS NULL OR _post.hidden_at IS NOT NULL OR _post.kind NOT IN ('tryout', 'clinic') THEN
      RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
    END IF;
  ELSIF NOT private_sec.event_is_listed(_event) THEN
    RAISE EXCEPTION 'EVENT_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF _ev.starts_at IS NOT NULL AND _ev.starts_at < now() THEN
    RAISE EXCEPTION 'EVENT_STARTED' USING ERRCODE = '22023';
  END IF;

  IF _ev.legacy_post_id IS NULL THEN
    _age := private_sec.age_on(_signer, COALESCE(_ev.starts_at, now())::date);
    IF _age IS NULL THEN
      RAISE EXCEPTION 'AGE_UNKNOWN' USING ERRCODE = '22023';
    END IF;
    IF _age < _ev.min_age OR _age > _ev.max_age THEN
      RAISE EXCEPTION 'OUTSIDE_AGE_RANGE' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM public.event_registrations
              WHERE event_id = _event AND user_id = _signer AND status = 'registered') THEN
    RAISE EXCEPTION 'ALREADY_REGISTERED' USING ERRCODE = '23505';
  END IF;
  IF _ev.legacy_post_id IS NOT NULL THEN
    IF _post.spots_max IS NOT NULL AND COALESCE(_post.spots_taken, 0) >= _post.spots_max THEN
      RAISE EXCEPTION 'EVENT_FULL' USING ERRCODE = '22023';
    END IF;
  ELSE
    SELECT count(*) INTO _taken FROM public.event_registrations
     WHERE event_id = _event AND status = 'registered';
    IF _ev.capacity IS NOT NULL AND _taken >= _ev.capacity THEN
      RAISE EXCEPTION 'EVENT_FULL' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- The host's waiver: a team's, or a trainer's own (a trainer is a teams row). Venues have none (D2).
  _waiver_team := CASE _ev.host_kind WHEN 'team' THEN _ev.team_id WHEN 'trainer' THEN _ev.host_ref END;
  IF _waiver_team IS NOT NULL THEN
    SELECT * INTO _w FROM public.team_waivers WHERE team_id = _waiver_team AND published;
    IF _w.id IS NOT NULL THEN
      SELECT id INTO _sig FROM public.team_waiver_signatures
       WHERE waiver_id = _w.id AND signer_user_id = _signer;
      IF _sig IS NULL THEN
        IF _waiver_id IS DISTINCT FROM _w.id OR NOT COALESCE(_attested, false) THEN
          RAISE EXCEPTION 'WAIVER_REQUIRED' USING ERRCODE = '22023';
        END IF;
        INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id, signed_by, user_agent)
        VALUES (_w.id, _waiver_team, _signer,
          CASE WHEN _signer <> _me THEN _me ELSE NULL END,
          CASE WHEN _ev.legacy_post_id IS NOT NULL
               THEN CASE WHEN _signer <> _me THEN 'guardian-on-behalf:tryout' ELSE 'tryout' END
               ELSE CASE WHEN _signer <> _me THEN 'guardian-on-behalf:event' ELSE 'event' END END)
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

-- Create a trainer group session. Trainer staff only, never a minor, never for a hidden trainer. It starts 'pending'.
CREATE OR REPLACE FUNCTION public.create_trainer_event(_trainer text, _e jsonb)
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
  IF _trainer IS NULL OR NOT public.is_team_manager(_trainer, _me) THEN
    RAISE EXCEPTION 'NOT_TRAINER_STAFF' USING ERRCODE = '42501';
  END IF;
  IF public.age_cohort_of(_me) IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'ADULT_HOST_REQUIRED' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = _trainer AND t.kind = 'coach'
                   AND t.hidden_at IS NULL AND t.owner_hidden_at IS NULL AND t.moderator_hidden_at IS NULL) THEN
    RAISE EXCEPTION 'TRAINER_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(_e->>'kind', '') NOT IN ('clinic', 'camp') THEN
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
    'trainer', _trainer, NULL, _e->>'kind', btrim(_e->>'title'), NULLIF(btrim(_e->>'body'), ''),
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
REVOKE ALL ON FUNCTION public.create_trainer_event(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_trainer_event(text, jsonb) TO authenticated, service_role;

-- The waiver a sign-up for this event needs, if any. Only for an event the caller may read (listed, or staff).
CREATE OR REPLACE FUNCTION public.get_event_waiver(_event uuid, _signer uuid DEFAULT NULL)
RETURNS TABLE (id uuid, team_id text, version text, title text, content text, signed boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _who uuid := COALESCE(_signer, auth.uid());
  _ev public.events;
  _host text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _who <> _me AND NOT public.is_guardian_of(_me, _who) THEN
    RAISE EXCEPTION 'NOT_YOUR_GUARDIAN_LINK' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO _ev FROM public.events e WHERE e.id = _event;
  IF _ev.id IS NULL OR NOT (private_sec.event_is_listed(_event) OR private_sec.is_event_staff(_event, _me)) THEN
    RETURN;
  END IF;
  _host := CASE _ev.host_kind WHEN 'team' THEN _ev.team_id WHEN 'trainer' THEN _ev.host_ref END;
  IF _host IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT w.id, w.team_id, w.version, w.title, w.content,
           EXISTS (SELECT 1 FROM public.team_waiver_signatures s
                    WHERE s.waiver_id = w.id AND s.signer_user_id = _who)
      FROM public.team_waivers w
     WHERE w.team_id = _host AND w.published;
END;
$$;
REVOKE ALL ON FUNCTION public.get_event_waiver(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_waiver(uuid, uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------ feature flag
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('trainer_events', '{"enabled": false}'::jsonb,
        'Trainer group sessions as events (P2-1 stage 6, Home feed slice F). Off until released.', true)
ON CONFLICT (key) DO NOTHING;
