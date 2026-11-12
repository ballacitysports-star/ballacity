-- P1-1: real follower counts on team and trainer cards.
--
-- Directory cards (Discover: teams, trainers) showed teams.followers, a column nothing writes since entity follows
-- (20261106180000) moved following into public.entity_follows: every card read 0, or a seed value, and never changed
-- after a follow. The team page already reads the real count one entity at a time (entity_follow_state); a list of
-- cards needs it for many at once.
--
-- public.entity_follow_counts(kind, ids): for up to 200 ids, each entity's follower count and whether the caller
-- follows it. Same rule as entity_follow_state: counts only, never who; nothing for an entity the caller cannot see
-- (hidden, unless they own it) or that does not exist; signed-in callers only.
-- Rollback: docs/rollbacks/20261110130000_entity_follow_counts.down.sql (guarded).

CREATE OR REPLACE FUNCTION public.entity_follow_counts(_kind text, _ids text[])
RETURNS TABLE (id text, followers integer, following boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me uuid := auth.uid();
BEGIN
  IF _kind IS NULL OR _kind NOT IN ('team', 'org') OR _ids IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT x.target_id,
         count(f.follower_id)::integer,
         coalesce(bool_or(f.follower_id = me), false)
  FROM (SELECT DISTINCT u AS target_id FROM unnest(_ids[1:200]) AS u WHERE u IS NOT NULL) x
  CROSS JOIN LATERAL private_sec.entity_follow_target(_kind, x.target_id) t
  LEFT JOIN public.entity_follows f ON f.target_kind = _kind AND f.target_id = x.target_id
  WHERE t.visible OR (me IS NOT NULL AND t.owner_id = me)
  GROUP BY x.target_id;
END $$;

REVOKE ALL ON FUNCTION public.entity_follow_counts(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.entity_follow_counts(text, text[]) TO authenticated, service_role;
