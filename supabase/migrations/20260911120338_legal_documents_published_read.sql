-- Back-filled into git on 2026-09-12. Not authored here.
--
-- Applied directly to production by the Lovable agent (created_by
-- apikey@lovable.dev, version 20260911120338); present in no branch of this
-- repository. Recorded verbatim so `supabase db push` treats it as applied.
--
-- Effect: the historical-versions read policy on legal_documents previously
-- admitted any row with a published_at, including one later unpublished. It now
-- also requires `published`, so only the live version and genuinely published
-- history are readable.
--
-- The Terms, Privacy and Cookie documents published on 2026-09-11 all carry
-- published = true and a published_at, so they satisfy this policy.

drop policy if exists "Anyone can read previously published versions" on public.legal_documents;

create policy "Anyone can read previously published versions"
on public.legal_documents
for select
to anon, authenticated
using (published AND published_at IS NOT NULL);
