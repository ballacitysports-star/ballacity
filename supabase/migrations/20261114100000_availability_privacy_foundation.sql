-- WP 1.0 (availability-first, Phase 1): the privacy floor for player availability, before availability becomes the main screen.
--
-- Ports R2 (#265, branch claude/r2-minor-availability-privacy, file 20261106100000_minor_availability_privacy.sql) onto main, plus
-- the two helpers it needs from the unmerged PRIV-2B/2D stack, and fixes three defects found by the Phase 0 audit (2026-11-14).
--
-- WHY. The only SELECT policy on player_availabilities ("Open availabilities visible to authenticated users", 20260715040319) lets every
-- signed-in account read every open post: the author's account id, sports, skill, a weekly schedule, travel radius, city, coordinates and a
-- free-text note. Minors can post (block_locked_child_activity only stops unknown ages and unconsented under-16s), so a stranger can list
-- minors by sport, schedule and area. The same policy ignores hidden_at, so a post a superadmin hides from the live listings stays readable,
-- and it ignores blocks and suspended accounts. Contact requests and game invitations sent from a post skip the minor-messaging rules, and
-- their triggers fire in name order, so the block guard answered "one of you blocked the other" for any pair of ids before the identity check.
--
-- WHAT THIS DOES.
--   1. Helpers (bodies as in the PRIV stack, repointed at private_sec per SEC-2): private_sec.can_see_minor_name (PRIV-2B,
--      20261104120000) and private_sec.text_discloses_location / location_tokens (PRIV-2D, 20261104130000). Service role only; called from
--      the definer functions below.
--   2. Reads (R2 as designed). A post is readable by its author, the author's verified guardian, and, while open and not hidden, by a viewer
--      private_sec.availability_post_visible allows: staff; otherwise anyone not blocked by or blocking the author, when the author is not
--      suspended or banned, and the author is a confirmed adult or someone the viewer may know (can_see_minor_name: shared game, chat or
--      team, hosts and coaches dealing with them, organization administrators, accepted followers). Unknown age counts as not adult.
--      Additions to R2: hidden_at, blocks and suspended/banned authors. Realtime evaluates the same policy per subscriber.
--   3. Writes (R2). A non-adult author's post never stores coordinates, a street address or a place id, and a note that names an address,
--      map link or coordinates is refused (LOCATION_IN_PUBLIC_TEXT).
--   4. Contact requests and invitations (R2, aligned with SEC-2b). A new request is accepted only from the signed-in sender, for a post that
--      sender can read, addressed to its author; the minor-messaging rules (public.minor_messaging_block) now apply to requests too. Every
--      refusal about the recipient or the post is the one SEC-2b code, MINOR_MESSAGING_BLOCKED:recipient_restricted:other ("This player
--      can't receive messages from you right now."); ':self' codes about the sender are unchanged. This trigger fires first, so the older
--      triggers never answer about a pair the caller is not part of.
--   5. Status vocabulary. revoke_parental_consent writes status 'inactive' (20261111120000, line 639) but validate_player_availability
--      allowed only 'open' and 'closed', so revoking consent for a child with an availability post raised "Invalid status: inactive" and
--      rolled the whole revocation back. 'inactive' is now valid.
--   6. Moderation fields. A signed-in client can no longer change status or hidden_at on its own post (it could unhide a post BallaCity hid,
--      or reopen one BallaCity closed or a guardian's revocation closed). Service-role code, definer functions and moderators' server paths
--      are unaffected. The app never writes either column from the client.
--   7. guard_participant_self_update (20260915214808) looked up public.games, which does not exist; a player changing their own position
--      in a game failed with "relation does not exist". It now reads public.hosted_games, as intended.
--   8. Legacy-data procedures from R2 (defined, NOT run): blank_minor_availability_location, list_minor_availability_notes_with_location_text,
--      moderator_scrub_availability_note. Running the blanking needs a separate owner approval (docs/release/legacy-data-procedures.md).
--
-- EXISTING DATA. Nothing is rewritten. Posts by minors become unreadable to unrelated accounts as soon as the policy is in place.
-- COMPATIBILITY. The app's listing query is unchanged (it reads what the policy allows): an older app sees fewer posts. The app in this
-- commit maps the new refusal code in the contact dialog; an older build shows the raw code text, which is why the app ships first.
-- SUPERSEDES #265 (R2). Its file must not be applied after this one (its CREATE POLICY would fail on the existing name). The PRIV-2B/2D
-- branches redefine the two helpers with CREATE OR REPLACE and the same signatures, so they stay compatible.
-- ROLLBACK: docs/rollbacks/20261114100000_availability_privacy_foundation.down.sql (guarded; it reopens minors' posts to every account).
-- TEST: supabase/tests/840_availability_privacy_foundation.test.sql.

SET lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.rpc_probe_denied(text,uuid[],name)') IS NULL
     OR to_regprocedure('private_sec.is_guardian_of(uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.blocks_exist_between(uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.direct_message_refusal(uuid,uuid)') IS NULL
     OR to_regprocedure('public.minor_messaging_block(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'availability privacy foundation: SEC-2 (20261112150000) and SEC-2b (20261113120000) must be applied first';
  END IF;
END $guard$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 1. Helpers from the PRIV stack
-- ---------------------------------------------------------------------------------------------------------------------------------------------

-- PRIV-2D: one detector for "this free text gives away a place". A heuristic; NULL when the text is acceptable, else the first reason found.
CREATE OR REPLACE FUNCTION private_sec.location_tokens(_t text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT COALESCE(
    regexp_split_to_array(NULLIF(btrim(regexp_replace(lower(COALESCE(_t, '')), '[^a-z0-9]+', ' ', 'g')), ''), ' '),
    ARRAY[]::text[])
$$;

CREATE OR REPLACE FUNCTION private_sec.text_discloses_location(_text text, _exact_location text DEFAULT NULL)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE
  _t     text := COALESCE(_text, '');
  _norm  text;
  _segs  text[];
  _seg   text;
  _toks  text[];
  _i     int;
  _j     int;
  _n     int;
  _stop  text[] := ARRAY['the','a','an','at','of','and','park','court','courts','gym','gymnasium','field','fields',
    'center','centre','school','rec','recreation','community','elementary','middle','high','basketball','soccer',
    'baseball','softball','football','volleyball','tennis','indoor','outdoor','sports','sport','club','church',
    'playground','pool','arena','stadium','complex','hall','academy','st','street','ave','avenue','rd','road','blvd',
    'dr','drive','ln','lane','way','ct','pl','place'];
BEGIN
  IF btrim(_t) = '' THEN RETURN NULL; END IF;

  IF _t ~* '(maps\.google|google\.[a-z.]+/maps|goo\.gl/maps|maps\.app\.goo\.gl|maps\.apple|waze\.com|openstreetmap\.org|bing\.com/maps|w3w\.co|what3words|///[a-z]+\.[a-z]+\.[a-z]+)' THEN
    RETURN 'map_link';
  END IF;
  IF _t ~ '-?\d{1,3}\.\d{3,}\s*[,;/ ]\s*-?\d{1,3}\.\d{3,}' THEN
    RETURN 'coordinates';
  END IF;
  IF _t ~* '\m\d{1,6}\s+(?!(?:am|pm|a\.m|p\.m|on|at|min|mins|minutes|hour|hours|hr|hrs|v|vs|x|players|people|ppl|spots|teams|games|rounds)\M)(?:[a-z][a-z0-9.''-]*\s+){1,3}(?:st|street|ave|avenue|av|rd|road|blvd|boulevard|dr|drive|ln|lane|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|ct|trl|trail)\M'
     OR _t ~* '\m\d{1,3}(?:st|nd|rd|th)\s+(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane)\M' THEN
    RETURN 'street_address';
  END IF;
  IF _t ~* '\m(?:apt|apartment|suite|ste|unit|bldg|building|room|rm)\.?\s*#?\s*\d+' THEN
    RETURN 'unit';
  END IF;

  IF _exact_location IS NOT NULL AND btrim(_exact_location) <> '' THEN
    _norm := ' ' || array_to_string(private_sec.location_tokens(_t), ' ') || ' ';
    _segs := string_to_array(_exact_location, ',');
    FOR _i IN 1 .. COALESCE(array_length(_segs, 1), 0) LOOP
      _seg := _segs[_i];
      CONTINUE WHEN NOT (_i = 1 OR _seg ~ '\d');          -- later parts without digits are a city or state
      _toks := private_sec.location_tokens(_seg);
      _n := COALESCE(array_length(_toks, 1), 0);
      CONTINUE WHEN _n < 2;                                -- one plain word is not a venue we can recognise
      FOR _j IN 1 .. _n - 1 LOOP
        CONTINUE WHEN _toks[_j] = ANY (_stop) AND _toks[_j + 1] = ANY (_stop);
        CONTINUE WHEN length(_toks[_j]) + length(_toks[_j + 1]) < 5;
        IF position(' ' || _toks[_j] || ' ' || _toks[_j + 1] || ' ' IN _norm) > 0 THEN
          RETURN 'venue_name';
        END IF;
      END LOOP;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.location_tokens(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.text_discloses_location(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.location_tokens(text) TO service_role;
GRANT EXECUTE ON FUNCTION private_sec.text_discloses_location(text, text) TO service_role;

-- PRIV-2B: who may know a minor's name (and so see their availability). The wrapped SEC-2 helpers are called in private_sec directly.
CREATE OR REPLACE FUNCTION private_sec.can_see_minor_name(_viewer uuid, _subject uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _viewer IS NOT NULL AND (
       _viewer = _subject
    OR private_sec.is_guardian_of(_viewer, _subject)
    OR public.shares_game_or_chat(_viewer, _subject)
    OR private_sec.shares_team(_viewer, _subject)
    OR private_sec.has_role(_viewer, 'admin') OR private_sec.has_role(_viewer, 'superadmin') OR private_sec.has_role(_viewer, 'moderator')
    -- the host dealing with this person's request, waitlist place or payment
    OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.player_id = _subject AND jr.host_id = _viewer)
    OR EXISTS (SELECT 1 FROM public.game_position_waitlist w JOIN public.hosted_games g ON g.id = w.game_id
                WHERE w.user_id = _subject AND g.host_id = _viewer)
    OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.player_id = _subject AND ps.host_id = _viewer)
    -- a team's staff dealing with an invitation or tryout sign-up
    OR EXISTS (SELECT 1 FROM public.team_invites i WHERE i.invitee_id = _subject
                AND (i.invited_by = _viewer OR private_sec.is_team_manager(i.team_id, _viewer)))
    OR EXISTS (SELECT 1 FROM public.tryout_rsvps r WHERE r.user_id = _subject AND private_sec.is_team_manager(r.team_id, _viewer))
    -- an organization's administrators dealing with a member or a request to join
    OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = _subject AND private_sec.is_trainer_org_admin(m.org_id, _viewer))
    OR EXISTS (SELECT 1 FROM public.org_member_requests q WHERE q.user_id = _subject AND private_sec.is_trainer_org_admin(q.org_id, _viewer))
    OR EXISTS (SELECT 1 FROM public.trainer_org_members m WHERE m.user_id = _subject AND private_sec.is_trainer_org_admin(m.org_id, _viewer))
    -- someone the person has accepted as a follower
    OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = _viewer AND f.followee_id = _subject)
  )
$$;
REVOKE ALL ON FUNCTION private_sec.can_see_minor_name(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.can_see_minor_name(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 2. Reads
-- ---------------------------------------------------------------------------------------------------------------------------------------------

-- May the signed-in viewer see an OPEN, unhidden post by _owner? (The policy handles status, hidden_at, the author and the guardian.)
CREATE OR REPLACE FUNCTION private_sec.availability_post_visible(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
       _owner = auth.uid()
    OR private_sec.has_role(auth.uid(), 'admin') OR private_sec.has_role(auth.uid(), 'superadmin')
    OR private_sec.has_role(auth.uid(), 'moderator')
    OR (
          NOT private_sec.blocks_exist_between(auth.uid(), _owner)
      AND NOT EXISTS (SELECT 1 FROM public.profiles p
                       WHERE p.id = _owner AND (p.suspended_at IS NOT NULL OR p.moderation_state IN ('suspended', 'banned')))
      AND (   COALESCE(public.age_cohort_of(_owner), 'unknown') = 'adult'
           OR private_sec.is_guardian_of(auth.uid(), _owner)
           OR private_sec.can_see_minor_name(auth.uid(), _owner))
    )
  )
$$;
REVOKE ALL ON FUNCTION private_sec.availability_post_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.availability_post_visible(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Open availabilities visible to authenticated users" ON public.player_availabilities;
DROP POLICY IF EXISTS "Availability visible to permitted viewers" ON public.player_availabilities;
CREATE POLICY "Availability visible to permitted viewers" ON public.player_availabilities
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR private_sec.is_guardian_of(auth.uid(), user_id)
    OR (status = 'open' AND hidden_at IS NULL AND private_sec.availability_post_visible(user_id))
  );

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 3. Writes by a non-adult author: a city at most, and a note that cannot name a place
-- ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_minor_availability_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _why text;
BEGIN
  IF COALESCE(public.age_cohort_of(NEW.user_id), 'unknown') = 'adult' THEN RETURN NEW; END IF;
  NEW.lat := NULL; NEW.lng := NULL; NEW.formatted_address := NULL; NEW.place_id := NULL;
  -- only text being written now is checked, so a legacy note never blocks blanking or an unrelated edit
  IF TG_OP = 'UPDATE' AND NEW.note IS NOT DISTINCT FROM OLD.note THEN RETURN NEW; END IF;
  _why := private_sec.text_discloses_location(NEW.note);
  IF _why IS NOT NULL THEN
    RAISE EXCEPTION 'LOCATION_IN_PUBLIC_TEXT: the note on an availability post by someone under 18 cannot contain an address, map link, coordinates or a venue name (found: %). Describe the sport and the days instead.', _why
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_minor_availability_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_minor_availability_write() TO service_role;
DROP TRIGGER IF EXISTS zz_guard_minor_availability_write_trg ON public.player_availabilities;
CREATE TRIGGER zz_guard_minor_availability_write_trg BEFORE INSERT OR UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_minor_availability_write();

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 4. Contact requests and invitations sent from a post
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Fires before every other trigger on the table (name order: 'a1_' sorts first), so nothing below it answers about a pair of people the
-- caller is not part of, or about a post the caller cannot read.
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
REVOKE ALL ON FUNCTION public.guard_contact_request_minor_recipient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_contact_request_minor_recipient() TO service_role;
DROP TRIGGER IF EXISTS a1_guard_contact_request_minor_recipient_trg ON public.availability_contact_requests;
CREATE TRIGGER a1_guard_contact_request_minor_recipient_trg BEFORE INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_request_minor_recipient();

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 5. Status vocabulary: 'inactive' (written by revoke_parental_consent) is valid. Body as in 20260802023306 except the status line.
-- ---------------------------------------------------------------------------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 6. Moderation fields are not the author's to change
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- SECURITY INVOKER on purpose: current_user is 'authenticated' only when a signed-in client writes the row itself. Inside a SECURITY DEFINER
-- function (revoke_parental_consent, moderator_scrub_availability_note) it is the function's owner, and for server code it is service_role.
CREATE OR REPLACE FUNCTION public.guard_availability_moderation_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
  IF current_user <> 'authenticated' THEN RETURN NEW; END IF;
  IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at OR NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'AVAILABILITY_FIELD_FORBIDDEN: this post''s visibility is managed by BallaCity.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_availability_moderation_fields() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_availability_moderation_fields() TO authenticated, service_role;
DROP TRIGGER IF EXISTS a1_guard_availability_moderation_fields_trg ON public.player_availabilities;
CREATE TRIGGER a1_guard_availability_moderation_fields_trg BEFORE UPDATE ON public.player_availabilities
  FOR EACH ROW EXECUTE FUNCTION public.guard_availability_moderation_fields();

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 7. A player may change their own position in a game (the guard looked up a table that does not exist)
-- ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_participant_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  baseline public.game_participants;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> OLD.user_id THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = OLD.game_id AND g.host_id = auth.uid()) THEN
    RETURN NEW;
  END IF;

  baseline := OLD;
  baseline.position := NEW.position;
  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(baseline) THEN
    RAISE EXCEPTION 'PARTICIPANT_FIELD_FORBIDDEN: you may only change your own position.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_participant_self_update() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 8. Legacy-data procedures (R2). Defined here, NOT run by this migration; a run needs the owner's separate approval.
-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Removes stored coordinates, street address and place id from posts by non-adult or unknown-age authors, in batches, keeping the city.
-- Copies nothing anywhere; audited with counts only; idempotent (run until it returns 0).
CREATE OR REPLACE FUNCTION private_sec.blank_minor_availability_location(_limit integer DEFAULT 500)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  IF _limit IS NULL OR _limit < 1 OR _limit > 5000 THEN RAISE EXCEPTION 'limit must be between 1 and 5000'; END IF;
  WITH pick AS (
    SELECT a.id FROM public.player_availabilities a
     WHERE (a.lat IS NOT NULL OR a.lng IS NOT NULL OR a.formatted_address IS NOT NULL OR a.place_id IS NOT NULL)
       AND COALESCE(public.age_cohort_of(a.user_id), 'unknown') <> 'adult'
     ORDER BY a.id LIMIT _limit FOR UPDATE SKIP LOCKED
  )
  UPDATE public.player_availabilities a SET lat = NULL, lng = NULL, formatted_address = NULL, place_id = NULL
    FROM pick WHERE a.id = pick.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n > 0 THEN
    INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    VALUES (NULL, 'minor_availability_location_blanked', 'player_availabilities', 'batch', 'legacy data procedure', jsonb_build_object('rows', _n));
  END IF;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION private_sec.blank_minor_availability_location(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.blank_minor_availability_location(integer) TO service_role;

-- Moderators: posts by non-adults whose note names a place (the detector is a heuristic), without returning the text.
CREATE OR REPLACE FUNCTION public.list_minor_availability_notes_with_location_text()
RETURNS TABLE (post_id uuid, reason text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private_sec.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN QUERY
    SELECT a.id, private_sec.text_discloses_location(a.note)
      FROM public.player_availabilities a
     WHERE a.note IS NOT NULL AND COALESCE(public.age_cohort_of(a.user_id), 'unknown') <> 'adult'
       AND private_sec.text_discloses_location(a.note) IS NOT NULL;
END $$;
REVOKE ALL ON FUNCTION public.list_minor_availability_notes_with_location_text() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_minor_availability_notes_with_location_text() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.moderator_scrub_availability_note(_post uuid, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT private_sec.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  UPDATE public.player_availabilities a SET note = NULL
   WHERE a.id = _post AND COALESCE(public.age_cohort_of(a.user_id), 'unknown') <> 'adult';
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing to scrub'; END IF;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'availability_note_scrubbed', 'player_availabilities', _post::text, _reason);   -- no copy of the removed text is kept
END $$;
REVOKE ALL ON FUNCTION public.moderator_scrub_availability_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_scrub_availability_note(uuid, text) TO authenticated, service_role;
