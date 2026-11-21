-- WP 1.1 (availability-first, Phase 1): a 'pickup' intent, an owner's pause, and availability that ends on its own.
--
-- WHY. Availability is about to be the main screen. A post today never ends: a one-off "free Saturday" stays listed for months after the
-- Saturday, and a weekly post stays listed after the player stopped playing. The only intents are 'guest' and 'tryout', so a player cannot
-- say "I'm up for pickup". And an owner cannot step away for a while without deleting the post.
--
-- WHAT THIS DOES.
--   1. Intent: looking_for also accepts 'pickup'. 'guest' and 'tryout' are unchanged.
--   2. Status: 'paused' (the owner's switch; listed to nobody else) and 'expired' (set by server code, WP 1.2) join 'open', 'closed' and
--      'inactive'.
--   3. last_confirmed_at: when the owner last said the post is still true. It starts at now() for every existing post (a grace period
--      from the day this is applied, not a rewrite of any row), and moves to now() when the owner reconfirms, resumes or edits the times.
--   4. When a post stops being listed (private_sec.availability_expires_at), worked out in the database from the post itself:
--        - any weekly slot: 14 days after last_confirmed_at, so a standing schedule needs a tap every two weeks;
--        - only dated slots: when the last slot ends, in the post's own timezone (America/New_York when it has none or an unknown one);
--        - no slots, legacy ends_on: the end of that day; otherwise 14 days after last_confirmed_at.
--      The read policy lists an open post to others only before that time. The author and their guardian still see it. Any error in
--      the computation (a malformed legacy row) yields NULL, which lists the post as before rather than failing the whole listing.
--   5. The author's fields (replaces WP 1.0's guard_availability_moderation_fields, same trigger, now on INSERT too): a signed-in client
--      may create a post 'open' or 'paused', and move its own post only between 'open' and 'paused', or from 'expired' back to 'open'.
--      'closed' and 'inactive' (BallaCity's and a guardian's) stay locked, as does hidden_at. last_confirmed_at can only be moved to now().
--
-- EXISTING DATA. No row is rewritten. Weekly and slot-less posts get 14 days from the apply; dated posts whose last slot has passed stop
-- being listed at once (they were already in the past).
-- COMPATIBILITY. The current app never writes status or last_confirmed_at, and does not know 'pickup' yet (it drops unknown intents
-- when reading, so an older app shows a pickup post without the badge). The app in this commit knows 'pickup'.
-- ROLLBACK: docs/rollbacks/20261114110000_availability_intent_and_lifecycle.down.sql (guarded).
-- TEST: supabase/tests/850_availability_intent_and_lifecycle.test.sql.

SET lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.availability_post_visible(uuid)') IS NULL
     OR to_regprocedure('public.guard_availability_moderation_fields()') IS NULL THEN
    RAISE EXCEPTION 'availability intent and lifecycle: 20261114100000_availability_privacy_foundation must be applied first';
  END IF;
END $guard$;

-- 1. Intent ------------------------------------------------------------------------------------------------------------------------------------
ALTER TABLE public.player_availabilities DROP CONSTRAINT IF EXISTS player_availabilities_looking_for_check;
ALTER TABLE public.player_availabilities
  ADD CONSTRAINT player_availabilities_looking_for_check
  CHECK (looking_for <@ ARRAY['pickup', 'guest', 'tryout']::text[]);

-- 3. last_confirmed_at (a constant default: existing rows read it without a table rewrite) -----------------------------------------------------
ALTER TABLE public.player_availabilities
  ADD COLUMN IF NOT EXISTS last_confirmed_at timestamptz NOT NULL DEFAULT now();

-- 4. When a post stops being listed -----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.availability_expires_at(
  _slots jsonb, _tz text, _starts date, _ends date, _confirmed timestamptz)
RETURNS timestamptz LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE
  _recur interval := interval '14 days';
  _last  timestamp;
