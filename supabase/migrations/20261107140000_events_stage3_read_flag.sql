-- P2-1 stage 3: reads can come from events, behind a switch that is off.
-- Design: docs/design/p2-1-events.md. Builds on stages 1 and 2 (20261106220000, 20261107120000).
--
-- 1. event_evaluations: the events counterpart of tryout_evaluations (attended, score, notes per
--    registration). Same access as today: team staff only (tryout_evaluations is readable and
--    writable by team managers only). Clients may read; nobody writes it directly. A trigger on
--    tryout_evaluations keeps it in step, and existing evaluations are copied below. Writes move to
--    events in stage 4.
-- 2. get_event_locations(ids): the venue of each event the caller may locate, in one call, under
--    the same rule as get_event_location (D0). Signed-in callers only.
-- 3. app_settings 'events_v2' = {"enabled": false}, public. While it is off the app reads exactly
--    what it reads today. Turning it on makes the team events page read events instead of team_posts.
--    It is turned on by the owner, not by this migration.
--
-- Rollback: docs/rollbacks/20261107140000_events_stage3_read_flag.down.sql.

-- ---------------------------------------------------------------------------
-- 1. Evaluations
-- ---------------------------------------------------------------------------
CREATE TABLE public.event_evaluations (
  registration_id uuid PRIMARY KEY REFERENCES public.event_registrations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  attended boolean,
  score smallint CHECK (score IS NULL OR score BETWEEN 0 AND 100),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 2000),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_evaluations_event_idx ON public.event_evaluations (event_id);

REVOKE ALL ON public.event_evaluations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.event_evaluations TO service_role;
GRANT SELECT ON public.event_evaluations TO authenticated;
ALTER TABLE public.event_evaluations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "event_evaluations_staff_read" ON public.event_evaluations FOR SELECT TO authenticated
  USING (private_sec.is_event_staff(event_id, auth.uid()));

-- Copy one tryout evaluation (by its RSVP) onto the matching registration, or remove the copy.
CREATE OR REPLACE FUNCTION private_sec.mirror_tryout_evaluation(_rsvp uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r public.tryout_rsvps;
  v public.tryout_evaluations;
  _reg uuid;
  _ev uuid;
BEGIN
  SELECT * INTO r FROM public.tryout_rsvps WHERE id = _rsvp;
  IF r.id IS NULL THEN RETURN; END IF;  -- the RSVP is gone; its registration (and copy) follow it
  SELECT g.id, g.event_id INTO _reg, _ev
    FROM public.event_registrations g JOIN public.events e ON e.id = g.event_id
   WHERE e.legacy_post_id = r.post_id AND g.user_id = r.user_id;
  IF _reg IS NULL THEN RETURN; END IF;
  SELECT * INTO v FROM public.tryout_evaluations WHERE rsvp_id = _rsvp;
  IF v.rsvp_id IS NULL THEN
    DELETE FROM public.event_evaluations WHERE registration_id = _reg;
    RETURN;
  END IF;
  INSERT INTO public.event_evaluations (registration_id, event_id, attended, score, notes, updated_by, updated_at)
  VALUES (_reg, _ev, v.attended, v.score, v.notes, v.updated_by, v.updated_at)
  ON CONFLICT (registration_id) DO UPDATE
    SET attended = EXCLUDED.attended, score = EXCLUDED.score, notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$$;

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

DROP TRIGGER IF EXISTS zz_mirror_event_evaluations ON public.tryout_evaluations;
CREATE TRIGGER zz_mirror_event_evaluations AFTER INSERT OR UPDATE OR DELETE ON public.tryout_evaluations
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_tryout_evaluations_trg();

-- A registration copied after its evaluation (the evaluation trigger found no registration yet)
-- picks the evaluation up when the registration is copied.
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

DROP TRIGGER IF EXISTS zz_mirror_evaluation_on_registration ON public.event_registrations;
CREATE TRIGGER zz_mirror_evaluation_on_registration AFTER INSERT ON public.event_registrations
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_evaluation_for_registration_trg();

REVOKE ALL ON FUNCTION private_sec.mirror_tryout_evaluation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_tryout_evaluations_trg() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.mirror_evaluation_for_registration_trg() FROM PUBLIC, anon, authenticated;

-- Backfill existing evaluations.
DO $backfill$
DECLARE
  _e record;
BEGIN
  FOR _e IN SELECT rsvp_id FROM public.tryout_evaluations LOOP
    BEGIN
      PERFORM private_sec.mirror_tryout_evaluation(_e.rsvp_id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
      VALUES ('tryout_evaluations', _e.rsvp_id::text, 'BACKFILL', SQLSTATE || ': ' || left(SQLERRM, 300));
    END;
  END LOOP;
END
$backfill$;

-- ---------------------------------------------------------------------------
-- 2. Venues in one call
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_event_locations(_ids uuid[])
RETURNS TABLE (event_id uuid, place_id text, formatted_address text, lat numeric, lng numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT l.event_id, l.place_id, l.formatted_address, l.lat, l.lng
    FROM public.event_locations l
   WHERE l.event_id = ANY (_ids[1:200])
     AND private_sec.can_see_event_location(l.event_id, auth.uid());
$$;
REVOKE ALL ON FUNCTION public.get_event_locations(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_event_locations(uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The switch, off
-- ---------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES ('events_v2', '{"enabled": false}'::jsonb,
        'P2-1: when enabled, the team events page reads events instead of team_posts (stage 3).', true)
ON CONFLICT (key) DO NOTHING;
