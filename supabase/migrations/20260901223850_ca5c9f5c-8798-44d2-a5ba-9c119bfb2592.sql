ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx ON public.admin_audit_log (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON public.admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log (target_type, target_id);

-- Append-only at the storage level: no role (including service_role) may edit or
-- remove history. Only a database superuser can, for legal retention purposes.
CREATE OR REPLACE FUNCTION public.admin_audit_log_append_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'admin_audit_log is append-only: % is not allowed', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS admin_audit_log_no_update ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_update
  BEFORE UPDATE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_append_only();

DROP TRIGGER IF EXISTS admin_audit_log_no_delete ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_no_delete
  BEFORE DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.admin_audit_log_append_only();

REVOKE ALL ON public.admin_audit_log FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.admin_audit_log FROM authenticated;
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT SELECT, INSERT ON public.admin_audit_log TO service_role;
REVOKE UPDATE, DELETE, TRUNCATE ON public.admin_audit_log FROM service_role;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

REVOKE EXECUTE ON FUNCTION public.admin_audit_log_append_only() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_audit_log_append_only() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_audit_log_append_only() FROM authenticated;

-- Distinct actors/actions for the admin log filters (readable by moderators only).
CREATE OR REPLACE FUNCTION public.admin_audit_log_facets()
RETURNS TABLE(kind text, value text, label text, uses bigint)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  RETURN QUERY
  SELECT 'action'::text, l.action, l.action, count(*)
  FROM public.admin_audit_log l
  GROUP BY l.action
  UNION ALL
  SELECT 'target_type'::text, l.target_type, l.target_type, count(*)
  FROM public.admin_audit_log l
  GROUP BY l.target_type
  UNION ALL
  SELECT 'actor'::text, l.actor_id::text, coalesce(p.display_name, 'Unknown admin'), count(*)
  FROM public.admin_audit_log l
  LEFT JOIN public.profiles p ON p.id = l.actor_id
  WHERE l.actor_id IS NOT NULL
  GROUP BY l.actor_id, p.display_name;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_audit_log_facets() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_audit_log_facets() FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_audit_log_facets() TO authenticated;