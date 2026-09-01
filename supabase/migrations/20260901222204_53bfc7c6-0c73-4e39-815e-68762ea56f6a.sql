CREATE POLICY "Anyone can read previously published versions"
ON public.legal_documents FOR SELECT TO anon, authenticated
USING (published_at IS NOT NULL);