
CREATE TABLE public.game_position_waitlist (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id text NOT NULL,
  position text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (game_id, position, user_id)
);

GRANT SELECT, INSERT, DELETE ON public.game_position_waitlist TO authenticated;
GRANT ALL ON public.game_position_waitlist TO service_role;

ALTER TABLE public.game_position_waitlist ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view waitlist"
  ON public.game_position_waitlist FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can add themselves to waitlist"
  ON public.game_position_waitlist FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove themselves from waitlist"
  ON public.game_position_waitlist FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Host can remove waitlist entries for their games"
  ON public.game_position_waitlist FOR DELETE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hosted_games hg
    WHERE hg.id = game_position_waitlist.game_id
      AND hg.host_id = auth.uid()
  ));

CREATE INDEX idx_game_position_waitlist_game ON public.game_position_waitlist (game_id, position, created_at);
CREATE INDEX idx_game_position_waitlist_user ON public.game_position_waitlist (user_id);

ALTER TABLE public.game_position_waitlist REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.game_position_waitlist;
