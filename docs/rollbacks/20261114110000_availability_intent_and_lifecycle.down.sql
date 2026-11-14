-- ROLLBACK for supabase/migrations/20261114110000_availability_intent_and_lifecycle.sql (WP 1.1).
-- NOT a migration. It puts back WP 1.0 (20261114100000) as that file left it:
--   * the read policy and the contact-request guard without the expiry rule, so posts never stop being listed again;
--   * validate_player_availability allowing only open, closed and inactive;
--   * the author's-fields guard on UPDATE only (open/paused moves and last_confirmed_at handling go away);
--   * looking_for back to guest and tryout;
--   * drops private_sec.availability_expires_at.
-- It KEEPS the last_confirmed_at column (dropping it would delete data; nothing reads it after the rollback).
-- It REFUSES, changing nothing, while any post uses 'pickup', 'paused' or 'expired': those rows would break the restored checks, and
-- what to do with them (drop the intent, reopen or close the post) is a decision for a person, not this script.
-- It stops, changing nothing, if a function or the policy no longer has the definition 20261114110000 gave it.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_availability_intent_and_lifecycle_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"private_sec.availability_expires_at(jsonb,text,date,date,timestamptz)": "2398ffa9673edd535801221e7c64932d", "public.guard_contact_request_minor_recipient()": "133870f5e227de370a5a4ae34aeb7c0d", "public.guard_availability_moderation_fields()": "589acbb814ded4fe89c27af4079a6c69", "public.validate_player_availability()": "f06e36ef3895bab2cdef20c0b02f200b"}'::jsonb;
  _k text;
  _got text;
  _n int;
BEGIN
  IF current_setting('app.confirm_availability_intent_and_lifecycle_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this makes every availability post stay listed forever again and removes the pickup intent and the author''s pause. Set app.confirm_availability_intent_and_lifecycle_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261114110000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
  SELECT md5(pg_get_expr(polqual, polrelid)) INTO _got FROM pg_policy
   WHERE polrelid = 'public.player_availabilities'::regclass AND polname = 'Availability visible to permitted viewers';
  IF _got IS DISTINCT FROM 'da35880de4e1b93d3c8d129e3d961683' THEN
    RAISE EXCEPTION 'Refusing to run: the read policy is not the one 20261114110000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
  SELECT count(*) INTO _n FROM public.player_availabilities WHERE 'pickup' = ANY (looking_for) OR status IN ('paused', 'expired');
  IF _n > 0 THEN
    RAISE EXCEPTION 'Refusing to run: % post(s) use pickup, paused or expired. Decide what happens to them first.', _n;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP POLICY IF EXISTS "Availability visible to permitted viewers" ON public.player_availabilities;
CREATE POLICY "Availability visible to permitted viewers" ON public.player_availabilities
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private_sec.is_guardian_of(auth.uid(), user_id)
    OR (status = 'open' AND hidden_at IS NULL AND private_sec.availability_post_visible(user_id))
  );

CREATE OR REPLACE FUNCTION public.guard_contact_request_minor_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _me    uuid := auth.uid();
  _owner uuid;
  _ok    boolean;
  _block text;
