-- Hotfix: only a game's host may write that game's payment settings. Ships ahead of the privacy release.
--
-- THE HOLE (live in production, checked read-only on 2026-11-05). The INSERT and UPDATE policies on
-- public.game_payment_settings only check host_id = auth.uid(), not that the caller hosts the game named by game_id.
-- enforce_game_join_gate takes requires_approval and entry_fee from the newest settings row of the game. So any
-- signed-in account could add a row { game_id: <someone else's game>, host_id: <itself>, requires_approval: false,
-- entry_fee: 0 } and then add itself to that game's participants with no host approval, youth games included. It
-- does not need payments to be switched on. (A host could also move one of its own rows to another game with an
-- UPDATE of game_id.)
--
-- THE FIX. Both write policies also require that the caller hosts the game (hosted_games.host_id = auth.uid()). The
-- helpers and policies are exactly the ones the release's 20261103140000_payment_settings_host_guard creates (same
-- names, bodies and grants), so when the release lands it re-creates them unchanged and adds the rest of that
-- migration (reads that believe only the host's row, the payment-destination check). Nothing else changes and no
-- row is changed or deleted.
--
-- At the end it refuses to finish if any settings row is held by someone other than its game's host: the readers
-- that still take "the newest row" are only safe when every row is the host's. Production had none when checked.

CREATE OR REPLACE FUNCTION private_sec.game_payee(_game_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT g.host_id FROM public.hosted_games g WHERE g.id = _game_id
$$;
REVOKE ALL ON FUNCTION private_sec.game_payee(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.game_payee(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.can_manage_game_payment_settings(_game_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND private_sec.game_payee(_game_id) = auth.uid()
$$;
REVOKE ALL ON FUNCTION private_sec.can_manage_game_payment_settings(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.can_manage_game_payment_settings(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
  FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id));

DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
  FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.game_payment_settings s
               JOIN public.hosted_games g ON g.id = s.game_id
              WHERE s.host_id IS DISTINCT FROM g.host_id) THEN
    RAISE EXCEPTION 'HOTFIX_STOPPED: a game_payment_settings row is held by someone other than its game''s host. Review those rows before applying this hotfix.'
      USING ERRCODE = 'P0001';
  END IF;
END $$;