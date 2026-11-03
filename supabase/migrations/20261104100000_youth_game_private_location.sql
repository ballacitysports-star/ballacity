-- PRIV-2A: private storage for the exact location of youth-inclusive games.
--
-- WHY. Any signed-in account can read every non-private game row, including the exact venue, address and
-- coordinates of games that may include children (anonymous visitors cannot: they only see adult-only games).
-- Row-level security cannot hide single columns, and hiding whole youth rows would end coarse discovery, so the
-- exact location moves to its own table with its own access rule, and the public columns can hold a coarse
-- form.
--
-- THIS MIGRATION IS ADDITIVE AND CHANGES NO BEHAVIOUR. Nothing reads the new table yet and hosted_games is not
-- modified (the coarsening switch is seeded OFF). It does NOT, by itself, close the exposure: that needs the app
-- to read the exact location from the new table (PRIV-2C), then the switch turned on, then the existing rows
-- coarsened with the batch function below, each a separately approved step. See the PR for the rollout order.
--
-- Youth-inclusive = NOT public.game_age_range_is_adult_only(min_age, max_age). A game with no age limit set is
-- youth-inclusive.
--
-- WHO MAY READ THE EXACT LOCATION (and nobody else; being signed in, a pending join request, a waitlist place
-- and a guardian's pending request grant nothing): the host; a person on the roster; a verified, active guardian
-- of anyone on the roster; a manager of the game's team; an admin or owner of the game's organization. Staff use
-- the service role.
--
-- Not added to the realtime publication, on purpose.

CREATE TABLE IF NOT EXISTS public.hosted_game_private (
  game_id    text PRIMARY KEY REFERENCES public.hosted_games(id) ON DELETE CASCADE
             DEFERRABLE INITIALLY DEFERRED,   -- a BEFORE INSERT trigger stores the private row before the game row exists
  location   text,
  lat        numeric,
  lng        numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hosted_game_private ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.hosted_game_private FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.hosted_game_private TO authenticated;       -- rows still filtered by the policy
GRANT ALL ON public.hosted_game_private TO service_role;
-- Deliberately NOT added to the supabase_realtime publication.

-- Who may read the exact location of a game. A pending join request, a waitlist entry and being
-- signed in grant nothing.
CREATE OR REPLACE FUNCTION private_sec.can_see_exact_game_location(_game_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hosted_games g
    WHERE g.id = _game_id
      AND (
        g.host_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.game_participants p
                    WHERE p.game_id = g.id AND p.user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM public.game_participants p
                    JOIN public.guardian_links gl
                      ON gl.child_user_id = p.user_id AND gl.parent_user_id = auth.uid()
                     AND gl.status = 'active' AND gl.verified_at IS NOT NULL
                    WHERE p.game_id = g.id)
        OR (g.team_id IS NOT NULL AND public.is_team_manager(g.team_id, auth.uid()))
        OR (g.org_id IS NOT NULL AND public.is_trainer_org_admin(g.org_id, auth.uid()))
      )
  );
$$;
REVOKE ALL ON FUNCTION private_sec.can_see_exact_game_location(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_see_exact_game_location(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Authorized people read exact game location" ON public.hosted_game_private;
CREATE POLICY "Authorized people read exact game location" ON public.hosted_game_private
  FOR SELECT TO authenticated USING (private_sec.can_see_exact_game_location(game_id));

-- Coarse form of a location: the neighborhood label if the host gave one, coordinates to 2 decimals
-- (~1 km). Never a venue name or street.
CREATE OR REPLACE FUNCTION private_sec.coarse_game_label(_neighborhood text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT COALESCE(NULLIF(btrim(_neighborhood), ''), 'Location shared after you join');
$$;

-- Keeps the private copy in step with hosted_games. Runs before the row is written.
--   * always: for a youth-inclusive game, when the submitted location differs from the stored one
--     (or on insert), store the submitted values privately as the exact location. An edit form that
--     round-trips the stored (possibly coarse) values changes nothing, so exact data is never
--     overwritten by coarse data.
--   * only when app_settings 'youth_location_privacy' has {"coarsen": true}: also replace the
--     public columns with the coarse form. Off by default, so this migration changes no behaviour.
--   * a game that becomes adult-only gets its exact values back and loses its private row.
CREATE OR REPLACE FUNCTION public.sync_hosted_game_private()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
    IF TG_OP = 'UPDATE' AND _was_youth AND NOT _changed THEN
      SELECT * INTO _p FROM public.hosted_game_private WHERE game_id = NEW.id;
      IF FOUND THEN
        NEW.location := _p.location; NEW.lat := _p.lat; NEW.lng := _p.lng;
      END IF;
    END IF;
    IF TG_OP = 'UPDATE' THEN DELETE FROM public.hosted_game_private WHERE game_id = NEW.id; END IF;
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
END $$;
REVOKE ALL ON FUNCTION public.sync_hosted_game_private() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_hosted_game_private() TO service_role;

-- One BEFORE trigger for INSERT and UPDATE. Named so it runs before the game's other BEFORE triggers
-- (they must not see a half-coarsened row) but after nothing that edits the location.
DROP TRIGGER IF EXISTS a1_sync_hosted_game_private_trg ON public.hosted_games;
CREATE TRIGGER a1_sync_hosted_game_private_trg BEFORE INSERT OR UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.sync_hosted_game_private();

-- Existing data: an exact copy for every youth-inclusive game. A copy only; hosted_games is untouched.
INSERT INTO public.hosted_game_private (game_id, location, lat, lng)
SELECT g.id, g.location, g.lat, g.lng
  FROM public.hosted_games g
 WHERE NOT public.game_age_range_is_adult_only(g.min_age, g.max_age)
ON CONFLICT (game_id) DO NOTHING;

-- Coarsening switch, OFF. Not a public setting: only the server reads it.
INSERT INTO public.app_settings (key, value, is_public)
VALUES ('youth_location_privacy', '{"coarsen": false}'::jsonb, false)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------------------------------------
-- Existing rows, handled in two separate steps (this migration does only the first):
--   1. (above) every youth-inclusive game gets an exact copy in hosted_game_private.
--   2. (below, NOT run by this migration) a batched, idempotent, reversible function that replaces the public
--      columns with the coarse form once the app no longer needs them; restore_exact_youth_games undoes it from
--      the private copy. Both are service-role only. Run them only on explicit approval.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coarsen_existing_youth_games(_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n integer;
BEGIN
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
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.coarsen_existing_youth_games(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coarsen_existing_youth_games(integer) TO service_role;

-- Reverse: put the exact values back from the private copy.
CREATE OR REPLACE FUNCTION public.restore_exact_youth_games(_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _n integer;
BEGIN
  PERFORM set_config('app.coarsening_existing', '1', true);
  WITH batch AS (
    SELECT g.id FROM public.hosted_games g JOIN public.hosted_game_private p ON p.game_id = g.id
     WHERE g.location IS DISTINCT FROM p.location OR g.lat IS DISTINCT FROM p.lat OR g.lng IS DISTINCT FROM p.lng
     ORDER BY g.id LIMIT _limit FOR UPDATE OF g)
  UPDATE public.hosted_games g SET location = p.location, lat = p.lat, lng = p.lng
    FROM public.hosted_game_private p, batch WHERE g.id = batch.id AND p.game_id = g.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.restore_exact_youth_games(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.restore_exact_youth_games(integer) TO service_role;
