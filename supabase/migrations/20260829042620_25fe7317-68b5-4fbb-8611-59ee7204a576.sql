GRANT SELECT, INSERT, UPDATE, DELETE ON public.highlight_reels TO authenticated;
GRANT SELECT ON public.highlight_reels TO anon;
GRANT ALL ON public.highlight_reels TO service_role;