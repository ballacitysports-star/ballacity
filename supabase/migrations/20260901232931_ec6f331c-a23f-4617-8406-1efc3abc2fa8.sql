REVOKE ALL ON public.data_export_requests FROM anon;
REVOKE ALL ON public.data_export_requests FROM authenticated;
GRANT SELECT, INSERT ON public.data_export_requests TO authenticated;
GRANT ALL ON public.data_export_requests TO service_role;