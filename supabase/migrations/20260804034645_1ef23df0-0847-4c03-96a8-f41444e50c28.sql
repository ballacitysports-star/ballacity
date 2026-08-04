ALTER TABLE public.game_position_waitlist
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'waiting',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

ALTER TABLE public.game_position_waitlist
  DROP CONSTRAINT IF EXISTS game_position_waitlist_status_check;
ALTER TABLE public.game_position_waitlist
  ADD CONSTRAINT game_position_waitlist_status_check
  CHECK (status IN ('waiting', 'approved', 'declined'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.game_position_waitlist TO authenticated;
GRANT ALL ON public.game_position_waitlist TO service_role;

DROP POLICY IF EXISTS "Host can review waitlist entries for their games" ON public.game_position_waitlist;
CREATE POLICY "Host can review waitlist entries for their games"
  ON public.game_position_waitlist
  FOR UPDATE
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hosted_games hg
    WHERE hg.id = game_position_waitlist.game_id AND hg.host_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.hosted_games hg
    WHERE hg.id = game_position_waitlist.game_id AND hg.host_id = auth.uid()
  ));