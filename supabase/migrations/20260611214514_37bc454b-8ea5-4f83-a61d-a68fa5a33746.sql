
ALTER TABLE public.highlight_reels
  ADD COLUMN IF NOT EXISTS error_message text,
  ADD COLUMN IF NOT EXISTS failed_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;

DROP POLICY IF EXISTS "Admins view all reels" ON public.highlight_reels;
CREATE POLICY "Admins view all reels" ON public.highlight_reels
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update reels" ON public.highlight_reels;
CREATE POLICY "Admins update reels" ON public.highlight_reels
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
