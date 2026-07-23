
-- 1. game_payment_settings: restrict SELECT
DROP POLICY IF EXISTS "Signed-in users read payment settings" ON public.game_payment_settings;
CREATE POLICY "Host and linked players read payment settings"
ON public.game_payment_settings
FOR SELECT
TO authenticated
USING (
  host_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.join_requests jr
    WHERE jr.game_id = game_payment_settings.game_id
      AND jr.player_id = auth.uid()
      AND jr.status = 'approved'
  )
  OR EXISTS (
    SELECT 1 FROM public.payment_submissions ps
    WHERE ps.game_id = game_payment_settings.game_id
      AND ps.player_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.game_participants gp
    WHERE gp.game_id = game_payment_settings.game_id
      AND gp.user_id = auth.uid()
  )
);

-- 2. trainer_org_members: remove anon exposure
DROP POLICY IF EXISTS "org members are publicly viewable" ON public.trainer_org_members;

-- 3. storage: remove broad anon LIST policies on public buckets (direct URL reads still work)
DROP POLICY IF EXISTS "Public read image buckets" ON storage.objects;
DROP POLICY IF EXISTS "Game covers are publicly readable" ON storage.objects;
DROP POLICY IF EXISTS "team_covers_public_read" ON storage.objects;

-- 4. Revoke EXECUTE from anon on all SECURITY DEFINER functions in public schema
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, public', r.sig);
  END LOOP;
END $$;
