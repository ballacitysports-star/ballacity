-- Break recursion in game_participants SELECT policy by moving the
-- "same-game participant" check into a SECURITY DEFINER helper. The
-- previous policy referenced game_participants itself in a subquery
-- which caused "infinite recursion detected in policy" (42P17) whenever
-- SELECT policies were evaluated as part of DELETE/UPDATE WHERE checks.

CREATE OR REPLACE FUNCTION public.is_game_participant(_game_id text, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.game_participants
    WHERE game_id = _game_id AND user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_game_participant(text, uuid) TO authenticated, anon, service_role;

DROP POLICY IF EXISTS "Host or same-game participants view roster" ON public.game_participants;

CREATE POLICY "Host or same-game participants view roster"
ON public.game_participants
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.hosted_games hg
    WHERE hg.id = game_participants.game_id
      AND hg.host_id = auth.uid()
  )
  OR public.is_game_participant(game_participants.game_id, auth.uid())
);