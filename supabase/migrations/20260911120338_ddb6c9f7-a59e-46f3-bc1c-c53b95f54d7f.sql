drop policy if exists "Anyone can read previously published versions" on public.legal_documents;

create policy "Anyone can read previously published versions"
on public.legal_documents
for select
to anon, authenticated
using (published AND published_at IS NOT NULL);