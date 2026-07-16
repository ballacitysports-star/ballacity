CREATE POLICY "Hosts can remove participants from their games"
  ON public.game_participants FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.hosted_games hg
      WHERE hg.id = game_participants.game_id
        AND hg.host_id = auth.uid()
    )
  );