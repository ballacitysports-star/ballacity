DROP POLICY IF EXISTS "Players cancel own pending join requests" ON public.join_requests;

CREATE POLICY "Players cancel own pending or rejected join requests"
ON public.join_requests
FOR DELETE
USING (
  player_id = auth.uid()
  AND status IN ('pending', 'rejected')
);