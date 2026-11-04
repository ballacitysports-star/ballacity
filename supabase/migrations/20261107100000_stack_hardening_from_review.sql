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
-- Production definitions replaced here were fingerprint-compared where they exist in production (see the runbook section 3 list). Forward-only.

-- Dependency guard: fail loudly, before changing anything, if a migration this one needs has not been applied (plpgsql bodies would otherwise fail only at user time).
DO $guard$ BEGIN
  IF to_regprocedure('private_sec.can_see_minor_name(uuid,uuid)') IS NULL OR to_regprocedure('public.sync_hosted_game_private()') IS NULL OR to_regprocedure('public.coarsen_existing_youth_games(integer)') IS NULL OR to_regprocedure('public.guard_youth_location_switch()') IS NULL OR to_regprocedure('public.minor_messaging_block(uuid,uuid)') IS NULL THEN
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
    IF cardinality(COALESCE(NEW.venues, '{}')) = 0 THEN _c_venues := false; END IF;
    IF COALESCE(NEW.venue_addresses, '[]'::jsonb) = '[]'::jsonb THEN _c_addr := false; END IF;
    IF NULLIF(btrim(COALESCE(NEW.primary_venue, '')), '') IS NULL THEN _c_primary := false; END IF;
    IF COALESCE(NEW.venue_geo, '[]'::jsonb) = '[]'::jsonb THEN _c_geo := false; END IF;
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
    IF NEW.lat IS NULL OR NEW.lat = round(NEW.lat, 2) THEN _c_lat := false; END IF;
    IF NEW.lng IS NULL OR NEW.lng = round(NEW.lng, 2) THEN _c_lng := false; END IF;
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

-- ------------------------------------------------------------------------- F. location-disclosure reports: reversible hold, evidence kept
-- Reviewed: two accounts (sockpuppets included) could irreversibly blank any youth-inclusive game's text, with no copy kept. Now:
--   * only established reporters count toward the automatic step (age verified, account at least 7 days old), still two distinct ones;
--   * the automatic step is a HOLD: the original text is copied into moderator-only evidence, the public text is temporarily removed, the reports
--     move to 'investigating' and stay open for a moderator; nothing is final until a moderator confirms (moderator_scrub_game_text) or
--     restores it (moderator_restore_game_text);
--   * every removal, automatic or by a moderator, keeps the original text as evidence that only moderators and administrators can read.
CREATE TABLE IF NOT EXISTS public.location_report_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid,                       -- NULL = the automatic hold
  title text, description text, neighborhood text, game_rules text, equipment text[], cancellation_notes text, cancellation_reason text,
  released_at timestamptz,
  released_by uuid,
  decision text CHECK (decision IN ('restored', 'confirmed'))
);
CREATE INDEX IF NOT EXISTS location_report_evidence_game_idx ON public.location_report_evidence (game_id) WHERE released_at IS NULL;
ALTER TABLE public.location_report_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Moderators read location report evidence" ON public.location_report_evidence FOR SELECT TO authenticated
  USING (public.is_moderator(auth.uid()));
REVOKE ALL ON public.location_report_evidence FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.location_report_evidence TO authenticated;
GRANT ALL ON public.location_report_evidence TO service_role;

