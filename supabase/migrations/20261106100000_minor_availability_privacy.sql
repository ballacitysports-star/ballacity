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
