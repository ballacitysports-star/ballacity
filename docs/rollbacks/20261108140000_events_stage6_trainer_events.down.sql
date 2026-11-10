-- ROLLBACK for supabase/migrations/20261108140000_events_stage6_trainer_events.sql (P2-1 stage 6, Home feed slice F).
-- NOT a migration. It removes trainer events: create_trainer_event and get_event_waiver are dropped, the 'trainer' host kind is removed,
-- and is_event_staff, event_is_listed (stage 5 bodies) and register_for_event (stage 4a body) are restored.
-- Only the 'trainer_events' switch row is removed. It refuses to run while any trainer event exists (move or delete
-- those deliberately first), and unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_trainer_events=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_trainer_events', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: trainers would stop being able to post group sessions. Set app.confirm_drop_trainer_events=yes for the session to proceed deliberately.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE host_kind = 'trainer') THEN
    RAISE EXCEPTION 'Refusing to run: trainer events exist. Their staff would lose access and the host kind check would fail.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.create_trainer_event(text, jsonb);
DROP FUNCTION IF EXISTS public.get_event_waiver(uuid, uuid);

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

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_host_kind_check;
ALTER TABLE public.events ADD CONSTRAINT events_host_kind_check
  CHECK (host_kind IN ('team', 'facility'));

DELETE FROM public.app_settings WHERE key = 'trainer_events';

COMMIT;
