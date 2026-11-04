-- SEC-1: corrections to the privacy stack found by independent review (2026-11-05). Applied after every other release migration.
--
--  1. private_sec.can_see_minor_name counted two relationships that a stranger can create alone: an invitation that was never accepted (any adult can
--     create a team and invite anyone, and the clause survived cancellation) and an organization membership (any adult can create an organization and
--     insert any user). Both made the stranger "related": names, rosters, ratings, posts, reels and availability opened up (PRIV-2B, G4, R1, R2).
--     Now: only an ACCEPTED invitation counts, and organization membership no longer does (a request the person made themselves still counts).
--     Organization administrators can no longer insert a minor into org_members.
--  2. The one-way coarsening switch could be turned off by renaming its key (the guard only checked NEW.key) or by TRUNCATE. Both are refused.
--  3. After activation, widening a youth game's age range to adult-only copied the exact venue back into the public columns and deleted the private
--     copy. After activation the public columns stay coarse and the private copy is kept.
--  4. coarsen_existing_youth_games left its bypass flag on for the rest of the operator's transaction (the team-post and facility batches reset it).
--  5. A host (or the child) could stamp guardian_approved_at/by on a join request and so unlock payment without any guardian. Only a verified guardian
--     of the player may change them now.
--  6. (F) After activation, an empty value from an older client never replaces the only exact copy of a team facility or team-post location.
--  7. (F) Location-disclosure reports: established reporters only; the automatic step is a reversible hold with moderator-only evidence.
--  8. (D) A minor host's public organizer is neutral or an authorized team or organization display.
-- Review round 4 (2026-11-07) corrected this file before it was applied: D-1..D-4 (organizer display bound to adult authorization and to the game,
-- ownership guard on owner_hidden_at, historical snapshots), F2-1..F2-6 (reporter age from auth.users, holds closed only by a moderator decision,
-- moderator removals never block holds, restore keeps the host's edits, team-post evidence, server-set report times), F1-1..F1-3 (explicit
-- clear for team-post venues, coordinate moves, blank list elements). See docs/privacy/sec1-stack-hardening.md.
-- NOTHING in this file rewrites an existing row when applied. public.neutralize_existing_minor_host_snapshots is a guarded maintenance batch
-- (dry run by default, service role or superadmin) that the migration does NOT run; running it on production needs the owner's separate approval.
-- Production definitions replaced here were fingerprint-compared where they exist in production (see the runbook section 3 list). Forward-only.

-- Dependency guard: fail loudly, before changing anything, if a migration this one needs has not been applied (plpgsql bodies would otherwise fail only at user time).
DO $guard$ BEGIN
  IF to_regprocedure('private_sec.can_see_minor_name(uuid,uuid)') IS NULL OR to_regprocedure('public.sync_hosted_game_private()') IS NULL OR to_regprocedure('public.coarsen_existing_youth_games(integer)') IS NULL OR to_regprocedure('public.guard_youth_location_switch()') IS NULL OR to_regprocedure('public.minor_messaging_block(uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.minor_has_active_youth_game(uuid)') IS NULL OR to_regprocedure('private_sec.tell_host_location_removed(uuid,text)') IS NULL
     OR to_regprocedure('public.moderator_scrub_game_text(text,text)') IS NULL OR to_regprocedure('public.moderator_scrub_team_post_text(uuid,text)') IS NULL
     OR to_regprocedure('public.set_listing_hidden(text,text,boolean)') IS NULL OR to_regclass('public.minor_hosting_approvals') IS NULL
     OR to_regclass('public.team_post_private') IS NULL THEN
    RAISE EXCEPTION 'SEC-1: a required earlier release migration has not been applied (see docs/release/youth-privacy-release-runbook.md, sections 2 and 16)';
  END IF;
END $guard$;


CREATE OR REPLACE FUNCTION private_sec.can_see_minor_name(_viewer uuid, _subject uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _viewer IS NOT NULL AND (
       _viewer = _subject
    OR public.is_guardian_of(_viewer, _subject)
    OR public.shares_game_or_chat(_viewer, _subject)
    OR public.shares_team(_viewer, _subject)
    OR public.has_role(_viewer, 'admin') OR public.has_role(_viewer, 'superadmin') OR public.has_role(_viewer, 'moderator')
    -- the host (or payment manager) dealing with this person's request, waitlist place or payment
    OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.player_id = _subject AND jr.host_id = _viewer)
    OR EXISTS (SELECT 1 FROM public.game_position_waitlist w JOIN public.hosted_games g ON g.id = w.game_id
                WHERE w.user_id = _subject AND g.host_id = _viewer)
    OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.player_id = _subject AND ps.host_id = _viewer)
    -- a team's staff dealing with an ACCEPTED invitation or a tryout sign-up
    OR EXISTS (SELECT 1 FROM public.team_invites i WHERE i.invitee_id = _subject AND i.status = 'accepted'
                AND (i.invited_by = _viewer OR public.is_team_manager(i.team_id, _viewer)))
    OR EXISTS (SELECT 1 FROM public.tryout_rsvps r WHERE r.user_id = _subject AND public.is_team_manager(r.team_id, _viewer))
    -- an organization's administrators dealing with a member or a request to join
    OR EXISTS (SELECT 1 FROM public.org_member_requests q WHERE q.user_id = _subject AND public.is_trainer_org_admin(q.org_id, _viewer))
    OR EXISTS (SELECT 1 FROM public.trainer_org_members m WHERE m.user_id = _subject AND public.is_trainer_org_admin(m.org_id, _viewer))
    -- someone the person has accepted as a follower
    OR EXISTS (SELECT 1 FROM public.follows f WHERE f.follower_id = _viewer AND f.followee_id = _subject)
  )
$function$

;

