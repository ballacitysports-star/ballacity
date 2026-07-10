
-- Participants table (game_id is text to match hosted_games.id and sample ids)
CREATE TABLE public.game_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

CREATE INDEX game_participants_user_idx ON public.game_participants(user_id);
CREATE INDEX game_participants_game_idx ON public.game_participants(game_id);

GRANT SELECT, INSERT, DELETE ON public.game_participants TO authenticated;
GRANT ALL ON public.game_participants TO service_role;

ALTER TABLE public.game_participants ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can see who's joined (needed for counts and rosters).
CREATE POLICY "Authenticated can view participants"
  ON public.game_participants FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can join for themselves"
  ON public.game_participants FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can leave for themselves"
  ON public.game_participants FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Keep hosted_games.joined in sync.
CREATE OR REPLACE FUNCTION public.sync_hosted_game_joined_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _gid text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _gid := NEW.game_id;
  ELSE
    _gid := OLD.game_id;
  END IF;
  UPDATE public.hosted_games hg
    SET joined = (SELECT COUNT(*) FROM public.game_participants WHERE game_id = _gid)
    WHERE hg.id = _gid;
  RETURN NULL;
END;
$$;

CREATE TRIGGER game_participants_sync_count
AFTER INSERT OR DELETE ON public.game_participants
FOR EACH ROW EXECUTE FUNCTION public.sync_hosted_game_joined_count();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_participants;
