
DROP POLICY IF EXISTS "Players cancel own pending or rejected join requests" ON public.join_requests;

CREATE POLICY "Players withdraw own join requests"
  ON public.join_requests
  FOR DELETE
  TO authenticated
  USING (player_id = auth.uid());