BEGIN
  IF _me IS NULL THEN RETURN NEW; END IF;   -- service-role maintenance
  IF NEW.from_user_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'from_user_id must match the signed-in user.' USING ERRCODE = '42501';
  END IF;
  IF NEW.to_user_id IS NOT DISTINCT FROM _me THEN
    RAISE EXCEPTION 'Cannot contact yourself.';
  END IF;

  -- The post must exist, belong to the recipient and be readable by the sender (the read policy's rule). One answer for every failure.
  SELECT a.user_id,
         private_sec.is_guardian_of(_me, a.user_id)
         OR (a.status = 'open' AND a.hidden_at IS NULL AND private_sec.availability_post_visible(a.user_id))
    INTO _owner, _ok
    FROM public.player_availabilities a
   WHERE a.id = NEW.availability_id;
  IF _owner IS NULL OR _owner IS DISTINCT FROM NEW.to_user_id OR NOT COALESCE(_ok, false) THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:recipient_restricted:other' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The messaging rules for minors (guardian controls, the under-16 shared-context rule) apply to requests as to conversations.
  _block := public.minor_messaging_block(_me, NEW.to_user_id);
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', CASE WHEN _block LIKE '%:self' THEN _block ELSE 'recipient_restricted:other' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.guard_availability_moderation_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'AVAILABILITY_FIELD_FORBIDDEN: this post''s visibility is managed by BallaCity.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER a1_guard_availability_moderation_fields_trg ON public.player_availabilities;
CREATE TRIGGER a1_guard_availability_moderation_fields_trg BEFORE UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_moderation_fields();

CREATE OR REPLACE FUNCTION public.validate_player_availability()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _allowed_days  text[] := ARRAY['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  _allowed_sport text[] := ARRAY['Baseball','Basketball','Football','Pickleball','Running','Soccer','Softball','Tennis','Volleyball','Flag Football'];
  d text;
  s text;
  slot jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'user_id is immutable.' USING ERRCODE = '42501';
  END IF;

  -- Skill level is validated for shape only; per-sport tier correctness is
  -- enforced in the app, which owns each sport's scale.
  IF NEW.skill_level IS NULL OR length(btrim(NEW.skill_level)) = 0 THEN
    RAISE EXCEPTION 'Invalid skill_level: %', NEW.skill_level;
  END IF;
  IF length(NEW.skill_level) > 120 THEN
    RAISE EXCEPTION 'skill_level too long (max 120 characters).';
  END IF;

  IF NEW.travel_radius_km IS NULL OR NEW.travel_radius_km < 1 OR NEW.travel_radius_km > 20200 THEN
    RAISE EXCEPTION 'travel_radius_km must be between 1 and 20200.';
  END IF;

  -- 'inactive': closed by a guardian's consent revocation (revoke_parental_consent).
  IF NEW.status NOT IN ('open','closed','inactive') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;

  IF NEW.sports IS NULL OR array_length(NEW.sports, 1) IS NULL THEN
    RAISE EXCEPTION 'At least one sport is required.';
  END IF;
  IF array_length(NEW.sports, 1) > 10 THEN
    RAISE EXCEPTION 'Too many sports (max 10).';
  END IF;
  FOREACH s IN ARRAY NEW.sports LOOP
    IF NOT (s = ANY(_allowed_sport)) THEN
      RAISE EXCEPTION 'Unknown sport: %', s;
    END IF;
  END LOOP;

  IF NEW.recurring_days IS NOT NULL AND array_length(NEW.recurring_days, 1) IS NOT NULL THEN
    IF array_length(NEW.recurring_days, 1) > 7 THEN
      RAISE EXCEPTION 'recurring_days has too many entries.';
    END IF;
    FOREACH d IN ARRAY NEW.recurring_days LOOP
      IF NOT (d = ANY(_allowed_days)) THEN
        RAISE EXCEPTION 'Unknown day: %', d;
      END IF;
    END LOOP;
  END IF;

  IF NEW.note IS NOT NULL AND length(NEW.note) > 500 THEN
    RAISE EXCEPTION 'Note too long (max 500 characters).';
  END IF;
  IF NEW.city IS NOT NULL AND length(NEW.city) > 120 THEN
    RAISE EXCEPTION 'City too long (max 120 characters).';
  END IF;

  IF NEW.starts_on IS NOT NULL AND NEW.ends_on IS NOT NULL AND NEW.ends_on < NEW.starts_on THEN
    RAISE EXCEPTION 'ends_on cannot be before starts_on.';
  END IF;

  IF NEW.time_slots IS NULL THEN
    NEW.time_slots := '[]'::jsonb;
  END IF;
  IF jsonb_typeof(NEW.time_slots) <> 'array' THEN
    RAISE EXCEPTION 'time_slots must be an array.';
  END IF;
  IF jsonb_array_length(NEW.time_slots) > 40 THEN
    RAISE EXCEPTION 'Too many time slots (max 40).';
  END IF;
  FOR slot IN SELECT * FROM jsonb_array_elements(NEW.time_slots) LOOP
    IF jsonb_typeof(slot) <> 'object' THEN
      RAISE EXCEPTION 'Each time slot must be an object.';
    END IF;
    IF (slot->>'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' THEN
      RAISE EXCEPTION 'Invalid slot start time: %', slot->>'start';
    END IF;
    IF (slot->>'end') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' THEN
      RAISE EXCEPTION 'Invalid slot end time: %', slot->>'end';
    END IF;
    IF (slot->>'end') <= (slot->>'start') THEN
      RAISE EXCEPTION 'Slot end must be after start.';
    END IF;
    IF slot ? 'date' THEN
      IF (slot->>'date') !~ '^\d{4}-\d{2}-\d{2}$' THEN
        RAISE EXCEPTION 'Invalid slot date: %', slot->>'date';
      END IF;
    ELSIF slot ? 'weekday' THEN
      IF (slot->>'weekday') !~ '^[0-6]$' THEN
        RAISE EXCEPTION 'Invalid slot weekday: %', slot->>'weekday';
      END IF;
    ELSE
      RAISE EXCEPTION 'Each time slot needs a date or a weekday.';
    END IF;
  END LOOP;

  IF NEW.timezone IS NOT NULL AND length(NEW.timezone) > 64 THEN
    RAISE EXCEPTION 'timezone too long.';
  END IF;

  RETURN NEW;
END;
$function$;

ALTER TABLE public.player_availabilities DROP CONSTRAINT player_availabilities_looking_for_check;
ALTER TABLE public.player_availabilities
  ADD CONSTRAINT player_availabilities_looking_for_check
  CHECK (looking_for <@ ARRAY['guest', 'tryout']::text[]);

DROP FUNCTION private_sec.availability_expires_at(jsonb, text, date, date, timestamptz);

COMMIT;
