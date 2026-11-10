-- Rollback of hotfix 20261102100000 (payment-settings writes): puts back the two write policies exactly as production
-- had them on 2026-11-05 and drops the two helpers. One statement, so it can be run whole through Lovable's database
-- tool or with psql. It reopens the hole the hotfix closes; use it only if the hotfix itself breaks something.
-- No row is changed. Afterwards the pre-check (docs/release/hotfix-payment-settings-precheck.sql) reports the
-- pre-hotfix state again, except for the ledger rows, which stay.
DO $rollback$
BEGIN
  DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
  CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
    FOR INSERT TO authenticated
    WITH CHECK (host_id = auth.uid());
  DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
  CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
    FOR UPDATE TO authenticated
    USING (host_id = auth.uid())
    WITH CHECK (host_id = auth.uid());
  DROP FUNCTION IF EXISTS private_sec.can_manage_game_payment_settings(text);
  DROP FUNCTION IF EXISTS private_sec.game_payee(text);
  RAISE NOTICE 'hotfix 20261102100000 rolled back: write policies restored, helpers dropped';
END
$rollback$;
