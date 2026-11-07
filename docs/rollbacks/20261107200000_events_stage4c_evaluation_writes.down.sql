-- ROLLBACK for supabase/migrations/20261107200000_events_stage4c_evaluation_writes.sql (P2-1 stage 4c).
-- NOT a migration. It removes save_event_evaluation and the reverse evaluation mirror, and puts the two
-- stage 3 forward mirrors back exactly as stage 3 left them.
-- Turn events_v2_writes off first. Evaluations already saved through events were written back to
-- tryout_evaluations by the reverse mirror, so nothing a coach entered is lost.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_events_stage4c=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_events_stage4c', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback removes save_event_evaluation and the reverse evaluation mirror. Set app.confirm_drop_events_stage4c=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS zz_mirror_evaluation_to_tryout ON public.event_evaluations;
DROP FUNCTION IF EXISTS private_sec.mirror_evaluation_to_tryout_trg();
DROP FUNCTION IF EXISTS public.save_event_evaluation(uuid, uuid, boolean, smallint, text);

-- Stage 3's forward mirrors, unchanged (20261107140000).
CREATE OR REPLACE FUNCTION private_sec.mirror_tryout_evaluations_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _rsvp uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.rsvp_id ELSE NEW.rsvp_id END;
BEGIN
  BEGIN
    PERFORM private_sec.mirror_tryout_evaluation(_rsvp);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
    VALUES ('tryout_evaluations', _rsvp::text, TG_OP, SQLSTATE || ': ' || left(SQLERRM, 300));
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private_sec.mirror_evaluation_for_registration_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _rsvp uuid;
BEGIN
  SELECT r.id INTO _rsvp FROM public.tryout_rsvps r JOIN public.events e ON e.legacy_post_id = r.post_id
   WHERE e.id = NEW.event_id AND r.user_id = NEW.user_id;
  IF _rsvp IS NOT NULL THEN
    BEGIN
      PERFORM private_sec.mirror_tryout_evaluation(_rsvp);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
      VALUES ('tryout_evaluations', _rsvp::text, 'REGISTRATION', SQLSTATE || ': ' || left(SQLERRM, 300));
    END;
  END IF;
  RETURN NULL;
END;
$$;
COMMIT;