CREATE OR REPLACE FUNCTION public.sync_hosted_game_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _youth boolean := NOT public.game_age_range_is_adult_only(NEW.min_age, NEW.max_age);
  _was_youth boolean;
  _changed boolean;
  _coarsen boolean := COALESCE(
    (SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false);
  _p public.hosted_game_private%ROWTYPE;
  _looks_coarse boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    _was_youth := NOT public.game_age_range_is_adult_only(OLD.min_age, OLD.max_age);
    _changed := NEW.location IS DISTINCT FROM OLD.location
             OR NEW.lat IS DISTINCT FROM OLD.lat OR NEW.lng IS DISTINCT FROM OLD.lng;
  ELSE
    _was_youth := false;
    _changed := true;
  END IF;

  IF NOT _youth THEN
    -- Adult-only: exact values live in hosted_games. Restore them if the game was youth-inclusive.
    IF TG_OP = 'UPDATE' AND _was_youth AND NOT _changed AND NOT _coarsen THEN
      SELECT * INTO _p FROM public.hosted_game_private WHERE game_id = NEW.id;
      IF FOUND THEN
        NEW.location := _p.location; NEW.lat := _p.lat; NEW.lng := _p.lng;
      END IF;
    END IF;
    -- after activation the private copy is kept and the public columns stay coarse: widening the age range can never publish the exact venue
    IF TG_OP = 'UPDATE' AND NOT _coarsen THEN DELETE FROM public.hosted_game_private WHERE game_id = NEW.id; END IF;
    RETURN NEW;
  END IF;

  -- Youth-inclusive: store the submitted values as the exact location (see the header), unless they
  -- ARE the coarse form (an operator's coarsening update, or a client that sent back what it was
  -- given): a coarse value must never be stored as the exact one.
  _looks_coarse := NEW.location IS NOT DISTINCT FROM private_sec.coarse_game_label(NEW.neighborhood)
                   AND NEW.lat IS NOT DISTINCT FROM round(NEW.lat, 2)
                   AND NEW.lng IS NOT DISTINCT FROM round(NEW.lng, 2);
  IF (_changed OR (TG_OP = 'UPDATE' AND NOT _was_youth))
     AND NOT _looks_coarse
     AND COALESCE(current_setting('app.coarsening_existing', true), '') <> '1' THEN
    INSERT INTO public.hosted_game_private (game_id, location, lat, lng)
    VALUES (NEW.id, NEW.location, NEW.lat, NEW.lng)
    ON CONFLICT (game_id) DO UPDATE
      SET location = EXCLUDED.location, lat = EXCLUDED.lat, lng = EXCLUDED.lng, updated_at = now();
  END IF;

  IF _coarsen AND COALESCE(current_setting('app.coarsening_existing', true), '') <> '1'
     AND (TG_OP = 'INSERT' OR _changed OR NOT _was_youth
                   OR (TG_OP = 'UPDATE' AND NEW.neighborhood IS DISTINCT FROM OLD.neighborhood)) THEN
    NEW.location := private_sec.coarse_game_label(NEW.neighborhood);
    NEW.lat := round(NEW.lat, 2);
    NEW.lng := round(NEW.lng, 2);
  END IF;
  RETURN NEW;
END $function$

;

CREATE OR REPLACE FUNCTION public.coarsen_existing_youth_games(_limit integer DEFAULT 200)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n integer;
BEGIN
  IF NOT COALESCE((SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false) THEN
    RAISE EXCEPTION 'COARSENING_NOT_ACTIVE: activate the guarded youth-location switch first.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.coarsening_existing', '1', true);
  -- 1. make sure every game about to be coarsened has an exact copy (never overwrite an existing one)
  INSERT INTO public.hosted_game_private (game_id, location, lat, lng)
  SELECT g.id, g.location, g.lat, g.lng FROM public.hosted_games g
   WHERE NOT public.game_age_range_is_adult_only(g.min_age, g.max_age)
  ON CONFLICT (game_id) DO NOTHING;
  -- 2. coarsen a batch that is not coarse yet
  WITH batch AS (
    SELECT id FROM public.hosted_games g
     WHERE NOT public.game_age_range_is_adult_only(g.min_age, g.max_age)
       AND (g.location IS DISTINCT FROM private_sec.coarse_game_label(g.neighborhood)
            OR g.lat IS DISTINCT FROM round(g.lat, 2) OR g.lng IS DISTINCT FROM round(g.lng, 2))
     ORDER BY g.id LIMIT _limit FOR UPDATE)
  UPDATE public.hosted_games g
     SET location = private_sec.coarse_game_label(g.neighborhood),
         lat = round(g.lat, 2), lng = round(g.lng, 2)
    FROM batch WHERE g.id = batch.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.coarsening_existing', '', true);   -- never leave the bypass on for the rest of the transaction
  RETURN _n;
END $function$

;


-- 1b. administrators cannot add a minor to an organization without a request from them (approve_org_member_request, a definer, is unaffected)
DROP POLICY IF EXISTS "Admins can insert org members" ON public.org_members;
CREATE POLICY "Admins can insert org members" ON public.org_members FOR INSERT TO authenticated
  WITH CHECK (public.is_trainer_org_admin(org_id, auth.uid()) AND NOT public.is_minor(user_id));

-- 2. the switch cannot be renamed away or truncated
CREATE OR REPLACE FUNCTION public.guard_youth_switch_tamper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'youth_location_privacy' AND COALESCE((value ->> 'coarsen')::boolean, false)) THEN
      RAISE EXCEPTION 'COARSENING_IRREVERSIBLE: app_settings cannot be truncated while the youth-location switch is on.' USING ERRCODE = '42501';
    END IF;
    RETURN NULL;
  END IF;
  IF OLD.key = 'youth_location_privacy' AND NEW.key IS DISTINCT FROM OLD.key
     AND COALESCE((OLD.value ->> 'coarsen')::boolean, false) THEN
    RAISE EXCEPTION 'COARSENING_IRREVERSIBLE: the youth-location switch cannot be renamed.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_youth_switch_tamper() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_youth_switch_tamper() TO service_role;
DROP TRIGGER IF EXISTS guard_youth_switch_tamper_trg ON public.app_settings;
CREATE TRIGGER guard_youth_switch_tamper_trg BEFORE UPDATE OF key ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_youth_switch_tamper();
DROP TRIGGER IF EXISTS guard_youth_switch_truncate_trg ON public.app_settings;
CREATE TRIGGER guard_youth_switch_truncate_trg BEFORE TRUNCATE ON public.app_settings
  FOR EACH STATEMENT EXECUTE FUNCTION public.guard_youth_switch_tamper();

-- 5. guardian approval on a join request can only be written by a verified guardian of the player (guardian_approve_join_request runs as one)
CREATE OR REPLACE FUNCTION public.protect_join_request_guardian_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;   -- service role and definer-owned maintenance
  IF (NEW.guardian_approved_at IS DISTINCT FROM OLD.guardian_approved_at OR NEW.guardian_approved_by IS DISTINCT FROM OLD.guardian_approved_by)
     AND NOT public.is_guardian_of(auth.uid(), OLD.player_id) THEN
    NEW.guardian_approved_at := OLD.guardian_approved_at;
    NEW.guardian_approved_by := OLD.guardian_approved_by;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.protect_join_request_guardian_approval() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_join_request_guardian_approval() TO service_role;
DROP TRIGGER IF EXISTS a0_protect_join_request_guardian_approval_trg ON public.join_requests;
CREATE TRIGGER a0_protect_join_request_guardian_approval_trg BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_join_request_guardian_approval();

