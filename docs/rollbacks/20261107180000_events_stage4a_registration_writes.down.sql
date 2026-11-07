-- ROLLBACK for supabase/migrations/20261107180000_events_stage4a_registration_writes.sql (P2-1 stage 4a).
-- NOT a migration. It puts register_for_event, cancel_event_registration and the stage 2 forward mirror
-- back exactly as stages 1 and 2 left them, removes the reverse mirror and the events_v2_writes switch.
-- Turn events_v2_writes off first and let in-flight sign-ups finish. Registrations already made through
-- events were written back to tryout_rsvps by the reverse mirror, so nothing is lost.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_events_stage4a=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_events_stage4a', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback reverts events sign-ups to stage 1 and removes the reverse mirror and the events_v2_writes switch. Set app.confirm_drop_events_stage4a=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DELETE FROM public.app_settings WHERE key = 'events_v2_writes';
DROP TRIGGER IF EXISTS zz_mirror_registration_to_tryout_rsvps ON public.event_registrations;
DROP FUNCTION IF EXISTS private_sec.mirror_registration_to_tryout_rsvps_trg();

-- Stage 2's forward mirror, unchanged (20261107120000).
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

-- Stage 1's sign-up and cancel, unchanged (20261106220000).
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
COMMIT;
