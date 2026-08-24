CREATE OR REPLACE FUNCTION public.admin_list_storage_objects(
  _buckets text[],
  _search text DEFAULT NULL,
  _status text DEFAULT NULL,
  _limit int DEFAULT 60,
  _offset int DEFAULT 0
)
RETURNS TABLE(
  bucket_id text,
  name text,
  owner uuid,
  size bigint,
  mimetype text,
  created_at timestamptz,
  status text,
  reason text,
  reviewed_at timestamptz,
  total bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT o.bucket_id,
           o.name,
           o.owner,
           (o.metadata->>'size')::bigint AS size,
           o.metadata->>'mimetype' AS mimetype,
           o.created_at,
           COALESCE(m.status, 'pending') AS status,
           m.reason,
           m.reviewed_at
      FROM storage.objects o
      LEFT JOIN public.image_moderation m
        ON m.bucket = o.bucket_id AND m.path = o.name
     WHERE o.bucket_id = ANY(_buckets)
       AND (_search IS NULL OR btrim(_search) = '' OR o.name ILIKE '%' || btrim(_search) || '%')
       AND (_status IS NULL OR _status = 'all' OR COALESCE(m.status, 'pending') = _status)
  ), counted AS (
    SELECT count(*)::bigint AS total FROM rows
  )
  SELECT r.bucket_id, r.name, r.owner, r.size, r.mimetype, r.created_at,
         r.status, r.reason, r.reviewed_at, c.total
    FROM rows r CROSS JOIN counted c
   ORDER BY r.created_at DESC
   LIMIT GREATEST(1, LEAST(_limit, 200))
  OFFSET GREATEST(0, _offset);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_storage_objects(text[], text, text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_list_storage_objects(text[], text, text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_list_storage_objects(text[], text, text, int, int) TO authenticated, service_role;
