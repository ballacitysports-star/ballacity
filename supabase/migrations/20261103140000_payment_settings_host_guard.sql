-- Payment settings can only be written by the host of the game they describe.
--
-- The INSERT and UPDATE policies on public.game_payment_settings only checked host_id = auth.uid(), not that the
-- caller hosts the game named by game_id. Any signed-in account could therefore add a settings row for someone
-- else's game. The game page and the payment flow take "the latest settings row for the game" as the source of
-- truth for who the host is and whose payment methods players are shown, so a stranger's newer row could redirect
-- players' payments to the stranger and make the stranger look like the host. This closes the write path.
--
-- Additive: two policies are replaced and one helper added. No row is changed. Rows that were already written
-- for a game by someone other than its host (if any) are not touched here; the read-only query in the PR lists them
-- for the owner to review.
-- Reads the caller from auth.uid(); no user argument, so it is not a lookup of who hosts what for third parties.
CREATE OR REPLACE FUNCTION private_sec.is_game_host(_game_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id AND g.host_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION private_sec.is_game_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.is_game_host(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
  FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND private_sec.is_game_host(game_id));

DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
  FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid() AND private_sec.is_game_host(game_id));
