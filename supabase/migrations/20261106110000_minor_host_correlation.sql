-- R1: while a person under 18 hosts a game that includes children, their account id (public in the game row) must not be a key that
-- unrelated accounts can use to look up other facts about them.
--
-- AUDIT RESULT (replayed combined schema, 2026-11-04; extended after the independent-review pass with realistic fixtures: approved team posts,
-- completed reels and a team the minor owns). The id stays in hosted_games.host_id: ownership, payments and every policy are
-- built on it. Following that id into every other table a signed-in or anonymous account can read, two paths still tied it to the person:
--   * team rosters: for a 16-17 year old, team_members rows are visible to every signed-in account (private_sec.roster_row_visible),
--     so a stranger learns which team the host belongs to;
--   * skill ratings: skill_ratings rows are readable by everyone, anonymous included, unless hidden, so a stranger learns the host's
--     sports and levels.
--   * team posts: a 16-17 year old's non-announcement post (recap, tryout, etc.) is public and carries author_id, anonymous visitors included;
--   * reels: a 16-17 year old's completed reel is visible to every signed-in account (audience 'members') and carries user_id;
--   * team ownership: teams.owner_id is readable by every signed-in account, so a minor who owns a team is linked to its name.
-- Names, photos and profiles were already closed (PRIV-2B, G4), as were reviews (PRIV-1), team posts, reels, votes and follows (tested in
-- 410). Availability posts are closed by R2.
--
-- WHAT THIS DOES. private_sec.minor_host_hidden(_user) is true when the person is not a confirmed adult, has an active youth-inclusive
-- game (private_sec.minor_has_active_youth_game), and the caller is neither them nor someone who may know a minor's name
-- (private_sec.can_see_minor_name: guardians, people who share a game, chat or team, staff dealing with them, accepted followers,
-- administrators and moderators). For such a person:
--   * roster_row_visible no longer shows their team rows to unrelated accounts (teammates, managers and guardians still see them);
--   * the skill_ratings read policy no longer returns their rows to unrelated accounts, anonymous included.
-- Everyone else, and the same person once their game is over or cancelled, is unchanged. Nothing is rewritten. The condition is the
-- one G4 already uses to require a private profile while hosting.
--
-- Production check done before writing: the current definitions of private_sec.roster_row_visible(text,uuid), private_sec.reel_publicly_visible(uuid), the team_posts policies and the skill_ratings
-- policy match the repository (read-only fingerprint comparison, 2026-11-04). Depends on 20261105140000 (G4) and 20261104120000.

CREATE OR REPLACE FUNCTION private_sec.minor_host_hidden(_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(public.age_cohort_of(_user), 'unknown') <> 'adult'
     AND private_sec.minor_has_active_youth_game(_user)
     AND NOT (auth.uid() IS NOT NULL AND (_user = auth.uid() OR private_sec.can_see_minor_name(auth.uid(), _user)))
$$;
REVOKE ALL ON FUNCTION private_sec.minor_host_hidden(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.minor_host_hidden(uuid) TO anon, authenticated, service_role;

-- Same body as before except the 16-17 branch.
CREATE OR REPLACE FUNCTION private_sec.roster_row_visible(_team_id text, _member_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE cohort text; caller uuid;
BEGIN
  IF _member_user_id IS NULL THEN RETURN true; END IF;

  cohort := public.age_cohort_of(_member_user_id);

  IF cohort NOT IN ('child_under_13','teen_13_15','teen_16_17') THEN
    RETURN true;
  END IF;

  caller := auth.uid();

  -- R1: a 16-17 year old with an active youth-inclusive game is not listed to unrelated accounts.
  IF cohort = 'teen_16_17' AND caller IS NOT NULL THEN
    IF NOT private_sec.minor_host_hidden(_member_user_id) THEN RETURN true; END IF;
    RETURN public.is_team_manager(_team_id, caller);  -- the related cases are already true inside minor_host_hidden
  END IF;

  IF caller IS NULL THEN RETURN false; END IF;
  IF caller = _member_user_id THEN RETURN true; END IF;
  IF public.is_guardian_of(caller, _member_user_id) THEN RETURN true; END IF;
  IF public.is_team_manager(_team_id, caller) THEN RETURN true; END IF;

  RETURN false;
END $function$;

DROP POLICY IF EXISTS "Skill ratings visible unless hidden" ON public.skill_ratings;
CREATE POLICY "Skill ratings visible unless hidden" ON public.skill_ratings FOR SELECT
  USING ((hidden = false AND NOT private_sec.minor_host_hidden(user_id)) OR user_id = auth.uid());

-- Team posts: a restrictive policy hides posts authored by a minor host from unrelated viewers while the game is active.
DROP POLICY IF EXISTS "team_posts_minor_host_author_hidden" ON public.team_posts;
CREATE POLICY "team_posts_minor_host_author_hidden" ON public.team_posts AS RESTRICTIVE FOR SELECT
  USING (author_id = auth.uid() OR NOT private_sec.minor_host_hidden(author_id));

-- Reels: the 'members' audience (16-17) excludes unrelated viewers while the owner is a minor host. Same body as before otherwise.
CREATE OR REPLACE FUNCTION private_sec.reel_publicly_visible(_reel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE public.reel_audience(_reel_id)
    WHEN 'public' THEN true
    WHEN 'members' THEN auth.uid() IS NOT NULL
      AND NOT private_sec.minor_host_hidden((SELECT r.user_id FROM public.highlight_reels r WHERE r.id = _reel_id))
    ELSE false
  END;
$function$;

-- Team ownership: teams.owner_id cannot be hidden per row, so a minor cannot be both the organizer of an active youth-inclusive game and the
-- owner of a team (either order). The message says how to resolve it. Adults are untouched; a team the minor only belongs to is not affected.
CREATE OR REPLACE FUNCTION public.refuse_minor_host_team_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_TABLE_NAME = 'teams' THEN
    IF NEW.hidden_at IS NOT NULL OR NEW.owner_id IS NULL THEN RETURN NEW; END IF;
    IF public.age_cohort_of(NEW.owner_id) IS DISTINCT FROM 'adult' AND private_sec.minor_has_active_youth_game(NEW.owner_id) THEN
      RAISE EXCEPTION 'MINOR_HOST_TEAM_OWNER: while you host a game that includes young people, a team owned by you would link your organizer account to the team. Ask an adult to own the team, or finish or cancel the game first.'
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
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.refuse_minor_host_team_owner() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refuse_minor_host_team_owner() TO service_role;
DROP TRIGGER IF EXISTS yy_minor_host_team_owner_trg ON public.hosted_games;
CREATE TRIGGER yy_minor_host_team_owner_trg BEFORE INSERT OR UPDATE OF host_id, min_age, max_age, cancelled_at, completed_at ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.refuse_minor_host_team_owner();
DROP TRIGGER IF EXISTS yy_minor_host_team_owner_trg ON public.teams;
CREATE TRIGGER yy_minor_host_team_owner_trg BEFORE INSERT OR UPDATE OF owner_id, hidden_at ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.refuse_minor_host_team_owner();