-- ------------------------------------------------------------------------------------------- F. legacy clients cannot wipe exact copies
-- An array counts as blank when it holds nothing but empty strings or nulls (an older client may send [''] or [""], review round 4 F1-3).
CREATE OR REPLACE FUNCTION private_sec.text_array_is_blank(_a text[])
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM unnest(COALESCE(_a, '{}'::text[])) v WHERE NULLIF(btrim(v), '') IS NOT NULL)
$$;
CREATE OR REPLACE FUNCTION private_sec.jsonb_array_is_blank(_a jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT _a IS NULL OR jsonb_typeof(_a) = 'null'
      OR (jsonb_typeof(_a) = 'array' AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(_a) e
             WHERE NOT (jsonb_typeof(e) = 'null'
                        OR (jsonb_typeof(e) = 'string' AND btrim(e #>> '{}') = '')
                        OR e IN ('{}'::jsonb, '[]'::jsonb))))
$$;
REVOKE ALL ON FUNCTION private_sec.text_array_is_blank(text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.jsonb_array_is_blank(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.text_array_is_blank(text[]) TO service_role;
GRANT EXECUTE ON FUNCTION private_sec.jsonb_array_is_blank(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.sync_team_facility_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _verifying boolean := COALESCE(current_setting('app.team_facility_verify', true), '') = '1';
  _existing  boolean := COALESCE(current_setting('app.coarsening_existing', true), '') = '1';
  _coarsen   boolean := COALESCE(
    (SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false);
  _youth boolean;
  _c_home boolean; _c_venues boolean; _c_addr boolean; _c_primary boolean; _c_geo boolean;
  _changed boolean;
  _became_private boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT _verifying THEN NEW.facility_public := false; END IF;
  ELSIF NEW.facility_public IS DISTINCT FROM OLD.facility_public AND NOT _verifying THEN
    NEW.facility_public := OLD.facility_public;
  END IF;

  IF NEW.kind IS DISTINCT FROM 'team' THEN RETURN NEW; END IF;       -- trainers, gyms and facilities are public businesses
  _youth := COALESCE(NEW.age_groups, '{}') && ARRAY['youth', 'teen']::text[]
            OR (TG_OP = 'UPDATE' AND private_sec.team_is_youth(NEW.id));
  IF NOT _youth THEN RETURN NEW; END IF;

  _c_home    := TG_OP = 'INSERT' OR NEW.home_court      IS DISTINCT FROM OLD.home_court;
  _c_venues  := TG_OP = 'INSERT' OR NEW.venues          IS DISTINCT FROM OLD.venues;
  _c_addr    := TG_OP = 'INSERT' OR NEW.venue_addresses IS DISTINCT FROM OLD.venue_addresses;
  _c_primary := TG_OP = 'INSERT' OR NEW.primary_venue   IS DISTINCT FROM OLD.primary_venue;
  _c_geo     := TG_OP = 'INSERT' OR NEW.venue_geo       IS DISTINCT FROM OLD.venue_geo;
  -- SEC-1 (F): after activation an empty value from a client (older builds send back '' or [] for what they were shown) never replaces the
  -- only exact copy; deliberate clearing goes through clear_team_facility_details.
  IF _coarsen AND TG_OP = 'UPDATE' THEN
    IF NULLIF(btrim(COALESCE(NEW.home_court, '')), '') IS NULL THEN _c_home := false; END IF;
    IF private_sec.text_array_is_blank(NEW.venues) THEN _c_venues := false; END IF;              -- '{}', '{""}', '{" ", NULL}'
    IF private_sec.jsonb_array_is_blank(NEW.venue_addresses) THEN _c_addr := false; END IF;      -- [], [""], [null]
    IF NULLIF(btrim(COALESCE(NEW.primary_venue, '')), '') IS NULL THEN _c_primary := false; END IF;
    IF private_sec.jsonb_array_is_blank(NEW.venue_geo) THEN _c_geo := false; END IF;
  END IF;
  _changed := _c_home OR _c_venues OR _c_addr OR _c_primary OR _c_geo;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.facility_public AND _changed AND NOT _verifying THEN NEW.facility_public := false; END IF;
    _became_private := OLD.facility_public AND NOT NEW.facility_public;
    IF _became_private THEN
      _c_home := true; _c_venues := true; _c_addr := true; _c_primary := true; _c_geo := true;
    END IF;
  END IF;

  IF NEW.facility_public THEN RETURN NEW; END IF;
  IF NOT (_changed OR _became_private) OR _existing THEN RETURN NEW; END IF;

  INSERT INTO public.team_facility_private AS x (team_id, home_court, venues, venue_addresses, primary_venue, venue_geo)
  VALUES (NEW.id, NEW.home_court, COALESCE(NEW.venues, '{}'), COALESCE(NEW.venue_addresses, '[]'::jsonb),
          NEW.primary_venue, COALESCE(NEW.venue_geo, '[]'::jsonb))
  ON CONFLICT (team_id) DO UPDATE
    SET home_court      = CASE WHEN _c_home    THEN EXCLUDED.home_court      ELSE x.home_court      END,
        venues          = CASE WHEN _c_venues  THEN EXCLUDED.venues          ELSE x.venues          END,
        venue_addresses = CASE WHEN _c_addr    THEN EXCLUDED.venue_addresses ELSE x.venue_addresses END,
        primary_venue   = CASE WHEN _c_primary THEN EXCLUDED.primary_venue   ELSE x.primary_venue   END,
        venue_geo       = CASE WHEN _c_geo     THEN EXCLUDED.venue_geo       ELSE x.venue_geo       END,
        updated_at = now();

  IF _coarsen THEN
    NEW.home_court := NULL;
    NEW.venues := '{}';
    NEW.venue_addresses := '[]'::jsonb;
    NEW.primary_venue := NULL;
    NEW.venue_geo := '[]'::jsonb;
  END IF;
  RETURN NEW;
END $function$

;

CREATE OR REPLACE FUNCTION public.sync_team_post_private()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _verifying boolean := COALESCE(current_setting('app.team_post_venue_verify', true), '') = '1';
  _existing  boolean := COALESCE(current_setting('app.coarsening_existing', true), '') = '1';
  _coarsen   boolean := COALESCE(
    (SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false);
  _changed   boolean;
  _became_private boolean := false;
  _label     text;
  _c_loc boolean; _c_addr boolean; _c_lat boolean; _c_lng boolean; _c_place boolean;
BEGIN
  -- Only the moderator function may make a venue public.
  IF TG_OP = 'INSERT' THEN
    IF NOT _verifying THEN NEW.public_venue := false; END IF;
  ELSIF NEW.public_venue IS DISTINCT FROM OLD.public_venue AND NOT _verifying THEN
    NEW.public_venue := OLD.public_venue;
  END IF;

  IF NOT private_sec.team_is_youth(NEW.team_id) THEN RETURN NEW; END IF;

  -- Which venue columns this write changes. A client that sends back the coarse values it was given changes nothing.
  _c_loc   := TG_OP = 'INSERT' OR NEW.location          IS DISTINCT FROM OLD.location;
  _c_addr  := TG_OP = 'INSERT' OR NEW.formatted_address IS DISTINCT FROM OLD.formatted_address;
  _c_lat   := TG_OP = 'INSERT' OR NEW.lat               IS DISTINCT FROM OLD.lat;
  _c_lng   := TG_OP = 'INSERT' OR NEW.lng               IS DISTINCT FROM OLD.lng;
  _c_place := TG_OP = 'INSERT' OR NEW.place_id          IS DISTINCT FROM OLD.place_id;
  -- SEC-1 (F): after activation an empty value, or the coarse label sent back, never replaces the only exact copy.
  IF _coarsen AND TG_OP = 'UPDATE' THEN
    IF NULLIF(btrim(COALESCE(NEW.location, '')), '') IS NULL OR NEW.location = private_sec.coarse_team_post_label(NEW.team_id) THEN _c_loc := false; END IF;
    IF NULLIF(btrim(COALESCE(NEW.formatted_address, '')), '') IS NULL THEN _c_addr := false; END IF;
    IF NULLIF(btrim(COALESCE(NEW.place_id, '')), '') IS NULL THEN _c_place := false; END IF;
    -- Coordinates (review round 4 F1-2): a value that only repeats the coarse form of the stored one is a round trip, unless the place itself
    -- moved; a genuine move to a point with two or fewer decimals is a change (testing NEW.lat = round(NEW.lat, 2) kept the old exact point).
    IF NEW.lat IS NULL OR (NEW.lat = round(OLD.lat, 2) AND NOT (_c_loc OR _c_addr OR _c_place)) THEN _c_lat := false; END IF;
    IF NEW.lng IS NULL OR (NEW.lng = round(OLD.lng, 2) AND NOT (_c_loc OR _c_addr OR _c_place)) THEN _c_lng := false; END IF;
  END IF;
  _changed := _c_loc OR _c_addr OR _c_lat OR _c_lng OR _c_place;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.public_venue AND _changed AND NOT _verifying THEN NEW.public_venue := false; END IF;   -- moving a verified venue needs a new verification
    _became_private := OLD.public_venue AND NOT NEW.public_venue;
    IF _became_private THEN
      _c_loc := true; _c_addr := true; _c_lat := true; _c_lng := true; _c_place := true;           -- everything is currently public and exact
    END IF;
  END IF;

  IF NEW.public_venue THEN RETURN NEW; END IF;
  IF NOT (_changed OR _became_private) OR _existing THEN RETURN NEW; END IF;
  IF NEW.location IS NULL AND NEW.formatted_address IS NULL AND NEW.lat IS NULL AND NEW.lng IS NULL AND NEW.place_id IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.team_post_private WHERE post_id = NEW.id) THEN
    RETURN NEW;                                                  -- nothing to protect (an announcement)
  END IF;

  -- Keep the exact copy: write only the columns this statement changed, so a partial edit never overwrites a private value with a coarse one.
  INSERT INTO public.team_post_private AS x (post_id, location, formatted_address, lat, lng, place_id)
  VALUES (NEW.id, NEW.location, NEW.formatted_address, NEW.lat, NEW.lng, NEW.place_id)
  ON CONFLICT (post_id) DO UPDATE
    SET location          = CASE WHEN _c_loc   THEN EXCLUDED.location          ELSE x.location          END,
        formatted_address = CASE WHEN _c_addr  THEN EXCLUDED.formatted_address ELSE x.formatted_address END,
        lat               = CASE WHEN _c_lat   THEN EXCLUDED.lat               ELSE x.lat               END,
        lng               = CASE WHEN _c_lng   THEN EXCLUDED.lng               ELSE x.lng               END,
        place_id          = CASE WHEN _c_place THEN EXCLUDED.place_id          ELSE x.place_id          END,
        updated_at = now();

  IF _coarsen THEN
    _label := private_sec.coarse_team_post_label(NEW.team_id);
    NEW.location := CASE WHEN NEW.location IS NULL THEN NULL ELSE _label END;
    NEW.formatted_address := NULL;
    NEW.place_id := NULL;
    NEW.lat := round(NEW.lat, 2);
    NEW.lng := round(NEW.lng, 2);
  END IF;
  RETURN NEW;
END $function$

;

-- Deliberately removing a team post's venue (review round 4 F1-1). After activation an empty value is never taken as a change to the exact copy
-- (above), so removal is explicit, as for team facilities (clear_team_facility_details). The post's author or the team's managers only.
CREATE OR REPLACE FUNCTION public.clear_team_post_venue(_post uuid, _fields text[] DEFAULT ARRAY['location', 'formatted_address', 'lat', 'lng', 'place_id'])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _team text; _author uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to change this post.' USING ERRCODE = '42501'; END IF;
  SELECT p.team_id, p.author_id INTO _team, _author FROM public.team_posts p WHERE p.id = _post;
  IF NOT FOUND OR NOT (_author = auth.uid() OR public.is_team_manager(_team, auth.uid())) THEN
    RAISE EXCEPTION 'Only the post''s author or this team''s owner, managers and coaches can change its venue.' USING ERRCODE = '42501';
  END IF;
  IF _fields IS NULL OR EXISTS (SELECT 1 FROM unnest(_fields) f WHERE f IS NULL OR f NOT IN ('location', 'formatted_address', 'lat', 'lng', 'place_id')) THEN
    RAISE EXCEPTION 'Unknown venue field.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.team_post_private SET
    location          = CASE WHEN 'location'          = ANY (_fields) THEN NULL ELSE location END,
    formatted_address = CASE WHEN 'formatted_address' = ANY (_fields) THEN NULL ELSE formatted_address END,
    lat               = CASE WHEN 'lat'               = ANY (_fields) THEN NULL ELSE lat END,
    lng               = CASE WHEN 'lng'               = ANY (_fields) THEN NULL ELSE lng END,
    place_id          = CASE WHEN 'place_id'          = ANY (_fields) THEN NULL ELSE place_id END,
    updated_at = now()
   WHERE post_id = _post;
  PERFORM set_config('app.coarsening_existing', '1', true);        -- the public columns are cleared too, without re-copying
  UPDATE public.team_posts SET
    location          = CASE WHEN 'location'          = ANY (_fields) THEN NULL ELSE location END,
    formatted_address = CASE WHEN 'formatted_address' = ANY (_fields) THEN NULL ELSE formatted_address END,
    lat               = CASE WHEN 'lat'               = ANY (_fields) THEN NULL ELSE lat END,
    lng               = CASE WHEN 'lng'               = ANY (_fields) THEN NULL ELSE lng END,
    place_id          = CASE WHEN 'place_id'          = ANY (_fields) THEN NULL ELSE place_id END
   WHERE id = _post;
  PERFORM set_config('app.coarsening_existing', '', true);
END $$;
REVOKE ALL ON FUNCTION public.clear_team_post_venue(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_team_post_venue(uuid, text[]) TO authenticated, service_role;

-- ------------------------------------------------------------------------- F. location-disclosure reports: reversible hold, evidence kept
-- Reviewed: two accounts (sockpuppets included) could irreversibly blank any youth-inclusive game's text, with no copy kept. Now:
--   * only established reporters count toward the automatic step: an auth account at least 7 days old (auth.users.created_at, which no client
--     can write; profiles.created_at is client-writable and no longer used, and is frozen below), a confirmed email, and a declared birthday
--     (public.age_verified only means the person entered a birthday; it is NOT an identity or age verification). Still two distinct reporters;
--   * the automatic step is a HOLD: the original text is copied into moderator-only evidence (location_report_evidence, row-level security:
--     moderators and administrators only), the public text is temporarily removed, the reports move to 'investigating' and stay open;
--   * nothing is final until a moderator confirms (moderator_confirm_location_hold, or moderator_scrub_game_text) or restores
--     (moderator_restore_game_text); a report on a held game cannot be closed any other way (guard on user_reports);
--   * every removal, automatic or by a moderator, keeps the original text as evidence; a moderator's own removal is recorded as already decided,
--     so it never blocks a later automatic hold (review round 4 F2-3); team-post removals keep evidence too (F2-5).
CREATE TABLE IF NOT EXISTS public.location_report_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text,                           -- exactly one of game_id / post_id
  post_id uuid,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid,                       -- NULL = the automatic hold; otherwise the moderator who removed the text
  title text, description text, neighborhood text, game_rules text, equipment text[], cancellation_notes text, cancellation_reason text,
  body text,                              -- team posts
  released_at timestamptz,
  released_by uuid,
  decision text CHECK (decision IN ('restored', 'confirmed')),
  CONSTRAINT location_report_evidence_subject_chk CHECK (num_nonnulls(game_id, post_id) = 1),
  CONSTRAINT location_report_evidence_hold_chk CHECK (captured_by IS NULL OR released_at IS NOT NULL)   -- only the automatic step is an open hold
);
CREATE INDEX IF NOT EXISTS location_report_evidence_game_idx ON public.location_report_evidence (game_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS location_report_evidence_post_idx ON public.location_report_evidence (post_id) WHERE post_id IS NOT NULL;
ALTER TABLE public.location_report_evidence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Moderators read location report evidence" ON public.location_report_evidence;
CREATE POLICY "Moderators read location report evidence" ON public.location_report_evidence FOR SELECT TO authenticated
  USING (public.is_moderator(auth.uid()));
REVOKE ALL ON public.location_report_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.location_report_evidence TO authenticated;
GRANT ALL ON public.location_report_evidence TO service_role;

-- Copies the listing text into evidence and removes it from public view. _hold: the automatic step (an open hold, captured_by NULL);
-- otherwise a moderator's removal, recorded as already confirmed by that moderator.
CREATE OR REPLACE FUNCTION private_sec.capture_and_scrub_game_text(_game text, _hold boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  INSERT INTO public.location_report_evidence (game_id, captured_by, title, description, neighborhood, game_rules, equipment, cancellation_notes,
                                               cancellation_reason, released_at, released_by, decision)
  SELECT g.id, CASE WHEN _hold THEN NULL ELSE auth.uid() END, g.title, g.description, g.neighborhood, g.game_rules, g.equipment, g.cancellation_notes,
         g.cancellation_reason, CASE WHEN _hold THEN NULL ELSE now() END, CASE WHEN _hold THEN NULL ELSE auth.uid() END,
         CASE WHEN _hold THEN NULL ELSE 'confirmed' END
    FROM public.hosted_games g WHERE g.id = _game;
  UPDATE public.hosted_games g
     SET title = initcap(g.sport) || ' game', description = '', neighborhood = '', game_rules = NULL,
         equipment = '{}', cancellation_notes = NULL, cancellation_reason = NULL
   WHERE g.id = _game;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END $$;
-- The moderator's removal (kept under its earlier name, used by moderator_scrub_game_text).
CREATE OR REPLACE FUNCTION private_sec.scrub_game_public_text(_game text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private_sec.capture_and_scrub_game_text(_game, false)
$$;
REVOKE ALL ON FUNCTION private_sec.capture_and_scrub_game_text(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.scrub_game_public_text(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.capture_and_scrub_game_text(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION private_sec.scrub_game_public_text(text) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_location_disclosure_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _g record; _reporters integer;
BEGIN
  IF NEW.reason IS DISTINCT FROM 'location_disclosed' OR NEW.game_id IS NULL THEN RETURN NEW; END IF;
  SELECT g.id, g.host_id, g.min_age, g.max_age INTO _g FROM public.hosted_games g WHERE g.id = NEW.game_id;
  IF NOT FOUND OR public.game_age_range_is_adult_only(_g.min_age, _g.max_age) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.location_report_evidence e
              WHERE e.game_id = NEW.game_id AND e.released_at IS NULL AND e.captured_by IS NULL) THEN RETURN NEW; END IF;  -- already held
  -- established reporters: the auth account (not the client-writable profile row) is at least 7 days old and confirmed, and a birthday was declared
  SELECT count(DISTINCT r.reporter_id) INTO _reporters FROM public.user_reports r JOIN auth.users u ON u.id = r.reporter_id
   WHERE r.game_id = NEW.game_id AND r.reason = 'location_disclosed' AND r.created_at > now() - interval '30 days'
     AND r.status IN ('new', 'open', 'pending', 'investigating', 'reviewing')
     AND r.reporter_id IS DISTINCT FROM _g.host_id
     AND u.created_at < now() - interval '7 days' AND u.email_confirmed_at IS NOT NULL
     AND public.age_verified(r.reporter_id);          -- "age_verified" = a self-declared birthday exists; not an identity check
  IF _reporters >= 2 THEN
    PERFORM private_sec.capture_and_scrub_game_text(NEW.game_id, true);   -- an open hold; the original is moderator-only evidence
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_g.host_id, 'moderation_notice', 'Your listing is under review',
            'Some text in your listing was hidden while a moderator checks whether it reveals a private location. It may be restored.', '/games/' || NEW.game_id);
    UPDATE public.user_reports SET status = 'investigating',
           resolution_notes = 'Listing text held automatically after two established reports; a moderator must confirm or restore it.'
     WHERE game_id = NEW.game_id AND reason = 'location_disclosed' AND status IN ('new', 'open', 'pending', 'reviewing');
    INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, metadata)
    VALUES (NULL, 'location_disclosure_auto_hold', 'hosted_game', NEW.game_id, 'two established reports', jsonb_build_object('reporters', _reporters));
  END IF;
  RETURN NEW;
END $$;

-- A moderator restores held text (the guard on youth-game text still applies, so text that names an address cannot come back). Only fields
-- that still hold what the hold put there are restored: anything the host wrote during the hold is kept (review round 4 F2-4).
CREATE OR REPLACE FUNCTION public.moderator_restore_game_text(_game text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _e record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _e FROM public.location_report_evidence
   WHERE game_id = _game AND released_at IS NULL AND captured_by IS NULL ORDER BY captured_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing is held for this game.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.hosted_games g SET
         title               = CASE WHEN g.title IS NOT DISTINCT FROM initcap(g.sport) || ' game' THEN _e.title ELSE g.title END,
         description         = CASE WHEN COALESCE(g.description, '') = '' THEN _e.description ELSE g.description END,
         neighborhood        = CASE WHEN COALESCE(g.neighborhood, '') = '' THEN _e.neighborhood ELSE g.neighborhood END,
         game_rules          = COALESCE(g.game_rules, _e.game_rules),
         equipment           = CASE WHEN COALESCE(cardinality(g.equipment), 0) = 0 THEN _e.equipment ELSE g.equipment END,
         cancellation_notes  = COALESCE(g.cancellation_notes, _e.cancellation_notes),
         cancellation_reason = COALESCE(g.cancellation_reason, _e.cancellation_reason)
   WHERE g.id = _game;
  UPDATE public.location_report_evidence SET released_at = now(), released_by = auth.uid(), decision = 'restored'
   WHERE game_id = _game AND released_at IS NULL;
  UPDATE public.user_reports SET status = 'dismissed', reviewed_by = auth.uid(), reviewed_at = now(), resolution_notes = COALESCE(left(_reason, 500), 'Restored by a moderator')
   WHERE game_id = _game AND reason = 'location_disclosed' AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing');
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'location_disclosure_restore', 'hosted_game', _game, left(_reason, 500));
END $$;
REVOKE ALL ON FUNCTION public.moderator_restore_game_text(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_restore_game_text(text, text) TO authenticated, service_role;

-- A moderator's confirmation closes the hold; the evidence stays (moderator-only) for the record.
CREATE OR REPLACE FUNCTION public.moderator_confirm_location_hold(_game text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501'; END IF;
  UPDATE public.location_report_evidence SET released_at = now(), released_by = auth.uid(), decision = 'confirmed'
   WHERE game_id = _game AND released_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing is held for this game.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.user_reports SET status = 'actioned', reviewed_by = auth.uid(), reviewed_at = now(), resolution_notes = COALESCE(left(_reason, 500), 'Removal confirmed by a moderator')
   WHERE game_id = _game AND reason = 'location_disclosed' AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing');
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'location_disclosure_confirm', 'hosted_game', _game, left(_reason, 500));
END $$;
REVOKE ALL ON FUNCTION public.moderator_confirm_location_hold(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.moderator_confirm_location_hold(text, text) TO authenticated, service_role;

-- A moderator's own removal. If an automatic hold is open it is confirmed by this moderator first, then the current text is removed and kept as
-- already-decided evidence, so the moderator's step never leaves an open hold behind (F2-3). Same signature and grants as before (20261105130000).
CREATE OR REPLACE FUNCTION public.moderator_scrub_game_text(_game text, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _host uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  SELECT host_id INTO _host FROM public.hosted_games WHERE id = _game;
  IF NOT FOUND THEN RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.location_report_evidence SET released_at = now(), released_by = auth.uid(), decision = 'confirmed'
   WHERE game_id = _game AND released_at IS NULL;
  PERFORM private_sec.capture_and_scrub_game_text(_game, false);
  PERFORM private_sec.tell_host_location_removed(_host, '/games/' || _game);
  UPDATE public.user_reports SET status = 'actioned', reviewed_by = auth.uid(), reviewed_at = now(),
         resolution_notes = COALESCE(left(_reason, 500), 'Listing text removed by a moderator')
   WHERE game_id = _game AND reason = 'location_disclosed' AND status IN ('new', 'open', 'pending', 'investigating', 'reviewing');
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'location_disclosure_scrub', 'hosted_game', _game, left(_reason, 500));
END $$;

-- A team post's removed text is kept as moderator-only evidence too (F2-5). Same signature and grants as before (20261105130000).
CREATE OR REPLACE FUNCTION public.moderator_scrub_team_post_text(_post uuid, _reason text DEFAULT NULL::text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _author uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  SELECT author_id INTO _author FROM public.team_posts WHERE id = _post;
  IF NOT FOUND THEN RAISE EXCEPTION 'Post not found.' USING ERRCODE = 'P0002'; END IF;
  INSERT INTO public.location_report_evidence (post_id, captured_by, title, body, released_at, released_by, decision)
  SELECT p.id, auth.uid(), p.title, p.body, now(), auth.uid(), 'confirmed' FROM public.team_posts p WHERE p.id = _post;
  UPDATE public.team_posts SET title = 'Team update', body = '' WHERE id = _post;
  PERFORM private_sec.tell_host_location_removed(_author, NULL);
  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason)
  VALUES (auth.uid(), 'location_disclosure_scrub', 'team_post', _post::text, left(_reason, 500));
END $$;

-- A location report on a game whose text is held cannot be closed except by the moderator decision that releases the hold (restore or confirm),
-- whoever closes it (the moderation screen writes reports with the service role). Report timestamps are server-set (F2-6).
CREATE OR REPLACE FUNCTION public.guard_location_hold_report_closure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  NEW.created_at := OLD.created_at;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND OLD.reason = 'location_disclosed' AND OLD.game_id IS NOT NULL
     AND NEW.status IN ('resolved', 'dismissed', 'actioned', 'closed')
     AND EXISTS (SELECT 1 FROM public.location_report_evidence e WHERE e.game_id = OLD.game_id AND e.released_at IS NULL) THEN
    RAISE EXCEPTION 'LOCATION_HOLD_OPEN: this listing''s text is held. Restore the text or confirm the removal; that closes the reports.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_location_hold_report_closure() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_location_hold_report_closure() TO service_role;
DROP TRIGGER IF EXISTS a1_guard_location_hold_closure_trg ON public.user_reports;
CREATE TRIGGER a1_guard_location_hold_closure_trg BEFORE UPDATE ON public.user_reports
  FOR EACH ROW EXECUTE FUNCTION public.guard_location_hold_report_closure();

-- A report's filing time is the server's (it decides the 30-day window of the automatic step). Same body as 20261023140000 plus created_at.
CREATE OR REPLACE FUNCTION public.user_reports_start_as_new()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.created_at := now();
  IF auth.uid() IS NOT NULL AND NOT public.is_moderator(auth.uid()) THEN
    NEW.status := 'new';
    NEW.reviewed_by := NULL;
    NEW.reviewed_at := NULL;
    NEW.resolution_notes := NULL;
  END IF;
  RETURN NEW;
END
$function$;

-- profiles.created_at is not the client's to change (it was writable through the own-profile update policy). Inserts come from sign-up.
CREATE OR REPLACE FUNCTION public.guard_profile_created_at()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN NEW.created_at := OLD.created_at; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_profile_created_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_profile_created_at() TO service_role;
DROP TRIGGER IF EXISTS guard_profile_created_at_trg ON public.profiles;
CREATE TRIGGER guard_profile_created_at_trg BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_created_at();

-- ------------------------------------------------------------------- D. a minor host's public organizer display must be authorized
-- A game may show a team or organization as its organizer instead of a person. For a host who is not a confirmed adult that display must be one an
-- adult authorized, and must never be something the minor owns (teams.owner_id and trainer_orgs.owner_id are readable by signed-in accounts, so an
-- owned team or organization would tie the game to the personal account). Review round 4 (D-1, D-2, D-4):
--   * team: a team the host does NOT own, owned by a confirmed adult, on which the host holds a staff role (manager or coach in team_members; only
--     the owner or a manager can set roles, team_set_member_role). "Manages the team" alone was not enough: a minor could create a team, hide it,
--     point the game at it, and show it again.
--   * organization: only through an organization approval bound to THIS game (hosted_games.hosting_approval_id, unused or used by this game), not
--     expired when the display is set, issued by a confirmed adult who administers the organization and is not the host, for an organization the
--     host does not own. Administering an organization is not enough (anyone may create one).
CREATE OR REPLACE FUNCTION private_sec.minor_team_display_ok(_host uuid, _team text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teams t
      JOIN public.team_members m ON m.team_id = t.id AND m.user_id = _host AND m.role IN ('manager', 'coach')
     WHERE t.id = _team AND t.owner_id IS NOT NULL AND t.owner_id <> _host
       AND public.age_cohort_of(t.owner_id) = 'adult')
$$;
CREATE OR REPLACE FUNCTION private_sec.minor_org_display_ok(_game text, _host uuid, _org uuid, _approval uuid, _check_expiry boolean)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.minor_hosting_approvals a
     WHERE a.id = _approval AND a.kind = 'organization' AND a.org_id = _org AND a.minor_id = _host
       AND a.approver_id <> _host
       AND a.status IN ('active', 'used') AND (a.game_id IS NULL OR a.game_id = _game)
       AND (NOT _check_expiry OR a.expires_at > now())
       AND public.age_cohort_of(a.approver_id) = 'adult' AND public.is_trainer_org_admin(_org, a.approver_id))
  AND NOT EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.id = _org AND o.owner_id = _host)
$$;
-- The public snapshot for a host who is not a confirmed adult: the authorized organizer's name, otherwise "Youth host"; never the person.
CREATE OR REPLACE FUNCTION private_sec.minor_host_public_snapshot(_game text, _host uuid, _team text, _org uuid, _approval uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT jsonb_build_object(
    'name', COALESCE(
      CASE WHEN _team IS NOT NULL AND private_sec.minor_team_display_ok(_host, _team)
           THEN (SELECT t.name FROM public.teams t WHERE t.id = _team) END,
      CASE WHEN _org IS NOT NULL AND private_sec.minor_org_display_ok(_game, _host, _org, _approval, false)
           THEN (SELECT o.name FROM public.trainer_orgs o WHERE o.id = _org) END,
      'Youth host'),
    'neutral', true)
$$;
REVOKE ALL ON FUNCTION private_sec.minor_team_display_ok(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.minor_org_display_ok(text, uuid, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private_sec.minor_host_public_snapshot(text, uuid, text, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.minor_team_display_ok(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION private_sec.minor_org_display_ok(text, uuid, uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION private_sec.minor_host_public_snapshot(text, uuid, text, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.check_minor_host_organizer_display()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF COALESCE(public.age_cohort_of(NEW.host_id), 'unknown') = 'adult' THEN RETURN NEW; END IF;
  IF NEW.team_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.team_id IS DISTINCT FROM OLD.team_id OR NEW.host_id IS DISTINCT FROM OLD.host_id)
     AND NOT private_sec.minor_team_display_ok(NEW.host_id, NEW.team_id) THEN
    RAISE EXCEPTION 'ORGANIZER_DISPLAY_NOT_ALLOWED: a host under 18 can show a team as the organizer only when an adult owns it and made them a manager or coach; never a team they own.' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.host_id IS DISTINCT FROM OLD.host_id
          OR NEW.hosting_approval_id IS DISTINCT FROM OLD.hosting_approval_id)
     AND NOT private_sec.minor_org_display_ok(NEW.id, NEW.host_id, NEW.org_id, NEW.hosting_approval_id, true) THEN
    RAISE EXCEPTION 'ORGANIZER_DISPLAY_NOT_ALLOWED: a host under 18 can show an organization as the organizer only with that organization''s current approval for this game.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_minor_host_organizer_display() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_minor_host_organizer_display() TO service_role;
DROP TRIGGER IF EXISTS yy_minor_host_organizer_display_trg ON public.hosted_games;
CREATE TRIGGER yy_minor_host_organizer_display_trg BEFORE INSERT OR UPDATE OF host_id, team_id, org_id, hosting_approval_id ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.check_minor_host_organizer_display();

-- The snapshot uses the same authorization, so a display that is no longer (or was never) authorized never puts a name on the game.
CREATE OR REPLACE FUNCTION public.neutralize_minor_host_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult' THEN
    NEW.host_snapshot := private_sec.minor_host_public_snapshot(NEW.id, NEW.host_id, NEW.team_id, NEW.org_id, NEW.hosting_approval_id);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS yy_neutral_host_snapshot_trg ON public.hosted_games;
CREATE TRIGGER yy_neutral_host_snapshot_trg BEFORE INSERT OR UPDATE OF host_id, host_snapshot, team_id, org_id, hosting_approval_id
  ON public.hosted_games FOR EACH ROW EXECUTE FUNCTION public.neutralize_minor_host_snapshot();

-- Ownership guard (R1, 20261106110000), corrected (D-1): it fired on UPDATE OF owner_id, hidden_at, but an owner un-hides through
-- set_listing_hidden, which writes owner_hidden_at; hidden_at is derived later by zz_sync_listing_hidden. The guard now runs on every insert and
-- update AFTER that derivation (trigger name sorts after it) and compares OLD and NEW: it refuses a row that becomes visible or changes owner while
-- the owner is a minor host. It covers organizations too (D-2), and a minor who owns a visible organization cannot host a youth-inclusive game.
CREATE OR REPLACE FUNCTION public.refuse_minor_host_team_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_TABLE_NAME IN ('teams', 'trainer_orgs') THEN
    IF NEW.hidden_at IS NOT NULL OR NEW.owner_id IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.owner_id IS NOT DISTINCT FROM OLD.owner_id AND OLD.hidden_at IS NULL THEN RETURN NEW; END IF;  -- already visible, same owner
    IF public.age_cohort_of(NEW.owner_id) IS DISTINCT FROM 'adult' AND private_sec.minor_has_active_youth_game(NEW.owner_id) THEN
      IF TG_TABLE_NAME = 'teams' THEN
        RAISE EXCEPTION 'MINOR_HOST_TEAM_OWNER: while you host a game that includes young people, a team owned by you would link your organizer account to the team. Ask an adult to own the team, or finish or cancel the game first.'
          USING ERRCODE = '42501';
      END IF;
      RAISE EXCEPTION 'MINOR_HOST_ORG_OWNER: while you host a game that includes young people, an organization owned by you would link your organizer account to it. Ask an adult to own the organization.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF NEW.cancelled_at IS NOT NULL OR NEW.completed_at IS NOT NULL THEN RETURN NEW; END IF;
    IF public.game_age_range_is_adult_only(NEW.min_age, NEW.max_age) THEN RETURN NEW; END IF;
    IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult'
       AND EXISTS (SELECT 1 FROM public.teams t WHERE t.owner_id = NEW.host_id AND t.hidden_at IS NULL) THEN
      RAISE EXCEPTION 'MINOR_HOST_TEAM_OWNER: a host under 18 cannot own a team while hosting a game that includes young people, because the team would link the organizer account to its name. Ask an adult to own the team, or hide it, then publish again.'
        USING ERRCODE = '42501';
    END IF;
    IF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult'
       AND EXISTS (SELECT 1 FROM public.trainer_orgs o WHERE o.owner_id = NEW.host_id AND o.hidden_at IS NULL) THEN
      RAISE EXCEPTION 'MINOR_HOST_ORG_OWNER: a host under 18 cannot own an organization while hosting a game that includes young people, because it would link the organizer account to its name. Ask an adult to own it, or hide it, then publish again.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS yy_minor_host_team_owner_trg ON public.teams;
DROP TRIGGER IF EXISTS zzz_minor_host_team_owner_trg ON public.teams;
CREATE TRIGGER zzz_minor_host_team_owner_trg BEFORE INSERT OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.refuse_minor_host_team_owner();
DROP TRIGGER IF EXISTS zzz_minor_host_org_owner_trg ON public.trainer_orgs;
CREATE TRIGGER zzz_minor_host_org_owner_trg BEFORE INSERT OR UPDATE ON public.trainer_orgs
  FOR EACH ROW EXECUTE FUNCTION public.refuse_minor_host_team_owner();

-- D-3. Neutralizing a host's snapshots, row by row (one row that a later guard refuses must not stop the rest; it is counted and named).
-- _detach: also remove a team or organization display that is not authorized (above) from the game; the game itself is untouched.
CREATE OR REPLACE FUNCTION private_sec.neutralize_minor_host_games(_host uuid, _limit integer, _detach boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _g record; _team text; _org uuid; _done integer := 0; _failed integer := 0; _failed_ids text[] := '{}';
BEGIN
  FOR _g IN
    SELECT g.id, g.host_id, g.team_id, g.org_id, g.hosting_approval_id, g.host_snapshot,
           (g.team_id IS NOT NULL AND NOT private_sec.minor_team_display_ok(g.host_id, g.team_id)) AS bad_team,
           (g.org_id IS NOT NULL AND NOT private_sec.minor_org_display_ok(g.id, g.host_id, g.org_id, g.hosting_approval_id, false)) AS bad_org
      FROM public.hosted_games g
     WHERE (_host IS NULL OR g.host_id = _host)
       AND COALESCE(public.age_cohort_of(g.host_id), 'unknown') <> 'adult'
       AND (g.host_snapshot IS DISTINCT FROM private_sec.minor_host_public_snapshot(g.id, g.host_id, g.team_id, g.org_id, g.hosting_approval_id)
            OR (_detach AND g.team_id IS NOT NULL AND NOT private_sec.minor_team_display_ok(g.host_id, g.team_id))
            OR (_detach AND g.org_id IS NOT NULL AND NOT private_sec.minor_org_display_ok(g.id, g.host_id, g.org_id, g.hosting_approval_id, false)))
     ORDER BY g.id
     LIMIT _limit
  LOOP
    BEGIN
      _team := CASE WHEN _detach AND _g.bad_team THEN NULL ELSE _g.team_id END;
      _org  := CASE WHEN _detach AND _g.bad_org  THEN NULL ELSE _g.org_id END;
      UPDATE public.hosted_games g
         SET team_id = _team, org_id = _org,
             org_official = CASE WHEN _org IS NULL THEN false ELSE g.org_official END,
             host_snapshot = private_sec.minor_host_public_snapshot(g.id, g.host_id, _team, _org, g.hosting_approval_id)
       WHERE g.id = _g.id;
      _done := _done + 1;
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;
      IF cardinality(_failed_ids) < 50 THEN _failed_ids := _failed_ids || _g.id; END IF;
    END;
  END LOOP;
  RETURN jsonb_build_object('updated', _done, 'failed', _failed, 'failed_ids', to_jsonb(_failed_ids));
END $$;
REVOKE ALL ON FUNCTION private_sec.neutralize_minor_host_games(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.neutralize_minor_host_games(uuid, integer, boolean) TO service_role;

-- D-3. GUARDED HISTORICAL BATCH. NOT executed by this migration (nothing here rewrites an existing row when the file is applied). Running it on
-- production needs the owner's separate approval (docs/privacy/sec1-stack-hardening.md, "Review round 4"). Service role, or a superadmin.
-- Neutralizes host_snapshot of every game whose host is not currently a confirmed adult (including past and cancelled games), and with
-- _detach_unauthorized_display also removes a team or organization display that is not authorized under the rules above.
-- _dry_run (the default) only counts. Batched: call repeatedly until 'remaining' is 0.
CREATE OR REPLACE FUNCTION public.neutralize_existing_minor_host_snapshots(_limit integer DEFAULT 200, _dry_run boolean DEFAULT true,
                                                                         _detach_unauthorized_display boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _r jsonb; _counts jsonb;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'superadmin') THEN
    RAISE EXCEPTION 'SUPERADMIN_ONLY: this maintenance batch is for the service role or a superadmin.' USING ERRCODE = '42501';
  END IF;
  IF _limit IS NULL OR _limit < 1 OR _limit > 5000 THEN RAISE EXCEPTION 'INVALID_LIMIT' USING ERRCODE = '22023'; END IF;
  IF NOT COALESCE(_dry_run, true) THEN
    _r := private_sec.neutralize_minor_host_games(NULL, _limit, COALESCE(_detach_unauthorized_display, false));
  END IF;
  SELECT jsonb_build_object(
           'snapshots_pending', count(*) FILTER (WHERE g.host_snapshot IS DISTINCT FROM
                                  private_sec.minor_host_public_snapshot(g.id, g.host_id, g.team_id, g.org_id, g.hosting_approval_id)),
           'team_displays_pending', count(*) FILTER (WHERE g.team_id IS NOT NULL AND NOT private_sec.minor_team_display_ok(g.host_id, g.team_id)),
           'org_displays_pending', count(*) FILTER (WHERE g.org_id IS NOT NULL
                                  AND NOT private_sec.minor_org_display_ok(g.id, g.host_id, g.org_id, g.hosting_approval_id, false)))
    INTO _counts
    FROM public.hosted_games g
   WHERE COALESCE(public.age_cohort_of(g.host_id), 'unknown') <> 'adult';
  RETURN jsonb_build_object('dry_run', COALESCE(_dry_run, true)) || _counts || COALESCE(_r, '{}'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.neutralize_existing_minor_host_snapshots(integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.neutralize_existing_minor_host_snapshots(integer, boolean, boolean) TO service_role;

-- D-3, going forward: when a person stops being a confirmed adult (a corrected birthday, an age review), every game they host gets the neutral
-- snapshot at once (past games included). Only a future cohort change runs this; applying the migration rewrites nothing. Same body as
-- 20260903022412 plus the second block. Organizer displays are not detached here (that is a moderator or batch decision, see the doc).
CREATE OR REPLACE FUNCTION public.reclamp_privacy_on_cohort_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.age_cohort IS DISTINCT FROM OLD.age_cohort THEN
    -- The UPDATE re-runs enforce_minor_privacy_floor, which applies the floor.
    UPDATE public.privacy_preferences
       SET updated_at = now()
     WHERE user_id = NEW.id;
    IF COALESCE(NEW.age_cohort, 'unknown') <> 'adult' THEN
      PERFORM private_sec.neutralize_minor_host_games(NEW.id, 100000, false);
    END IF;
  END IF;
  RETURN NEW;
END $function$;

-- SEC-2 interplay: re-wrap the helper functions if the containment migration is present (R7 above redefined two of them by name).
DO $rewrap$ BEGIN
  IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF;
END $rewrap$;
