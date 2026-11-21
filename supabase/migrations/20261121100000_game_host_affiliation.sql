-- WP 3.0 (Phase 3): who a game is hosted as is decided by the server.
--
-- WHY. A game is written by the host's app (hosted_games insert, policy "Hosts can insert their games": host_id = the caller).
-- Nothing checked the team a game is published under: any member could put any team's id on their game (and so its name,
-- avatar and verified badge on the game page), and a game with no team at all was accepted from anyone allowed to host, while
-- the app said games are always published under a team. The owner decided (2026-11-19) that adults may host as themselves,
-- without a team; 16-17-year-olds keep hosting under a team; under-16s still cannot host (block_child_hosting).
--
-- WHAT. One trigger, BEFORE INSERT OR UPDATE OF team_id, host_id on hosted_games, for requests from a signed-in member:
-- 1. A game with a team: its host must own or manage that team (private_sec.is_team_manager: owner, manager or coach).
-- 2. A game without a team: its host must be an adult (age_cohort_of = 'adult').
-- On UPDATE it checks only when the team or the host changes, so editing other fields of an existing game is unaffected. A
-- team being deleted sets its games' team_id to NULL through the foreign key; that cascade (a nested trigger) is not refused.
-- The server itself (service role, jobs, migrations: no auth.uid()) is not limited here.
-- Production on 2026-11-19: 7 games, all under a team their host owns; nothing existing is touched.
--
-- Rollback: docs/rollbacks/20261121100000_game_host_affiliation.down.sql.

CREATE OR REPLACE FUNCTION private_sec.enforce_game_host_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.team_id IS NOT DISTINCT FROM OLD.team_id
     AND NEW.host_id IS NOT DISTINCT FROM OLD.host_id THEN
    RETURN NEW;
  END IF;
  -- a team deleted: the foreign key's ON DELETE SET NULL runs as a nested trigger
  IF TG_OP = 'UPDATE' AND NEW.team_id IS NULL AND OLD.team_id IS NOT NULL
     AND NEW.host_id IS NOT DISTINCT FROM OLD.host_id AND pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.team_id IS NOT NULL THEN
    IF NOT COALESCE(private_sec.is_team_manager(NEW.team_id, NEW.host_id), false) THEN
      RAISE EXCEPTION 'You can only host under a team profile you own or manage.'
        USING ERRCODE = '42501', HINT = 'GAME_TEAM_NOT_MANAGED';
    END IF;
  ELSIF public.age_cohort_of(NEW.host_id) IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'Only adults can host a game without a team profile. Host it under your team instead.'
      USING ERRCODE = '42501', HINT = 'HOST_AS_SELF_ADULTS_ONLY';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.enforce_game_host_affiliation() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS enforce_game_host_affiliation_trg ON public.hosted_games;
CREATE TRIGGER enforce_game_host_affiliation_trg
  BEFORE INSERT OR UPDATE OF team_id, host_id ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION private_sec.enforce_game_host_affiliation();
