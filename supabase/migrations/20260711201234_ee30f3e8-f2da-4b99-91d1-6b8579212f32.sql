ALTER TABLE public.game_participants ADD COLUMN position text;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_participants TO authenticated;
GRANT ALL ON public.game_participants TO service_role;

ALTER TABLE public.game_participants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can update their own position"
  ON public.game_participants FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);