BEGIN
  IF _slots IS NOT NULL AND jsonb_typeof(_slots) = 'array' AND jsonb_array_length(_slots) > 0 THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(_slots) s WHERE s ? 'weekday') THEN
      RETURN _confirmed + _recur;
    END IF;
    SELECT max((s ->> 'date')::date + (s ->> 'end')::interval) INTO _last
      FROM jsonb_array_elements(_slots) s WHERE s ? 'date';
  ELSIF _ends IS NOT NULL THEN
    _last := _ends + interval '1 day';
  END IF;
  IF _last IS NULL THEN
    RETURN _confirmed + _recur;
  END IF;
  BEGIN
    RETURN _last AT TIME ZONE COALESCE(NULLIF(btrim(_tz), ''), 'America/New_York');
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN _last AT TIME ZONE 'America/New_York';
  END;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;   -- a malformed legacy row is listed as before rather than breaking every listing
END $$;
REVOKE ALL ON FUNCTION private_sec.availability_expires_at(jsonb, text, date, date, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.availability_expires_at(jsonb, text, date, date, timestamptz) TO authenticated, service_role;

DROP POLICY IF EXISTS "Availability visible to permitted viewers" ON public.player_availabilities;
CREATE POLICY "Availability visible to permitted viewers" ON public.player_availabilities
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private_sec.is_guardian_of(auth.uid(), user_id)
    OR (status = 'open' AND hidden_at IS NULL
        AND COALESCE(private_sec.availability_expires_at(time_slots, timezone, starts_on, ends_on, last_confirmed_at) > now(), true)
        AND private_sec.availability_post_visible(user_id))
  );

-- 4b. Requests and invitations follow the same rule (WP 1.0's check, plus expiry) -------------------------------------------------------------
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
         OR (a.status = 'open' AND a.hidden_at IS NULL
             AND COALESCE(private_sec.availability_expires_at(a.time_slots, a.timezone, a.starts_on, a.ends_on, a.last_confirmed_at) > now(), true)
             AND private_sec.availability_post_visible(a.user_id))
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
REVOKE ALL ON FUNCTION public.guard_contact_request_minor_recipient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_contact_request_minor_recipient() TO service_role;

-- 5. The author's fields ------------------------------------------------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user is 'authenticated' only when a signed-in client writes the row itself. Inside a SECURITY DEFINER
-- function (revoke_parental_consent, moderator_scrub_availability_note) it is the function's owner, and for server code it is service_role.
CREATE OR REPLACE FUNCTION public.guard_availability_moderation_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('open', 'paused') OR NEW.hidden_at IS NOT NULL THEN
      RAISE EXCEPTION 'AVAILABILITY_FIELD_FORBIDDEN: a new post starts open or paused.' USING ERRCODE = '42501';
    END IF;
    NEW.last_confirmed_at := now();
    RETURN NEW;
  END IF;

  IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at THEN
    RAISE EXCEPTION 'AVAILABILITY_FIELD_FORBIDDEN: this post''s visibility is managed by BallaCity.' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (OLD.status IN ('open', 'paused', 'expired') AND NEW.status IN ('open', 'paused')) THEN
    RAISE EXCEPTION 'AVAILABILITY_FIELD_FORBIDDEN: this post''s visibility is managed by BallaCity.' USING ERRCODE = '42501';
  END IF;
  -- Reconfirming: the author can only move last_confirmed_at to now. Resuming, reopening an expired post or changing the times counts.
  IF NEW.last_confirmed_at IS DISTINCT FROM OLD.last_confirmed_at
     OR (NEW.status = 'open' AND OLD.status IN ('paused', 'expired'))
     OR NEW.time_slots IS DISTINCT FROM OLD.time_slots THEN
    NEW.last_confirmed_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_availability_moderation_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_availability_moderation_fields() TO authenticated, service_role;
DROP TRIGGER IF EXISTS a1_guard_availability_moderation_fields_trg ON public.player_availabilities;
CREATE TRIGGER a1_guard_availability_moderation_fields_trg BEFORE INSERT OR UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_moderation_fields();

-- 2. Status vocabulary. Body as in 20261114100000 except the status line. -----------------------------------------------------------------------
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

  -- 'paused': the author's switch. 'expired': set by server code when a post has run out.
  -- 'closed': BallaCity's. 'inactive': closed by a guardian's consent revocation (revoke_parental_consent).
  IF NEW.status NOT IN ('open','paused','expired','closed','inactive') THEN
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
