CREATE TABLE public.legal_consents (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  document_type text NOT NULL CHECK (document_type IN ('terms','privacy')),
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, document_type, document_version)
);

CREATE INDEX legal_consents_user_idx ON public.legal_consents(user_id);
CREATE INDEX legal_consents_doc_idx ON public.legal_consents(document_type, document_version);

GRANT SELECT, INSERT ON public.legal_consents TO authenticated;
GRANT ALL ON public.legal_consents TO service_role;

ALTER TABLE public.legal_consents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own consents"
ON public.legal_consents FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users record own consents"
ON public.legal_consents FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins view all consents"
ON public.legal_consents FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin'));

CREATE OR REPLACE FUNCTION public.legal_consent_stats()
RETURNS TABLE(document_type text, document_version text, accepted_count bigint, latest_accepted_at timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'superadmin')) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  RETURN QUERY
  SELECT lc.document_type,
         lc.document_version,
         count(DISTINCT lc.user_id)::bigint,
         max(lc.accepted_at)
  FROM public.legal_consents lc
  GROUP BY lc.document_type, lc.document_version
  ORDER BY lc.document_type, lc.document_version DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.legal_consent_stats() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.legal_consent_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.legal_consent_stats() TO authenticated;