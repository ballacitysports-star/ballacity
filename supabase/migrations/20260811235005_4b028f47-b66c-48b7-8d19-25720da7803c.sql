-- Helper
CREATE OR REPLACE FUNCTION public.is_superadmin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = 'superadmin'::public.app_role
  );
$$;

REVOKE ALL ON FUNCTION public.is_superadmin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_superadmin(uuid) TO authenticated, service_role;

-- Audit log
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  reason text,
  before jsonb,
  after jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Superadmins read audit log" ON public.admin_audit_log;
CREATE POLICY "Superadmins read audit log"
  ON public.admin_audit_log FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()));

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log (target_type, target_id);

-- App settings / feature flags
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  description text,
  is_public boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_settings TO anon;
GRANT SELECT ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public flags are readable" ON public.app_settings;
CREATE POLICY "Public flags are readable"
  ON public.app_settings FOR SELECT
  USING (is_public = true);

DROP POLICY IF EXISTS "Superadmins read all settings" ON public.app_settings;
CREATE POLICY "Superadmins read all settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()));

DROP TRIGGER IF EXISTS trg_app_settings_touch ON public.app_settings;
CREATE TRIGGER trg_app_settings_touch
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Soft-state columns
ALTER TABLE public.profiles              ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE public.profiles              ADD COLUMN IF NOT EXISTS suspended_reason text;
ALTER TABLE public.hosted_games          ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.teams                 ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.trainer_orgs          ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.team_posts            ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.player_availabilities ADD COLUMN IF NOT EXISTS hidden_at timestamptz;
ALTER TABLE public.post_comments         ADD COLUMN IF NOT EXISTS hidden_at timestamptz;

-- Seed superadmin from existing admins
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT user_id, 'superadmin'::public.app_role
FROM public.user_roles
WHERE role = 'admin'::public.app_role
ON CONFLICT (user_id, role) DO NOTHING;

-- Default feature flags
INSERT INTO public.app_settings (key, value, description, is_public) VALUES
  ('maintenance_mode', 'false'::jsonb, 'Show a maintenance banner across the app', true),
  ('signups_enabled', 'true'::jsonb, 'Allow new account creation', true),
  ('games_creation_enabled', 'true'::jsonb, 'Allow hosts to create new games', true),
  ('reels_enabled', 'true'::jsonb, 'Allow highlight reel generation', true),
  ('announcement_banner', '""'::jsonb, 'Site-wide announcement text', true)
ON CONFLICT (key) DO NOTHING;