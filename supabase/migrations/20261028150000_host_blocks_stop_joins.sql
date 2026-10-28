-- A host's block now holds in the database.
--
-- "Block" on a join request used to write a list into the host's own browser
-- (blocked-users-store). The player's app never reads the host's browser, so the
-- block stopped nothing. The account-level block (public.user_blocks, written by
-- the same Block button from now on) already stops messages and follows between
-- the two; this makes it stop the blocked person asking to join, or joining, the
-- blocker's games as well.
--
-- Both writes a player makes for themselves are covered, because the game page is
-- not a boundary: a join request, and a roster row for a game that needs no
-- approval. The host is read from the game, never from the row, so a request
-- that names someone else as its host is checked against the real one.
--
-- It applies only when the blocked person is acting for themselves
-- (auth.uid() = the player). The service role's roster add after a verified
-- payment is not stopped by it. It is one-directional: a player who blocked a
-- host can still ask to join that host's games.

CREATE OR REPLACE FUNCTION public.enforce_host_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _player uuid;
  _host uuid;
BEGIN
  -- Plain IF, not a CASE: each table has only one of these two columns.
  IF TG_TABLE_NAME = 'join_requests' THEN
    _player := NEW.player_id;
  ELSE
    _player := NEW.user_id;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> _player THEN
    RETURN NEW;
  END IF;

  SELECT host_id INTO _host FROM public.hosted_games WHERE id = NEW.game_id;
  IF _host IS NULL THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.user_blocks
     WHERE blocker_id = _host AND blocked_id = _player
  ) THEN
    RAISE EXCEPTION 'BLOCKED_BY_HOST: you can''t join this host''s games.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_host_block() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_host_block() FROM anon;

DROP TRIGGER IF EXISTS enforce_host_block_requests ON public.join_requests;
CREATE TRIGGER enforce_host_block_requests
BEFORE INSERT ON public.join_requests
FOR EACH ROW EXECUTE FUNCTION public.enforce_host_block();

DROP TRIGGER IF EXISTS enforce_host_block_participants ON public.game_participants;
CREATE TRIGGER enforce_host_block_participants
BEFORE INSERT ON public.game_participants
FOR EACH ROW EXECUTE FUNCTION public.enforce_host_block();
