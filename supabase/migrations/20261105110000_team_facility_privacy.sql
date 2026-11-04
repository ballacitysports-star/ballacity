-- G2: a youth team's practice and facility details are not readable by every signed-in account.
--
-- WHY. teams.home_court, venues, venue_addresses, primary_venue and venue_geo are readable by every authenticated user
-- for any non-hidden team. For a youth team these are where its children practise. They are not visible to anonymous visitors,
-- but being signed in grants nothing about a child's team.
--
-- WHICH TEAMS. Only teams of kind 'team' that are youth (age_groups contains youth or teen, or any member is not a confirmed
-- adult). Listings of kind 'coach' (trainers, gyms, facilities) are businesses and their venues are intentionally public: they are
-- not touched. A youth team that plays at an intentionally public venue can be marked public by a moderator after verification
-- (verify_team_facility_public); only that function can set facility_public, a trigger reverts any other write, and
-- changing a verified facility clears it.
--
-- HOW. The exact values move to team_facility_private (RLS: managers, members, verified guardians of members, moderators); the
-- public columns become empty ('' / [] ) once the shared guarded one-way switch (app_settings youth_location_privacy) is ON. The city stays
-- public. The private copy is updated per changed column, so a partial edit cannot replace a private value with an empty one.
-- Activation additionally requires a private copy for every affected team (a second guard on the switch) and
-- coarsen_existing_youth_team_facilities(n) empties existing rows in batches. With the switch OFF this migration changes no visible
-- behaviour. Depends on 20261104100000 (switch, guard).

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS facility_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS facility_public_requested boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.team_facility_private (
  team_id         text PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  home_court      text,
  venues          text[] NOT NULL DEFAULT '{}',
  venue_addresses jsonb  NOT NULL DEFAULT '[]'::jsonb,
  primary_venue   text,
  venue_geo       jsonb  NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.team_facility_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_facility_private FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.team_facility_private TO authenticated;
GRANT ALL ON public.team_facility_private TO service_role;
-- Deliberately NOT added to the supabase_realtime publication.

CREATE TABLE IF NOT EXISTS public.team_public_facilities (
  team_id     text PRIMARY KEY REFERENCES public.teams(id) ON DELETE CASCADE,
  verified_by uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  note        text
);
ALTER TABLE public.team_public_facilities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.team_public_facilities FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.team_public_facilities TO service_role;

-- Same definition as the team-post migration (G1); whichever is applied first creates it.
CREATE OR REPLACE FUNCTION private_sec.team_is_youth(_team text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE((SELECT t.age_groups && ARRAY['youth', 'teen']::text[] FROM public.teams t WHERE t.id = _team), true)
      OR EXISTS (SELECT 1 FROM public.team_members m
                  WHERE m.team_id = _team AND public.age_cohort_of(m.user_id) IS DISTINCT FROM 'adult')
$$;
REVOKE ALL ON FUNCTION private_sec.team_is_youth(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.team_is_youth(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.can_see_team_facility(_team text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_team_manager(_team, auth.uid())
    OR public.is_team_member(_team, auth.uid())
    OR public.is_moderator(auth.uid())
    OR EXISTS (SELECT 1 FROM public.team_members m
                 JOIN public.guardian_links gl ON gl.child_user_id = m.user_id AND gl.parent_user_id = auth.uid()
                  AND gl.status = 'active' AND gl.verified_at IS NOT NULL
                WHERE m.team_id = _team)
  )
$$;
REVOKE ALL ON FUNCTION private_sec.can_see_team_facility(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_see_team_facility(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "team_facility_private_read" ON public.team_facility_private;
CREATE POLICY "team_facility_private_read" ON public.team_facility_private
  FOR SELECT TO authenticated USING (private_sec.can_see_team_facility(team_id));

CREATE OR REPLACE FUNCTION public.sync_team_facility_private()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
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
END $$;
REVOKE ALL ON FUNCTION public.sync_team_facility_private() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_team_facility_private() TO service_role;
DROP TRIGGER IF EXISTS a1_sync_team_facility_private_trg ON public.teams;
CREATE TRIGGER a1_sync_team_facility_private_trg BEFORE INSERT OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.sync_team_facility_private();

-- Moderator tools for the explicit public-facility policy.
CREATE OR REPLACE FUNCTION public.verify_team_facility_public(_team text, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _p public.team_facility_private%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.teams WHERE id = _team AND kind = 'team') THEN
    RAISE EXCEPTION 'Team not found.' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO _p FROM public.team_facility_private WHERE team_id = _team;
  PERFORM set_config('app.team_facility_verify', '1', true);
  IF FOUND THEN
    UPDATE public.teams SET facility_public = true, home_court = _p.home_court, venues = _p.venues,
           venue_addresses = _p.venue_addresses, primary_venue = _p.primary_venue, venue_geo = _p.venue_geo
     WHERE id = _team;
  ELSE
    UPDATE public.teams SET facility_public = true WHERE id = _team;
  END IF;
  PERFORM set_config('app.team_facility_verify', '', true);
  INSERT INTO public.team_public_facilities (team_id, verified_by, note) VALUES (_team, auth.uid(), left(_note, 500))
  ON CONFLICT (team_id) DO UPDATE SET verified_by = auth.uid(), verified_at = now(), note = left(_note, 500);
END $$;

CREATE OR REPLACE FUNCTION public.revoke_team_facility_public(_team text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.team_facility_verify', '1', true);
  UPDATE public.teams SET facility_public = false WHERE id = _team;
  PERFORM set_config('app.team_facility_verify', '', true);
  DELETE FROM public.team_public_facilities WHERE team_id = _team;
END $$;

CREATE OR REPLACE FUNCTION public.list_team_facility_requests()
RETURNS TABLE (team_id text, requested_since timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT t.id, t.updated_at FROM public.teams t
   WHERE t.facility_public_requested AND NOT t.facility_public AND t.kind = 'team' AND private_sec.team_is_youth(t.id)
   ORDER BY t.updated_at;
END $$;
REVOKE ALL ON FUNCTION public.verify_team_facility_public(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_team_facility_public(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_team_facility_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_team_facility_public(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.revoke_team_facility_public(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_team_facility_requests() TO authenticated, service_role;

-- Existing rows: an exact copy for every affected team that has facility details. A copy only.
INSERT INTO public.team_facility_private (team_id, home_court, venues, venue_addresses, primary_venue, venue_geo)
SELECT t.id, t.home_court, COALESCE(t.venues, '{}'), COALESCE(t.venue_addresses, '[]'::jsonb), t.primary_venue, COALESCE(t.venue_geo, '[]'::jsonb)
  FROM public.teams t
 WHERE t.kind = 'team' AND NOT t.facility_public AND private_sec.team_is_youth(t.id)
   AND (NULLIF(btrim(t.home_court), '') IS NOT NULL OR cardinality(COALESCE(t.venues, '{}')) > 0
        OR COALESCE(t.venue_addresses, '[]'::jsonb) <> '[]'::jsonb OR NULLIF(btrim(t.primary_venue), '') IS NOT NULL
        OR COALESCE(t.venue_geo, '[]'::jsonb) <> '[]'::jsonb)
ON CONFLICT (team_id) DO NOTHING;

-- A second guard on the shared switch: no activation while an affected team lacks its private copy.
CREATE OR REPLACE FUNCTION public.guard_youth_location_switch_team_facilities()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE _missing integer;
BEGIN
  IF NEW.key IS DISTINCT FROM 'youth_location_privacy' THEN RETURN NEW; END IF;
  IF COALESCE((NEW.value ->> 'coarsen')::boolean, false)
     AND NOT (TG_OP = 'UPDATE' AND COALESCE((OLD.value ->> 'coarsen')::boolean, false)) THEN
    SELECT count(*) INTO _missing FROM public.teams t
     WHERE t.kind = 'team' AND NOT t.facility_public AND private_sec.team_is_youth(t.id)
       AND (NULLIF(btrim(t.home_court), '') IS NOT NULL OR cardinality(COALESCE(t.venues, '{}')) > 0
            OR COALESCE(t.venue_addresses, '[]'::jsonb) <> '[]'::jsonb OR NULLIF(btrim(t.primary_venue), '') IS NOT NULL
            OR COALESCE(t.venue_geo, '[]'::jsonb) <> '[]'::jsonb)
       AND NOT EXISTS (SELECT 1 FROM public.team_facility_private x WHERE x.team_id = t.id);
    IF _missing > 0 THEN
      RAISE EXCEPTION 'COARSENING_NOT_READY: % youth team(s) have no private copy of their facility details.', _missing USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_youth_location_switch_team_facilities() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_youth_location_switch_team_facilities() TO service_role;
DROP TRIGGER IF EXISTS guard_youth_location_switch_team_facilities_trg ON public.app_settings;
CREATE TRIGGER guard_youth_location_switch_team_facilities_trg BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_youth_location_switch_team_facilities();

CREATE OR REPLACE FUNCTION public.coarsen_existing_youth_team_facilities(_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n integer;
BEGIN
  IF NOT COALESCE((SELECT (value ->> 'coarsen')::boolean FROM public.app_settings WHERE key = 'youth_location_privacy'), false) THEN
    RAISE EXCEPTION 'COARSENING_NOT_ACTIVE: activate the guarded youth-location switch first.' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.coarsening_existing', '1', true);
  INSERT INTO public.team_facility_private (team_id, home_court, venues, venue_addresses, primary_venue, venue_geo)
  SELECT t.id, t.home_court, COALESCE(t.venues, '{}'), COALESCE(t.venue_addresses, '[]'::jsonb), t.primary_venue, COALESCE(t.venue_geo, '[]'::jsonb)
    FROM public.teams t WHERE t.kind = 'team' AND NOT t.facility_public AND private_sec.team_is_youth(t.id)
  ON CONFLICT (team_id) DO NOTHING;
  WITH batch AS (
    SELECT t.id FROM public.teams t
     WHERE t.kind = 'team' AND NOT t.facility_public AND private_sec.team_is_youth(t.id)
       AND (NULLIF(btrim(t.home_court), '') IS NOT NULL OR cardinality(COALESCE(t.venues, '{}')) > 0
            OR COALESCE(t.venue_addresses, '[]'::jsonb) <> '[]'::jsonb OR NULLIF(btrim(t.primary_venue), '') IS NOT NULL
            OR COALESCE(t.venue_geo, '[]'::jsonb) <> '[]'::jsonb)
     ORDER BY t.id LIMIT _limit FOR UPDATE)
  UPDATE public.teams t SET home_court = NULL, venues = '{}', venue_addresses = '[]'::jsonb, primary_venue = NULL, venue_geo = '[]'::jsonb
    FROM batch WHERE t.id = batch.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  PERFORM set_config('app.coarsening_existing', '', true);
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.coarsen_existing_youth_team_facilities(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coarsen_existing_youth_team_facilities(integer) TO service_role;

-- Clearing a value. While the public columns are empty, writing NULL is indistinguishable from a client sending back what it was
-- given, so a plain NULL write is treated as "no change". A manager removes a detail with this function instead.
CREATE OR REPLACE FUNCTION public.clear_team_facility_details(_team text, _fields text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_team_manager(_team, auth.uid()) THEN
    RAISE EXCEPTION 'Only this team''s owner, managers and coaches can change its facility details.' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(_fields) f WHERE f NOT IN ('home_court', 'venues', 'venue_addresses', 'primary_venue', 'venue_geo')) THEN
    RAISE EXCEPTION 'Unknown facility field.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.team_facility_private SET
    home_court      = CASE WHEN 'home_court'      = ANY (_fields) THEN NULL ELSE home_court END,
    venues          = CASE WHEN 'venues'          = ANY (_fields) THEN '{}' ELSE venues END,
    venue_addresses = CASE WHEN 'venue_addresses' = ANY (_fields) THEN '[]'::jsonb ELSE venue_addresses END,
    primary_venue   = CASE WHEN 'primary_venue'   = ANY (_fields) THEN NULL ELSE primary_venue END,
    venue_geo       = CASE WHEN 'venue_geo'       = ANY (_fields) THEN '[]'::jsonb ELSE venue_geo END,
    updated_at = now()
   WHERE team_id = _team;
  PERFORM set_config('app.coarsening_existing', '1', true);        -- the public columns are cleared too, without re-copying
  UPDATE public.teams SET
    home_court      = CASE WHEN 'home_court'      = ANY (_fields) THEN NULL ELSE home_court END,
    venues          = CASE WHEN 'venues'          = ANY (_fields) THEN '{}' ELSE venues END,
    venue_addresses = CASE WHEN 'venue_addresses' = ANY (_fields) THEN '[]'::jsonb ELSE venue_addresses END,
    primary_venue   = CASE WHEN 'primary_venue'   = ANY (_fields) THEN NULL ELSE primary_venue END,
    venue_geo       = CASE WHEN 'venue_geo'       = ANY (_fields) THEN '[]'::jsonb ELSE venue_geo END
   WHERE id = _team;
  PERFORM set_config('app.coarsening_existing', '', true);
END $$;
REVOKE ALL ON FUNCTION public.clear_team_facility_details(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_team_facility_details(text, text[]) TO authenticated, service_role;
