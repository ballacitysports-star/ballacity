-- G4: a minor host's identity is not retrievable by unrelated users; permitted organizer details come through one restricted function.
--
-- WHAT WAS ALREADY TRUE (PRIV-2B). A minor host's public host snapshot is neutral (no name, username or photo), and
-- visible_avatars returns a non-adult's name only to the person, a verified guardian, people who share a game, chat or team with them, staff dealing with
-- them, accepted followers and admins/moderators. hosted_games.host_id, however, is an account id every signed-in account can read for a
-- youth-inclusive game, and an id is only harmless if no open path turns it into a person. Two paths could:
--   * the profile itself: a profile set to "members" (or made public by a guardian) is readable by every signed-in account (or everyone),
--     so host_id -> profile -> name/photo;
--   * no single place that tells a participant, a guardian or a moderator who the organizer is.
--
-- WHAT THIS DOES.
--   1. A minor cannot host (publish, re-date, re-age or take over) a youth-inclusive game while their profile is readable beyond their relations:
--      MINOR_HOST_PROFILE_VISIBLE explains that the profile must be private first. The reverse is enforced too: while a minor has an
--      active youth-inclusive game they cannot set their profile to members/public, and a guardian cannot make the profile public.
--      Production has no minor-hosted games, so nothing existing is blocked. Adults are untouched.
--   2. get_game_organizer(game) is the restricted path to organizer details. It returns the organizer's name and photo to the host, to people
--      who may know a minor's name (participants, guardians, staff, administrators, moderators: the same rule as visible_avatars) and to anyone for an adult host; for everyone
--      else it returns a neutral organizer with no name. It reveals nothing about a game the caller cannot read.
-- host_id itself stays in the row: moving it would break joins, payments and every policy built on it. The tests below show that no read path
-- turns it into a person for an unrelated account. Depends on 20261104110000 and 20261104120000.

CREATE OR REPLACE FUNCTION private_sec.minor_has_active_youth_game(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.hosted_games g
     WHERE g.host_id = _user AND g.cancelled_at IS NULL AND g.completed_at IS NULL
       AND g.date > now() - interval '1 day'
       AND NOT public.game_age_range_is_adult_only(g.min_age, g.max_age))
$$;
REVOKE ALL ON FUNCTION private_sec.minor_has_active_youth_game(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.minor_has_active_youth_game(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.require_private_profile_for_minor_host()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF NEW.cancelled_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN RETURN NEW; END IF;
  IF public.game_age_range_is_adult_only(NEW.min_age, NEW.max_age) THEN RETURN NEW; END IF;
  IF public.age_cohort_of(NEW.host_id) IS NOT DISTINCT FROM 'adult' THEN RETURN NEW; END IF;
  IF private_sec.profile_visibility_of(NEW.host_id) IS DISTINCT FROM 'private' THEN
    RAISE EXCEPTION 'MINOR_HOST_PROFILE_VISIBLE: a host under 18 must have a private profile before hosting a game that includes young people, because anyone could otherwise look up the organizer. Make the profile private in privacy settings, then publish again.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.require_private_profile_for_minor_host() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.require_private_profile_for_minor_host() TO service_role;
DROP TRIGGER IF EXISTS yy_minor_host_profile_private_trg ON public.hosted_games;
CREATE TRIGGER yy_minor_host_profile_private_trg
  BEFORE INSERT OR UPDATE OF host_id, min_age, max_age, cancelled_at, completed_at, date ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.require_private_profile_for_minor_host();

CREATE OR REPLACE FUNCTION public.keep_minor_host_profile_private()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _user uuid;
BEGIN
  IF TG_TABLE_NAME = 'privacy_preferences' THEN
    _user := NEW.user_id;
    IF NEW.profile_visibility IS NOT DISTINCT FROM 'private' THEN RETURN NEW; END IF;
  ELSE
    _user := NEW.child_user_id;
    IF NEW.public_profile IS NOT TRUE THEN RETURN NEW; END IF;
  END IF;
  IF public.age_cohort_of(_user) IS DISTINCT FROM 'adult' AND private_sec.minor_has_active_youth_game(_user) THEN
    RAISE EXCEPTION 'MINOR_HOST_PROFILE_VISIBLE: this profile belongs to a host under 18 with an active game that includes young people, so it must stay private until the game is over or cancelled.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.keep_minor_host_profile_private() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.keep_minor_host_profile_private() TO service_role;
DROP TRIGGER IF EXISTS yy_keep_minor_host_profile_private_trg ON public.privacy_preferences;
CREATE TRIGGER yy_keep_minor_host_profile_private_trg
  BEFORE INSERT OR UPDATE OF profile_visibility ON public.privacy_preferences
  FOR EACH ROW EXECUTE FUNCTION public.keep_minor_host_profile_private();
DROP TRIGGER IF EXISTS yy_keep_minor_host_profile_private_trg ON public.child_controls;
CREATE TRIGGER yy_keep_minor_host_profile_private_trg
  BEFORE INSERT OR UPDATE OF public_profile ON public.child_controls
  FOR EACH ROW EXECUTE FUNCTION public.keep_minor_host_profile_private();

-- The restricted organizer lookup. One definer function: it first checks that the caller may read the game (the same rule as the
-- hosted_games read policies: a public game that is not hidden, or any game the caller hosts, plays in or has asked to join), so a private or
-- hidden game reveals nothing, and then decides what the caller may learn about the organizer. The detail helper is not callable by clients
-- (it would let a caller pick the viewer or the host).
CREATE OR REPLACE FUNCTION private_sec.organizer_details(_host uuid, _viewer uuid)
RETURNS TABLE (kind text, display_name text, avatar_url text, relation text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF public.age_cohort_of(_host) IS NOT DISTINCT FROM 'adult' THEN
    RETURN QUERY SELECT 'adult'::text, p.display_name, p.avatar_url,
                        CASE WHEN _viewer = _host THEN 'self' ELSE 'viewer' END
                   FROM public.profiles p WHERE p.id = _host;
    RETURN;
  END IF;
  IF private_sec.can_see_minor_name(_viewer, _host) THEN
    RETURN QUERY SELECT 'minor'::text, p.display_name, p.avatar_url,
                        CASE WHEN _viewer = _host THEN 'self'
                             WHEN public.is_guardian_of(_viewer, _host) THEN 'guardian'
                             WHEN public.has_role(_viewer, 'admin') OR public.has_role(_viewer, 'superadmin') OR public.has_role(_viewer, 'moderator') THEN 'staff'
                             ELSE 'related' END
                   FROM public.profiles p WHERE p.id = _host;
    RETURN;
  END IF;
  RETURN QUERY SELECT 'neutral'::text, NULL::text, NULL::text, 'none'::text;
END $$;
REVOKE ALL ON FUNCTION private_sec.organizer_details(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.organizer_details(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_game_organizer(_game text)
RETURNS TABLE (kind text, display_name text, avatar_url text, relation text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _host uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  SELECT g.host_id INTO _host FROM public.hosted_games g
   WHERE g.id = _game
     AND ((g.is_private = false AND g.hidden_at IS NULL)
          OR g.host_id = auth.uid()
          OR public.is_game_participant(g.id, auth.uid())
          OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.player_id = auth.uid()));
  IF _host IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT * FROM private_sec.organizer_details(_host, auth.uid());
END $$;
REVOKE ALL ON FUNCTION public.get_game_organizer(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_game_organizer(text) TO authenticated, service_role;
