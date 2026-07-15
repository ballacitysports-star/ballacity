
DROP POLICY IF EXISTS "Players delete own pending submissions" ON public.payment_submissions;

CREATE POLICY "Players withdraw own submissions"
  ON public.payment_submissions
  FOR DELETE
  TO authenticated
  USING (player_id = auth.uid());
