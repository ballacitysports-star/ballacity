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
