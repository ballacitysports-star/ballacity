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
-- and a guardian's pending request grant nothing): the host; a person on the roster whose entry fee, if the game
-- has one, has been paid (a verified payment) or does not apply (the game is free); a verified, active guardian
-- of such a person; a manager of the game's team; an admin or owner of the game's organization. Staff use the
-- service role. (There is no per-player fee waiver in the data model yet; a waiver feature would plug into
-- private_sec.game_fee_satisfied.)
--
-- COARSENING IS ONE-WAY AND CANNOT START EARLY. The switch below (app_settings 'youth_location_privacy') is guarded by
-- a trigger: it can be turned on only after the application is confirmed to read exact locations, every
-- youth-inclusive game has an exact private copy, and the person doing it types a confirmation; once on, it cannot be
-- turned off, and there is NO function that puts exact values back into the public columns (the exact copy stays in
-- hosted_game_private; recovery is by fixing forward, never by re-publishing exact locations).
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

-- Is the entry fee of this game settled for this person? True when the game has no fee, or the person has a verified
-- payment. The fee is the one in the host's own settings row, else the game's listed price (a game hosted by a minor
-- keeps its fee in the payment manager's row; its listed price stands in for it). Service role / definer only.
CREATE OR REPLACE FUNCTION private_sec.game_fee_satisfied(_game_id text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE((
    SELECT COALESCE((SELECT s.entry_fee FROM public.game_payment_settings s
                      WHERE s.game_id = g.id AND s.host_id = g.host_id), g.price, 0) <= 0
        OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                    WHERE ps.game_id = g.id AND ps.player_id = _user AND ps.status = 'verified')
      FROM public.hosted_games g WHERE g.id = _game_id), false)
$$;
REVOKE ALL ON FUNCTION private_sec.game_fee_satisfied(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.game_fee_satisfied(text, uuid) TO service_role;

-- Who may read the exact location of a game. A pending join request, a waitlist entry, being signed in and a
-- roster place whose entry fee is still unpaid grant nothing.
CREATE OR REPLACE FUNCTION private_sec.can_see_exact_game_location(_game_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hosted_games g
    WHERE g.id = _game_id
      AND (
        g.host_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.game_participants p
                    WHERE p.game_id = g.id AND p.user_id = auth.uid()
                      AND private_sec.game_fee_satisfied(g.id, p.user_id))
        OR EXISTS (SELECT 1 FROM public.game_participants p
                    JOIN public.guardian_links gl
                      ON gl.child_user_id = p.user_id AND gl.parent_user_id = auth.uid()
                     AND gl.status = 'active' AND gl.verified_at IS NOT NULL
                    WHERE p.game_id = g.id AND private_sec.game_fee_satisfied(g.id, p.user_id))
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

-- The switch is guarded. It can go from off to on only when ALL of these hold:
--   * the value carries "app_adoption_confirmed": "2c-verified" (set on purpose by the owner once the application
--     that reads exact locations from hosted_game_private is live and verified);
--   * the session says so on purpose: SET app.confirm_activate_youth_coarsening = 'yes' (so a stray edit in an admin
--     tool or SQL console cannot flip it);
--   * every youth-inclusive game has an exact private copy (so nothing is coarsened that cannot be recovered).
-- Once on it can never be turned off or deleted: switching it off would make every new youth game public with its exact
-- venue again. Recovery is by fixing forward.
CREATE OR REPLACE FUNCTION public.guard_youth_location_switch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _old boolean := false;
  _new boolean := false;
  _missing integer;
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
    NEW.value := NEW.value || jsonb_build_object('activated_at', now());
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_youth_location_switch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_youth_location_switch() TO service_role;
DROP TRIGGER IF EXISTS guard_youth_location_switch_trg ON public.app_settings;
CREATE TRIGGER guard_youth_location_switch_trg BEFORE INSERT OR UPDATE OR DELETE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.guard_youth_location_switch();

-- ---------------------------------------------------------------------------------------------------------
-- Existing rows, handled in two separate steps (this migration does only the first):
--   1. (above) every youth-inclusive game gets an exact copy in hosted_game_private.
--   2. (below, NOT run by this migration) a batched, idempotent function that replaces the public columns with the
--      coarse form. The exact values stay in the private copy and there is no inverse. It refuses to run until the
--      switch above has been activated (so every readiness check has passed first). Service role only; run it only
--      on explicit approval.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coarsen_existing_youth_games(_limit integer DEFAULT 200)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
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
  RETURN _n;
END $$;
REVOKE ALL ON FUNCTION public.coarsen_existing_youth_games(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coarsen_existing_youth_games(integer) TO service_role;

-- There is deliberately NO function that puts exact values back into the public columns: once coarsening has run, the
-- exact copy lives only in hosted_game_private and recovery is by fixing forward.
