-- P2-1 stage 4c: coach evaluations can be written through events, behind events_v2_writes (stage 4a).
-- Design: docs/design/p2-1-events.md (stage 4, D5, D6). Builds on stages 3 and 4a.
--
-- 1. save_event_evaluation(event, user, attended, score, notes): team staff (owner, manager, coach;
--    the same people tryout_evaluations lets write today) record attendance, score and notes for a
--    registered (or cancelled) person. For a copied tryout, today's limits apply: score 1 to 10,
--    notes up to 1000 characters. Events created as events allow score 0 to 100 and 2000 characters.
-- 2. Reverse mirror: an evaluation saved on a copied event is written back to tryout_evaluations, so
--    the coach's results page and the player's "Your result" (both read tryout_evaluations) keep
--    working. Errors are not swallowed: the save fails rather than the two disagreeing.
-- 3. The stage 3 forward mirrors respect the app.event_mirror marker (stage 4a), so the two
--    directions do not copy each other's writes back and forth.
--
-- Rollback: docs/rollbacks/20261107200000_events_stage4c_evaluation_writes.down.sql.

-- ---------------------------------------------------------------------------
-- 1. Saving an evaluation
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_event_evaluation(
  _event uuid,
  _user uuid,
  _attended boolean,
  _score smallint DEFAULT NULL,
  _notes text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me uuid := auth.uid();
  _ev public.events;
  _reg uuid;
  _clean_notes text := NULLIF(btrim(COALESCE(_notes, '')), '');
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _ev FROM public.events WHERE id = _event;
  IF _ev.id IS NULL OR NOT private_sec.is_event_staff(_event, _me) THEN
    RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO _reg FROM public.event_registrations WHERE event_id = _event AND user_id = _user;
  IF _reg IS NULL THEN
    RAISE EXCEPTION 'NOT_REGISTERED' USING ERRCODE = 'P0002';
  END IF;
  IF _ev.legacy_post_id IS NOT NULL THEN
    IF (_score IS NOT NULL AND (_score < 1 OR _score > 10)) OR char_length(COALESCE(_clean_notes, '')) > 1000 THEN
      RAISE EXCEPTION 'INVALID_EVALUATION' USING ERRCODE = '22023';
    END IF;
  ELSIF (_score IS NOT NULL AND (_score < 0 OR _score > 100)) OR char_length(COALESCE(_clean_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'INVALID_EVALUATION' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.event_evaluations (registration_id, event_id, attended, score, notes, updated_by, updated_at)
  VALUES (_reg, _event, COALESCE(_attended, false), _score, _clean_notes, _me, now())
  ON CONFLICT (registration_id) DO UPDATE
    SET attended = EXCLUDED.attended, score = EXCLUDED.score, notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
END;
$$;
REVOKE ALL ON FUNCTION public.save_event_evaluation(uuid, uuid, boolean, smallint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_event_evaluation(uuid, uuid, boolean, smallint, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Reverse mirror: event_evaluations on a copied event -> tryout_evaluations
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.mirror_evaluation_to_tryout_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _row public.event_evaluations := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  _post uuid;
  _team text;
  _rsvp uuid;
BEGIN
  IF COALESCE(current_setting('app.event_mirror', true), '') <> '' THEN
    RETURN NULL;
  END IF;
  SELECT e.legacy_post_id, e.team_id INTO _post, _team FROM public.events e WHERE e.id = _row.event_id;
  IF _post IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT r.id INTO _rsvp
    FROM public.tryout_rsvps r JOIN public.event_registrations g ON g.user_id = r.user_id
   WHERE g.id = _row.registration_id AND r.post_id = _post;
  IF _rsvp IS NULL THEN
    -- A delete cascading from a deleted post or RSVP: the old row is already gone.
    IF TG_OP = 'DELETE' THEN RETURN NULL; END IF;
    RAISE EXCEPTION 'EVALUATION_MIRROR_NO_RSVP' USING ERRCODE = 'P0002';
  END IF;

  PERFORM set_config('app.event_mirror', 'reverse', true);
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.tryout_evaluations WHERE rsvp_id = _rsvp;
  ELSE
    INSERT INTO public.tryout_evaluations (rsvp_id, post_id, team_id, attended, score, notes, updated_by, updated_at)
    VALUES (_rsvp, _post, _team, COALESCE(NEW.attended, false), NEW.score, NEW.notes,
            COALESCE(NEW.updated_by, auth.uid()), NEW.updated_at)
    ON CONFLICT (rsvp_id) DO UPDATE
      SET attended = EXCLUDED.attended, score = EXCLUDED.score, notes = EXCLUDED.notes,
          updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at;
  END IF;
  PERFORM set_config('app.event_mirror', '', true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS zz_mirror_evaluation_to_tryout ON public.event_evaluations;
CREATE TRIGGER zz_mirror_evaluation_to_tryout AFTER INSERT OR UPDATE OR DELETE ON public.event_evaluations
  FOR EACH ROW EXECUTE FUNCTION private_sec.mirror_evaluation_to_tryout_trg();
REVOKE ALL ON FUNCTION private_sec.mirror_evaluation_to_tryout_trg() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Stage 3's forward mirrors, marker-aware
-- ---------------------------------------------------------------------------
-- tryout_evaluations -> event_evaluations: skips a write the reverse mirror made; marks its own.
CREATE OR REPLACE FUNCTION private_sec.mirror_tryout_evaluations_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _rsvp uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.rsvp_id ELSE NEW.rsvp_id END;
BEGIN
  IF COALESCE(current_setting('app.event_mirror', true), '') <> '' THEN
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM set_config('app.event_mirror', 'forward', true);
    PERFORM private_sec.mirror_tryout_evaluation(_rsvp);
    PERFORM set_config('app.event_mirror', '', true);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
    VALUES ('tryout_evaluations', _rsvp::text, TG_OP, SQLSTATE || ': ' || left(SQLERRM, 300));
  END;
  RETURN NULL;
END;
$$;

-- A new registration picks up an existing evaluation. It runs whichever path created the
-- registration (old-path mirror or register_for_event), so it does not skip on the marker; it
-- marks its own copy (restoring the marker after) so the reverse mirror leaves it alone.
CREATE OR REPLACE FUNCTION private_sec.mirror_evaluation_for_registration_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _rsvp uuid;
  _prev text := COALESCE(current_setting('app.event_mirror', true), '');
BEGIN
  SELECT r.id INTO _rsvp FROM public.tryout_rsvps r JOIN public.events e ON e.legacy_post_id = r.post_id
   WHERE e.id = NEW.event_id AND r.user_id = NEW.user_id;
  IF _rsvp IS NOT NULL THEN
    BEGIN
      PERFORM set_config('app.event_mirror', 'forward', true);
      PERFORM private_sec.mirror_tryout_evaluation(_rsvp);
      PERFORM set_config('app.event_mirror', _prev, true);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO private_sec.event_mirror_failures (source, source_id, op, error)
      VALUES ('tryout_evaluations', _rsvp::text, 'REGISTRATION', SQLSTATE || ': ' || left(SQLERRM, 300));
    END;
  END IF;
  RETURN NULL;
END;
$$;
