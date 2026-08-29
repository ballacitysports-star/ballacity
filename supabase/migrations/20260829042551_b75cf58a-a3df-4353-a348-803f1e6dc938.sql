CREATE POLICY "Anyone can view visible completed reels"
ON public.highlight_reels
FOR SELECT
TO anon, authenticated
USING (hidden_at IS NULL AND status = 'completed');