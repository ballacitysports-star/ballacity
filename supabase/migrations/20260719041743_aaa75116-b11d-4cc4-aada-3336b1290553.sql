
CREATE OR REPLACE FUNCTION public.notify_trainer_availability_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _trainer_name text;
  _link text;
  _title text;
  _body text;
  _slots_changed boolean;
  _rules_changed boolean;
  _overrides_changed boolean;
  _venue_changed boolean;
  _tz_changed boolean;
  _summary_parts text[] := ARRAY[]::text[];
  _old_slot_count int;
  _new_slot_count int;
  _recipient uuid;
BEGIN
  IF NEW.kind <> 'coach' THEN RETURN NEW; END IF;

  _slots_changed     := (COALESCE(NEW.availability_slots::text,'')     IS DISTINCT FROM COALESCE(OLD.availability_slots::text,''));
  _rules_changed     := (COALESCE(NEW.availability_rules::text,'')     IS DISTINCT FROM COALESCE(OLD.availability_rules::text,''));
  _overrides_changed := (COALESCE(NEW.availability_overrides::text,'') IS DISTINCT FROM COALESCE(OLD.availability_overrides::text,''));
  _venue_changed     := (COALESCE(NEW.venue_addresses::text,'')        IS DISTINCT FROM COALESCE(OLD.venue_addresses::text,''))
                     OR (COALESCE(NEW.primary_venue,'')                 IS DISTINCT FROM COALESCE(OLD.primary_venue,''));
  _tz_changed        := (COALESCE(NEW.timezone,'')                     IS DISTINCT FROM COALESCE(OLD.timezone,''));

  IF NOT (_slots_changed OR _rules_changed OR _overrides_changed OR _venue_changed OR _tz_changed) THEN
    RETURN NEW;
  END IF;

  IF _slots_changed THEN
    _old_slot_count := COALESCE(jsonb_array_length(OLD.availability_slots), 0);
    _new_slot_count := COALESCE(jsonb_array_length(NEW.availability_slots), 0);
    IF _new_slot_count > _old_slot_count THEN
      _summary_parts := _summary_parts || format('added %s weekly window(s)', _new_slot_count - _old_slot_count);
    ELSIF _new_slot_count < _old_slot_count THEN
      _summary_parts := _summary_parts || format('removed %s weekly window(s)', _old_slot_count - _new_slot_count);
    ELSE
      _summary_parts := _summary_parts || 'updated weekly availability';
    END IF;
  END IF;
  IF _rules_changed     THEN _summary_parts := _summary_parts || 'updated recurring rules'; END IF;
  IF _overrides_changed THEN _summary_parts := _summary_parts || 'updated date overrides'; END IF;
  IF _venue_changed     THEN _summary_parts := _summary_parts || 'updated venues'; END IF;
  IF _tz_changed        THEN _summary_parts := _summary_parts || 'changed timezone'; END IF;

  _trainer_name := COALESCE(NULLIF(NEW.name,''), 'A trainer');
  _link := '/trainers/' || NEW.id::text;
  _title := _trainer_name || ' updated their availability';
  _body := initcap(array_to_string(_summary_parts, ', '));

  FOR _recipient IN
    SELECT DISTINCT uid FROM (
      SELECT from_user_id AS uid
        FROM public.trainer_session_requests
       WHERE trainer_id = NEW.id::text
         AND status IN ('pending','accepted','completed')
      UNION
      SELECT follower_id AS uid
        FROM public.follows
       WHERE followee_id = NEW.owner_id
    ) s
    WHERE uid IS NOT NULL AND uid <> NEW.owner_id
  LOOP
    -- block filter
    IF EXISTS (
      SELECT 1 FROM public.user_blocks
      WHERE (blocker_id = _recipient AND blocked_id = NEW.owner_id)
         OR (blocker_id = NEW.owner_id AND blocked_id = _recipient)
    ) THEN CONTINUE; END IF;

    -- 30-minute debounce per (recipient, trainer)
    IF EXISTS (
      SELECT 1 FROM public.notifications
      WHERE user_id = _recipient
        AND type = 'trainer_availability'
        AND link = _link
        AND created_at > now() - interval '30 minutes'
    ) THEN CONTINUE; END IF;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_recipient, 'trainer_availability', _title, NULLIF(_body,''), _link);
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_trainer_availability_change ON public.teams;
CREATE TRIGGER trg_notify_trainer_availability_change
AFTER UPDATE ON public.teams
FOR EACH ROW
EXECUTE FUNCTION public.notify_trainer_availability_change();
