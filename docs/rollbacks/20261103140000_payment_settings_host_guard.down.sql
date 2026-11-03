-- ROLLBACK for supabase/migrations/20261103140000_payment_settings_host_guard.sql.
-- NOT a migration. Re-opens the hole: any signed-in account can write payment settings for any game.
--     PGOPTIONS="-c app.confirm_reopen_payment_settings=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_payment_settings', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets any account write payment settings for any game. Set app.confirm_reopen_payment_settings=yes to proceed deliberately.';
  END IF;
END
$guard$;
DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
  FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
  FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
DROP FUNCTION IF EXISTS private_sec.is_game_host(text);
COMMIT;
