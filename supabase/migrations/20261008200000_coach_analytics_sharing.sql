-- Athlete-controlled sharing of Pro Analytics with the coaches of a team.
--
-- Today an athlete's analytics are visible only to them. This lets an athlete, or for
-- ages 13-15 their guardian, share them with the coaching staff of ONE team at a time.
--
--   adults and 16-17   the athlete turns it on themselves, per team
--   13-15              only a verified guardian can turn it on, per team
--   under 13, unknown  never available
--
-- OFF until app_settings 'coach_analytics' = {"enabled": true}. Missing means off.
--
-- Rows are written only by server code (service role). Every read re-checks, in
-- analytics_share_active(): the switch, the athlete's age rule, that they are still on
-- the team, that the account is not locked or suspended, and for 13-15 that the
-- guardian who turned it on is still a verified guardian. Ending any of those stops
-- the sharing at once, with no cleanup needed.

CREATE TABLE IF NOT EXISTS public.analytics_team_shares (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id text NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  set_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, team_id)
);

ALTER TABLE public.analytics_team_shares ENABLE ROW LEVEL SECURITY;

-- The athlete, or the guardian who set it, can see the row. Nobody else, and no
-- client can write.
DROP POLICY IF EXISTS "Athlete or setter reads analytics shares" ON public.analytics_team_shares;
CREATE POLICY "Athlete or setter reads analytics shares"
  ON public.analytics_team_shares FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR set_by = auth.uid());

REVOKE ALL ON public.analytics_team_shares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.analytics_team_shares TO authenticated;
GRANT ALL ON public.analytics_team_shares TO service_role;

CREATE OR REPLACE FUNCTION public.coach_analytics_enabled()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE((SELECT (value ->> 'enabled')::boolean FROM public.app_settings
                   WHERE key = 'coach_analytics'), false);
$$;

REVOKE EXECUTE ON FUNCTION public.coach_analytics_enabled() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_analytics_enabled() TO service_role;

-- Defence in depth: even a direct insert must satisfy the age and guardian rules.
CREATE OR REPLACE FUNCTION public.guard_analytics_team_share()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE c text;
BEGIN
  IF NOT public.coach_analytics_enabled() THEN
    RAISE EXCEPTION 'COACH_ANALYTICS_OFF';
  END IF;
  c := public.age_cohort_of(NEW.user_id);
  IF c IS NULL OR c NOT IN ('adult', 'teen_16_17', 'teen_13_15') THEN
    RAISE EXCEPTION 'COACH_ANALYTICS_NOT_AVAILABLE';
  END IF;
  IF public.child_features_locked(NEW.user_id) THEN
    RAISE EXCEPTION 'COACH_ANALYTICS_NOT_AVAILABLE';
  END IF;
  IF public.team_role_of(NEW.team_id, NEW.user_id) IS NULL THEN
    RAISE EXCEPTION 'COACH_ANALYTICS_NOT_ON_TEAM';
  END IF;
  IF c = 'teen_13_15' THEN
    IF NEW.set_by = NEW.user_id OR NOT public.is_guardian_of(NEW.set_by, NEW.user_id) THEN
      RAISE EXCEPTION 'COACH_ANALYTICS_GUARDIAN_REQUIRED';
    END IF;
  ELSIF NEW.set_by IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'COACH_ANALYTICS_SELF_ONLY';
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_analytics_team_share() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_analytics_team_share ON public.analytics_team_shares;
CREATE TRIGGER trg_guard_analytics_team_share
BEFORE INSERT ON public.analytics_team_shares
FOR EACH ROW EXECUTE FUNCTION public.guard_analytics_team_share();

-- The single check used on every read.
CREATE OR REPLACE FUNCTION public.analytics_share_active(_user uuid, _team text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE s record; c text;
BEGIN
  IF NOT public.coach_analytics_enabled() THEN
    RETURN false;
  END IF;
  SELECT user_id, set_by INTO s FROM public.analytics_team_shares
  WHERE user_id = _user AND team_id = _team;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  c := public.age_cohort_of(_user);
  IF c IS NULL OR c NOT IN ('adult', 'teen_16_17', 'teen_13_15') THEN
    RETURN false;
  END IF;
  IF public.child_features_locked(_user) OR public.team_role_of(_team, _user) IS NULL THEN
    RETURN false;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _user AND p.suspended_at IS NOT NULL) THEN
    RETURN false;
  END IF;
  IF c = 'teen_13_15' AND NOT public.is_guardian_of(s.set_by, _user) THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;

REVOKE EXECUTE ON FUNCTION public.analytics_share_active(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_share_active(uuid, text) TO service_role;

-- Athletes a coach may read analytics for on one team. Empty unless the viewer is
-- team staff (owner, manager or coach) and is not themselves a child.
CREATE OR REPLACE FUNCTION public.coach_analytics_athletes(_viewer uuid, _team text)
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF _viewer IS NULL OR NOT public.coach_analytics_enabled() THEN
    RETURN;
  END IF;
  IF NOT public.is_team_manager(_team, _viewer)
     OR public.age_cohort_of(_viewer) IS DISTINCT FROM 'adult'
     OR public.child_features_locked(_viewer) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT s.user_id FROM public.analytics_team_shares s
    WHERE s.team_id = _team
      AND s.user_id <> _viewer
      AND public.analytics_share_active(s.user_id, _team);
END $$;

REVOKE EXECUTE ON FUNCTION public.coach_analytics_athletes(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.coach_analytics_athletes(uuid, text) TO service_role;
