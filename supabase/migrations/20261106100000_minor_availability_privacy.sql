-- R2: a player-availability post by someone who is not a confirmed adult is readable only by people with a real reason to see it.
--
-- WHY. The only SELECT policy on player_availabilities lets every signed-in account read every open post. A post carries the author's
-- account id, sports, skill, weekly days and time slots (a schedule), a travel radius, city, approximate coordinates (two decimals,
-- or exact when the author chose that) and a free-text note. For a child or teen that is a schedule plus a place, handed to strangers,
-- and the account id also correlates the post with that person's games, rosters and requests.
--
-- WHAT THIS DOES.
--   1. Reads. A post is visible when its author is a confirmed adult (nothing changes for adults), or to the author, a verified guardian
--      of the author, and anyone who may know a minor's name (private_sec.can_see_minor_name: people who share a game, chat or team,
--      hosts/coaches/organization administrators dealing with them, accepted followers, administrators and moderators). The same
--      rule already hides a minor's name; availability now follows it. Closed posts stay visible only to the author and guardians.
--      An unknown or unverified age counts as not adult (fail closed). Realtime evaluates the same policy per subscriber.
--   2. Writes. For an author who is not a confirmed adult the database stores no coordinates, street address or place id, whatever
--      the privacy setting says (city only), and refuses a note that gives an address, map link or coordinates
--      (LOCATION_IN_PUBLIC_TEXT). A guardian-visible post can therefore never become a precise location.
--   3. Contact requests. A contact request or game invitation addressed to someone who is not a confirmed adult is refused unless the
--      sender may know that person (same rule as 1), and the existing minor-messaging rules (guardian controls, adult to under-16
--      shared-context rule) now also apply to requests; previously they applied only to conversations and messages.
--
-- EXISTING DATA. Nothing is rewritten. Existing posts by minors become unreadable to unrelated accounts as soon as the policy is in
-- place, whatever coordinates they hold. A later, separately approved step may blank old coordinates; the verification query in
-- docs/privacy/r2-minor-availability.md counts them.
-- Compatibility. The listing query is unchanged (it selects rows the caller may read). A newer app on the old database and an older app
-- on the new one both work; the older app simply sees fewer posts. Recovery: fix forward; the policy can be relaxed only by a new
-- migration approved by the owner. Depends on 20261104120000 (can_see_minor_name) and 20261104130000 (detector).

-- Dependency guard: fail loudly, before changing anything, if a migration this one needs has not been applied (plpgsql bodies would otherwise fail only at user time).
DO $guard$ BEGIN
  IF to_regprocedure('private_sec.can_see_minor_name(uuid,uuid)') IS NULL OR to_regprocedure('private_sec.text_discloses_location(text,text)') IS NULL OR to_regprocedure('public.minor_messaging_block(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'R2: a required earlier release migration has not been applied (see docs/release/youth-privacy-release-runbook.md, sections 2 and 16)';
  END IF;
END $guard$;


CREATE OR REPLACE FUNCTION private_sec.availability_post_visible(_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
       _owner = auth.uid()
    OR COALESCE(public.age_cohort_of(_owner), 'unknown') = 'adult'
    OR public.is_guardian_of(auth.uid(), _owner)
    OR private_sec.can_see_minor_name(auth.uid(), _owner)
  )
$$;
REVOKE ALL ON FUNCTION private_sec.availability_post_visible(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.availability_post_visible(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Open availabilities visible to authenticated users" ON public.player_availabilities;
CREATE POLICY "Availability visible to permitted viewers" ON public.player_availabilities
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_guardian_of(auth.uid(), user_id)
    OR (status = 'open' AND private_sec.availability_post_visible(user_id))
  );

-- Writes: a non-adult author's post holds a city at most, and a note that cannot name a place.
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

-- Contact requests and invitations to a non-adult: only from someone who may know them, and the messaging rules apply.
CREATE OR REPLACE FUNCTION public.guard_contact_request_minor_recipient()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _block text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- service-role maintenance
  _block := public.minor_messaging_block(NEW.from_user_id, NEW.to_user_id);
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(public.age_cohort_of(NEW.to_user_id), 'unknown') <> 'adult'
     AND NOT (public.is_guardian_of(NEW.from_user_id, NEW.to_user_id)
              OR private_sec.can_see_minor_name(NEW.from_user_id, NEW.to_user_id)) THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:not_connected:other'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_contact_request_minor_recipient() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_contact_request_minor_recipient() TO service_role;
DROP TRIGGER IF EXISTS a1_guard_contact_request_minor_recipient_trg ON public.availability_contact_requests;
CREATE TRIGGER a1_guard_contact_request_minor_recipient_trg BEFORE INSERT ON public.availability_contact_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_contact_request_minor_recipient();

-- ---------------------------------------------------------------------------------------------------------------------------
-- LEGACY DATA PROCEDURE (defined here, NOT run by this migration). Posts by non-adults written before this migration may still hold stored
-- coordinates, a street address or a place id, and notes that name a place. They are already unreadable to unrelated accounts; these
-- tools remove the residue when the owner approves a run (see docs/release/legacy-data-procedures.md). Blanking deletes the precise value
-- and keeps the city; nothing is copied anywhere and nothing is ever written back to a public field.
-- ---------------------------------------------------------------------------------------------------------------------------
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
  RETURN _n;   -- run repeatedly until it returns 0
END $$;
REVOKE ALL ON FUNCTION private_sec.blank_minor_availability_location(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.blank_minor_availability_location(integer) TO service_role;

-- Moderators: posts by non-adults whose note names a place (the detector is a heuristic), without returning the text.
CREATE OR REPLACE FUNCTION public.list_minor_availability_notes_with_location_text()
RETURNS TABLE (post_id uuid, reason text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege'; END IF;
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
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only' USING ERRCODE = 'insufficient_privilege'; END IF;
  UPDATE public.player_availabilities a SET note = NULL
   WHERE a.id = _post AND COALESCE(public.age_cohort_of(a.user_id), 'unknown') <> 'adult';
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing to scrub'; END IF;
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'availability_note_scrubbed', 'player_availabilities', _post::text, _reason);   -- no copy of the removed text is kept
END $$;
REVOKE ALL ON FUNCTION public.moderator_scrub_availability_note(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_scrub_availability_note(uuid, text) TO authenticated, service_role;