CREATE OR REPLACE FUNCTION private_sec.scrub_game_public_text(_game text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _n integer;
BEGIN
  INSERT INTO public.location_report_evidence (game_id, captured_by, title, description, neighborhood, game_rules, equipment, cancellation_notes, cancellation_reason)
  SELECT g.id, auth.uid(), g.title, g.description, g.neighborhood, g.game_rules, g.equipment, g.cancellation_notes, g.cancellation_reason
    FROM public.hosted_games g WHERE g.id = _game;
  UPDATE public.hosted_games g
     SET title = initcap(g.sport) || ' game', description = '', neighborhood = '', game_rules = NULL,
         equipment = '{}', cancellation_notes = NULL, cancellation_reason = NULL
   WHERE g.id = _game;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n > 0;
END $$;

CREATE OR REPLACE FUNCTION public.handle_location_disclosure_report()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _g record; _reporters integer;
BEGIN
  IF NEW.reason IS DISTINCT FROM 'location_disclosed' OR NEW.game_id IS NULL THEN RETURN NEW; END IF;
  SELECT g.id, g.host_id, g.min_age, g.max_age INTO _g FROM public.hosted_games g WHERE g.id = NEW.game_id;
  IF NOT FOUND OR public.game_age_range_is_adult_only(_g.min_age, _g.max_age) THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM public.location_report_evidence e WHERE e.game_id = NEW.game_id AND e.released_at IS NULL) THEN RETURN NEW; END IF;  -- already held
  SELECT count(DISTINCT r.reporter_id) INTO _reporters FROM public.user_reports r JOIN public.profiles p ON p.id = r.reporter_id
   WHERE r.game_id = NEW.game_id AND r.reason = 'location_disclosed' AND r.created_at > now() - interval '30 days'
     AND r.status IN ('new', 'open', 'pending', 'investigating', 'reviewing')
     AND p.created_at < now() - interval '7 days' AND public.age_verified(r.reporter_id);
  IF _reporters >= 2 THEN
    PERFORM private_sec.scrub_game_public_text(NEW.game_id);       -- keeps the original as moderator-only evidence
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

-- A moderator restores held text (the guard on youth-game text still applies, so text that names an address cannot come back).
CREATE OR REPLACE FUNCTION public.moderator_restore_game_text(_game text, _reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _e record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO _e FROM public.location_report_evidence WHERE game_id = _game AND released_at IS NULL ORDER BY captured_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'Nothing is held for this game.' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.hosted_games SET title = _e.title, description = _e.description, neighborhood = _e.neighborhood, game_rules = _e.game_rules,
         equipment = _e.equipment, cancellation_notes = _e.cancellation_notes, cancellation_reason = _e.cancellation_reason
   WHERE id = _game;
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

-- SEC-2 interplay: re-wrap the helper functions if the containment migration is present (R7 above redefined two of them by name).
DO $rewrap$ BEGIN
  IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF;
END $rewrap$;

-- ------------------------------------------------------------------- D. a minor host's public organizer display must be authorized
-- A game may show a team or organization as its organizer instead of a person. For a host who is not a confirmed adult that display must be one
-- they are entitled to (a team they manage, an organization they administer); otherwise a minor could be linked to, or impersonate, any team.
CREATE OR REPLACE FUNCTION public.check_minor_host_organizer_display()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF COALESCE(public.age_cohort_of(NEW.host_id), 'unknown') = 'adult' THEN RETURN NEW; END IF;
  IF NEW.team_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.team_id IS DISTINCT FROM OLD.team_id)
     AND NOT public.is_team_manager(NEW.team_id::text, NEW.host_id) THEN
    RAISE EXCEPTION 'ORGANIZER_DISPLAY_NOT_ALLOWED: a host under 18 can show only a team they manage as the organizer.' USING ERRCODE = '42501';
  END IF;
  IF NEW.org_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.org_id IS DISTINCT FROM OLD.org_id)
     AND NOT public.is_trainer_org_admin(NEW.org_id::uuid, NEW.host_id) THEN
    RAISE EXCEPTION 'ORGANIZER_DISPLAY_NOT_ALLOWED: a host under 18 can show only an organization they administer as the organizer.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.check_minor_host_organizer_display() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_minor_host_organizer_display() TO service_role;
DROP TRIGGER IF EXISTS yy_minor_host_organizer_display_trg ON public.hosted_games;
CREATE TRIGGER yy_minor_host_organizer_display_trg BEFORE INSERT OR UPDATE OF host_id, team_id, org_id ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.check_minor_host_organizer_display();
