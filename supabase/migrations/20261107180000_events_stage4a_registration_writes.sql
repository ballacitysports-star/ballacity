-- P2-1 stage 4a: sign-ups and cancellations can go through events, behind a second switch that is off.
-- Design: docs/design/p2-1-events.md (stage 4). Builds on stages 1 to 3b.
--
-- Owner decision (2026-11-07): a tryout or clinic copied from a team post keeps exactly today's sign-up
-- rules (rsvp_tryout / cancel_tryout_rsvp). The age range (D1) applies only to events created as events.
--
-- 1. register_for_event / cancel_event_registration, for a copied event (legacy_post_id set):
--    * found when the post is not hidden (today: hidden_at only), not when "listed";
--    * no age check;
--    * full when the post's spots_taken reaches spots_max, as today;
--    * the post row is locked before the event row, the same order as an old-path sign-up
--      (rsvp_tryout locks the post; the stage 2 mirror then touches the event), so the two cannot deadlock;
--    * cancelling with nothing to cancel is not an error, as today.
--    Events created as events keep the stage 1 rules unchanged.
-- 2. Reverse mirror: a registration written on a copied event is written back to tryout_rsvps, and the
--    post's spots_taken moves as rsvp_tryout / cancel_tryout_rsvp move it. So everything that still reads
--    tryout_rsvps (late cancellations, alerts, evaluations, guardian activity, roster) keeps working, and
--    turning the switch off loses nothing. A failure here fails the sign-up: the two must not disagree.
--    A transaction-local marker (app.event_mirror) stops the two mirrors feeding each other.
-- 3. app_settings 'events_v2_writes' = {"enabled": false}, public. The app sends sign-ups through events
--    only when it is on. It is a separate switch from events_v2 so that publishing the app before this
--    migration reaches a database cannot route sign-ups to an older register_for_event.
--
-- Rollback: docs/rollbacks/20261107180000_events_stage4a_registration_writes.down.sql.

-- ---------------------------------------------------------------------------
-- 1. Sign-up and cancel
-- ---------------------------------------------------------------------------
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
  _legacy uuid;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  IF _who <> _me AND NOT public.is_guardian_of(_me, _who)
     AND NOT private_sec.is_event_staff(_event, _me) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  -- Same lock order as register_for_event; serialises with its count.
  SELECT legacy_post_id INTO _legacy FROM public.events WHERE id = _event;
  IF _legacy IS NOT NULL THEN
    PERFORM 1 FROM public.team_posts WHERE id = _legacy FOR UPDATE;
  END IF;
  PERFORM 1 FROM public.events WHERE id = _event FOR UPDATE;
  UPDATE public.event_registrations SET status = 'cancelled'
   WHERE event_id = _event AND user_id = _who AND status = 'registered';
  -- A copied event keeps today's rule: nothing to cancel is not an error.
  IF NOT FOUND AND _legacy IS NULL THEN
    RAISE EXCEPTION 'NOT_REGISTERED' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. The two mirrors
-- ---------------------------------------------------------------------------
-- Forward (stage 2): tryout_rsvps -> event_registrations. Now skips a write the reverse mirror made,
-- and marks its own so the reverse mirror skips it.
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
  IF COALESCE(current_setting('app.event_mirror', true), '') <> '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('app.event_mirror', 'forward', true);
    PERFORM private_sec.mirror_tryout_rsvp(_post, _user);
    IF TG_OP = 'UPDATE' AND (OLD.post_id, OLD.user_id) IS DISTINCT FROM (NEW.post_id, NEW.user_id) THEN
      PERFORM private_sec.mirror_tryout_rsvp(OLD.post_id, OLD.user_id);
    END IF;
    PERFORM set_config('app.event_mirror', '', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
    VALUES ('tryout_rsvps', _post::text || '/' || _user::text, TG_OP, SQLSTATE || ': ' || left(SQLERRM, 300));
  END;
  RETURN NULL;
END;
$$;

-- Reverse (new): event_registrations on a copied event -> tryout_rsvps and the post's seat counter.
-- Errors are not swallowed: if the old tables cannot be kept in step, the sign-up fails.
CREATE OR REPLACE FUNCTION private_sec.mirror_registration_to_tryout_rsvps_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _post uuid;
  _team text;
  _was boolean := TG_OP = 'UPDATE' AND OLD.status = 'registered';
  _now boolean := NEW.status = 'registered';
BEGIN
  IF COALESCE(current_setting('app.event_mirror', true), '') <> '' THEN
    RETURN NULL;
  END IF;
  SELECT e.legacy_post_id, e.team_id INTO _post, _team FROM public.events e WHERE e.id = NEW.event_id;
  IF _post IS NULL THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.event_mirror', 'reverse', true);
  INSERT INTO public.tryout_rsvps (post_id, team_id, user_id, registered_by, status, waiver_signature_id)
  VALUES (_post, _team, NEW.user_id, NEW.registered_by, NEW.status, NEW.waiver_signature_id)
  ON CONFLICT (post_id, user_id) DO UPDATE
    SET status = EXCLUDED.status, registered_by = EXCLUDED.registered_by,
        waiver_signature_id = EXCLUDED.waiver_signature_id,
        -- rsvp_tryout restamps a re-registration; a cancellation keeps its date.
        created_at = CASE WHEN EXCLUDED.status = 'registered' AND public.tryout_rsvps.status <> 'registered'
                          THEN now() ELSE public.tryout_rsvps.created_at END;
  IF _now AND NOT _was THEN
    UPDATE public.team_posts SET spots_taken = COALESCE(spots_taken, 0) + 1 WHERE id = _post;
  ELSIF _was AND NOT _now THEN
    UPDATE public.team_posts SET spots_taken = GREATEST(COALESCE(spots_taken, 0) - 1, 0) WHERE id = _post;
  END IF;
  PERFORM set_config('app.event_mirror', '', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zz_mirror_registration_to_tryout_rsvps ON public.event_registrations;
CREATE TRIGGER zz_mirror_registration_to_tryout_rsvps AFTER INSERT OR UPDATE ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_registration_to_tryout_rsvps_trg();

REVOKE ALL ON FUNCTION private_sec.mirror_registration_to_tryout_rsvps_trg() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The writes switch, off
-- ---------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('events_v2_writes', '{"enabled": false}'::jsonb,
        'P2-1: when enabled, tryout and clinic sign-ups and cancellations go through events (stage 4a).', true)
ON CONFLICT (key) DO NOTHING;
