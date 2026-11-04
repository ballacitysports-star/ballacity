-- G1: the location of a youth team's private event is not public.
--
-- WHY. team_posts is readable by everyone, anonymous visitors included (policy team_posts_public_read), and carries
-- location, formatted_address, lat, lng and place_id. For a youth team those are the practice, tryout and event venues of
-- children. Same shape of fix as PRIV-2A for games: the exact venue moves to a table with its own access rule; the public
-- columns hold a coarse form (the team's city, coordinates to 2 decimals).
--
-- WHICH POSTS. A post of a team that is "youth": age_groups contains youth or teen, any member is not a confirmed adult, or the
-- team cannot be found (fail closed). Posts with no location (announcements, recaps) are untouched and keep their
-- text. Posts of adult teams are untouched.
--
-- EXPLICIT PUBLIC-VENUE POLICY. A deliberately public venue (a school open day, a public park tryout) is shown only when a
-- moderator has verified it: the author may ask (public_venue_requested), only verify_team_post_public_venue() can set
-- public_venue (a trigger reverts any other write, including a manager's), the verification is recorded, and changing the
-- location of a verified post removes the verification. Revoking it re-coarsens the post.
--
-- WHO MAY READ THE EXACT VENUE (team_post_private): the author, the team's managers and members, verified guardians of members,
-- a person registered for the tryout and the person who registered them (a cancelled registration releases nothing), and
-- moderators. Nobody else; not anonymous, not a signed-in stranger of any age. Not in realtime.
--
-- ROLLOUT. Coarsening shares the one guarded, one-way switch of PRIV-2A (app_settings youth_location_privacy). With the switch
-- OFF this migration changes no visible behaviour: it adds the private copy, the guards and the moderator tools. Activation now
-- also requires every affected team post to have a private copy; coarsen_existing_youth_team_posts() then coarsens existing rows
-- in batches. There is no function that puts exact values back into public columns except the moderator's explicit
-- public-venue verification above.
--
-- Depends on 20261104100000 (switch and guard), 20261104130000 (text detector).

ALTER TABLE public.team_posts
  ADD COLUMN IF NOT EXISTS public_venue boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_venue_requested boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.team_post_private (
  post_id           uuid PRIMARY KEY REFERENCES public.team_posts(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  location          text,
  formatted_address text,
  lat               numeric,
  lng               numeric,
  place_id          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_post_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_post_private FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_post_private TO authenticated;      -- rows still filtered by the policy
GRANT ALL ON public.team_post_private TO service_role;
-- Deliberately NOT added to the supabase_realtime publication.

CREATE TABLE IF NOT EXISTS public.team_post_public_venues (
  post_id     uuid PRIMARY KEY REFERENCES public.team_posts(id) ON DELETE CASCADE,
  verified_by uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  note        text
);
ALTER TABLE public.team_post_public_venues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_post_public_venues FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_post_public_venues TO service_role;    -- the record of who verified; moderators use the functions below

-- Is this a youth team? Fails closed for a team that cannot be found.
CREATE OR REPLACE FUNCTION private_sec.team_is_youth(_team text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE((SELECT t.age_groups && ARRAY['youth', 'teen']::text[] FROM public.teams t WHERE t.id = _team), true)
      OR EXISTS (SELECT 1 FROM public.team_members m
                  WHERE m.team_id = _team AND public.age_cohort_of(m.user_id) IS DISTINCT FROM 'adult')
$$;
REVOKE ALL ON FUNCTION private_sec.team_is_youth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.team_is_youth(text) TO service_role;

-- The coarse public form of a team post's location: the team's city, never text the author typed.
CREATE OR REPLACE FUNCTION private_sec.coarse_team_post_label(_team text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(NULLIF(btrim((SELECT t.city FROM public.teams t WHERE t.id = _team)), ''), 'Location shared with the team')
$$;
REVOKE ALL ON FUNCTION private_sec.coarse_team_post_label(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.coarse_team_post_label(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.can_see_exact_team_post_location(_post uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.team_posts p
     WHERE p.id = _post
       AND (
         p.author_id = auth.uid()
         OR public.is_team_manager(p.team_id, auth.uid())
         OR public.is_team_member(p.team_id, auth.uid())
         OR public.is_moderator(auth.uid())
         OR EXISTS (SELECT 1 FROM public.team_members m
                      JOIN public.guardian_links gl ON gl.child_user_id = m.user_id AND gl.parent_user_id = auth.uid()
                       AND gl.status = 'active' AND gl.verified_at IS NOT NULL
                     WHERE m.team_id = p.team_id)
         OR EXISTS (SELECT 1 FROM public.tryout_rsvps r
                     WHERE r.post_id = p.id AND r.status = 'registered'
                       AND (r.user_id = auth.uid() OR r.registered_by = auth.uid()
                            OR EXISTS (SELECT 1 FROM public.guardian_links gl
                                        WHERE gl.child_user_id = r.user_id AND gl.parent_user_id = auth.uid()
                                          AND gl.status = 'active' AND gl.verified_at IS NOT NULL)))
       )
  );
$$;
REVOKE ALL ON FUNCTION private_sec.can_see_exact_team_post_location(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_see_exact_team_post_location(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "team_post_private_read" ON public.team_post_private;
CREATE POLICY "team_post_private_read" ON public.team_post_private
  FOR SELECT TO authenticated USING (private_sec.can_see_exact_team_post_location(post_id));

-- Keeps the private copy in step with team_posts, guards public_venue, and coarsens when the switch is on. Runs before the row is written.
CREATE OR REPLACE FUNCTION public.sync_team_post_private()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.sync_team_post_private() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_team_post_private() TO service_role;
DROP TRIGGER IF EXISTS a1_sync_team_post_private_trg ON public.team_posts;
CREATE TRIGGER a1_sync_team_post_private_trg BEFORE INSERT OR UPDATE ON public.team_posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_post_private();

-- Text of a private youth post: no address, map link, coordinates, unit or the venue name (same detector as games).
CREATE OR REPLACE FUNCTION public.guard_team_post_text()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _field text;
  _val   text;
  _old   jsonb;
  _new   jsonb := to_jsonb(NEW);
  _all   boolean;
  _exact text[];
  _loc   text;
  _reason text;
BEGIN
  IF NEW.public_venue OR NOT private_sec.team_is_youth(NEW.team_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN _old := to_jsonb(OLD); END IF;
  _all := TG_OP = 'INSERT' OR NEW.location IS DISTINCT FROM OLD.location;
  _exact := ARRAY[NEW.location, NEW.formatted_address];
  IF TG_OP = 'UPDATE' THEN
    _exact := _exact || ARRAY(SELECT p.location FROM public.team_post_private p WHERE p.post_id = NEW.id);
  END IF;
  FOREACH _field IN ARRAY ARRAY['title', 'body'] LOOP
    _val := _new ->> _field;
    CONTINUE WHEN _val IS NULL OR btrim(_val) = '';
    CONTINUE WHEN NOT _all AND _val IS NOT DISTINCT FROM (_old ->> _field);
    _reason := private_sec.text_discloses_location(_val, NULL);
    IF _reason IS NULL THEN
      FOREACH _loc IN ARRAY _exact LOOP
        _reason := private_sec.text_discloses_location(_val, _loc);
        EXIT WHEN _reason IS NOT NULL;
      END LOOP;
    END IF;
    IF _reason IS NOT NULL THEN
      RAISE EXCEPTION 'LOCATION_IN_PUBLIC_TEXT: the % of a post by a youth team cannot contain an address, map link, coordinates or the venue name (found: %). Put the venue in the location field; it is shared with the team and registered families.',
        _field, _reason USING ERRCODE = '22023';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_team_post_text() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_team_post_text() TO service_role;
DROP TRIGGER IF EXISTS a0_guard_team_post_text_trg ON public.team_posts;
CREATE TRIGGER a0_guard_team_post_text_trg BEFORE INSERT OR UPDATE ON public.team_posts
  FOR EACH ROW EXECUTE FUNCTION public.guard_team_post_text();

-- Moderator tools for the explicit public-venue policy.
CREATE OR REPLACE FUNCTION public.verify_team_post_public_venue(_post uuid, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.team_post_private%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.team_posts WHERE id = _post) THEN
    RAISE EXCEPTION 'Post not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO _p FROM public.team_post_private WHERE post_id = _post;
  PERFORM set_config('app.team_post_venue_verify', '1', true);
  UPDATE public.team_posts
     SET public_venue = true,
         location = COALESCE(_p.location, location),
         formatted_address = COALESCE(_p.formatted_address, formatted_address),
         lat = COALESCE(_p.lat, lat), lng = COALESCE(_p.lng, lng), place_id = COALESCE(_p.place_id, place_id)
   WHERE id = _post;
  PERFORM set_config('app.team_post_venue_verify', '', true);
  INSERT INTO public.team_post_public_venues (post_id, verified_by, note) VALUES (_post, auth.uid(), left(_note, 500))
  ON CONFLICT (post_id) DO UPDATE SET verified_by = auth.uid(), verified_at = now(), note = left(_note, 500);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_team_post_public_venue(_post uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.team_post_venue_verify', '1', true);
  UPDATE public.team_posts SET public_venue = false WHERE id = _post;
  PERFORM set_config('app.team_post_venue_verify', '', true);
  DELETE FROM public.team_post_public_venues WHERE post_id = _post;
END $$;

CREATE OR REPLACE FUNCTION public.list_team_post_venue_requests()
RETURNS TABLE (post_id uuid, team_id text, kind text, requested_since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT p.id, p.team_id, p.kind, p.updated_at FROM public.team_posts p
   WHERE p.public_venue_requested AND NOT p.public_venue AND private_sec.team_is_youth(p.team_id)
   ORDER BY p.updated_at;
END $$;
REVOKE ALL ON FUNCTION public.verify_team_post_public_venue(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_team_post_public_venue(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_team_post_venue_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_team_post_public_venue(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_team_post_public_venue(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_team_post_venue_requests() TO authenticated, service_role;

-- Existing rows: an exact copy for every affected post. A copy only; team_posts is untouched.
INSERT INTO public.team_post_private (post_id, location, formatted_address, lat, lng, place_id)
SELECT p.id, p.location, p.formatted_address, p.lat, p.lng, p.place_id
  FROM public.team_posts p
 WHERE private_sec.team_is_youth(p.team_id) AND NOT p.public_venue
   AND (p.location IS NOT NULL OR p.formatted_address IS NOT NULL OR p.lat IS NOT NULL OR p.lng IS NOT NULL OR p.place_id IS NOT NULL)
ON CONFLICT (post_id) DO NOTHING;

-- The shared activation guard now also requires a private copy for every affected team post.
CREATE OR REPLACE FUNCTION public.guard_youth_location_switch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _old boolean := false;
  _new boolean := false;
  _missing integer;
  _missing_posts integer;
BEGIN
  IF (CASE WHEN TG_OP = 'DELETE' THEN OLD.key ELSE NEW.key END) IS DISTINCT FROM 'youth_location_privacy' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;     -- every other setting is untouched
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF COALESCE((OLD.value ->> 'coarsen')::boolean, false) THEN
      RAISE EXCEPTION 'COARSENING_IRREVERSIBLE: the youth-location switch cannot be removed once it is on.' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN _old := COALESCE((OLD.value ->> 'coarsen')::boolean, false); END IF;
  _new := COALESCE((NEW.value ->> 'coarsen')::boolean, false);

  IF _old AND NOT _new THEN
    RAISE EXCEPTION 'COARSENING_IRREVERSIBLE: coarsening cannot be turned off; exact locations are never put back into public columns.' USING ERRCODE = '42501';
  END IF;
  IF _old AND _new THEN
    NEW.value := OLD.value;                 -- nothing else about an active switch can be edited either
    RETURN NEW;
  END IF;
  IF _new THEN
    IF COALESCE(NEW.value ->> 'app_adoption_confirmed', '') <> '2c-verified' THEN
      RAISE EXCEPTION 'COARSENING_NOT_READY: the application that reads exact locations has not been confirmed (app_adoption_confirmed).' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(current_setting('app.confirm_activate_youth_coarsening', true), '') <> 'yes' THEN
      RAISE EXCEPTION 'COARSENING_NOT_CONFIRMED: set app.confirm_activate_youth_coarsening=yes for the session to activate on purpose.' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO _missing FROM public.hosted_games g
     WHERE NOT public.game_age_range_is_adult_only(g.min_age, g.max_age)
       AND NOT EXISTS (SELECT 1 FROM public.hosted_game_private p WHERE p.game_id = g.id);
    IF _missing > 0 THEN
      RAISE EXCEPTION 'COARSENING_NOT_READY: % youth-inclusive game(s) have no exact private copy.', _missing USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO _missing_posts FROM public.team_posts p
     WHERE private_sec.team_is_youth(p.team_id) AND NOT p.public_venue
       AND (p.location IS NOT NULL OR p.formatted_address IS NOT NULL OR p.lat IS NOT NULL OR p.lng IS NOT NULL OR p.place_id IS NOT NULL)
       AND NOT EXISTS (SELECT 1 FROM public.team_post_private x WHERE x.post_id = p.id);
    IF _missing_posts > 0 THEN
      RAISE EXCEPTION 'COARSENING_NOT_READY: % youth-team post(s) have no exact private copy.', _missing_posts USING ERRCODE = '42501';
    END IF;
    NEW.value := NEW.value || jsonb_build_object('activated_at', now());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_youth_location_switch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_youth_location_switch() TO service_role;

-- Batch coarsening of existing posts. Refuses until the shared switch is active. Service role only. Idempotent.
CREATE OR REPLACE FUNCTION public.coarsen_existing_youth_team_posts(_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n integer;
BEGIN
  IF NOT COALESCE((SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false) THEN
    RAISE EXCEPTION 'COARSENING_NOT_ACTIVE: activate the guarded youth-location switch first.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.coarsening_existing', '1', true);
  INSERT INTO public.team_post_private (post_id, location, formatted_address, lat, lng, place_id)
  SELECT p.id, p.location, p.formatted_address, p.lat, p.lng, p.place_id FROM public.team_posts p
   WHERE private_sec.team_is_youth(p.team_id) AND NOT p.public_venue
     AND (p.location IS NOT NULL OR p.formatted_address IS NOT NULL OR p.lat IS NOT NULL OR p.lng IS NOT NULL OR p.place_id IS NOT NULL)
  ON CONFLICT (post_id) DO NOTHING;
  WITH batch AS (
    SELECT p.id FROM public.team_posts p
     WHERE private_sec.team_is_youth(p.team_id) AND NOT p.public_venue
       AND (p.location IS NOT NULL OR p.formatted_address IS NOT NULL OR p.lat IS NOT NULL OR p.lng IS NOT NULL OR p.place_id IS NOT NULL)
       AND (p.location IS DISTINCT FROM private_sec.coarse_team_post_label(p.team_id)
            OR p.formatted_address IS NOT NULL OR p.place_id IS NOT NULL
            OR p.lat IS DISTINCT FROM round(p.lat, 2) OR p.lng IS DISTINCT FROM round(p.lng, 2))
     ORDER BY p.id LIMIT _limit FOR UPDATE)
  UPDATE public.team_posts p
     SET location = private_sec.coarse_team_post_label(p.team_id), formatted_address = NULL, place_id = NULL,
         lat = round(p.lat, 2), lng = round(p.lng, 2)
    FROM batch WHERE p.id = batch.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.coarsening_existing', '', true);      -- never leaks into later statements of the same transaction
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.coarsen_existing_youth_team_posts(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coarsen_existing_youth_team_posts(integer) TO service_role;
