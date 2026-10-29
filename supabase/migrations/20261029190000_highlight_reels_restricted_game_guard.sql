-- A reel linked to a game that is not public is not readable through the API by strangers.
--
-- A reel's title, caption and hashtags are written by its host and can name the game the reel is
-- linked to (game_id, game_title). The read policy "Anyone can view visible completed reels"
-- looks only at the reel (visible, completed, audience), so anyone who could see the reel could
-- read those columns straight from the table through the API, whatever the game was: youth,
-- mixed-age, unknown-age, private, hidden, cancelled or hidden by its organisation. The server
-- code that serves the public feed already hides that text; this closes the direct path.
--
-- Row level security cannot hide single columns, so the whole reel row is hidden. This adds a
-- RESTRICTIVE select policy (ANDed with every existing policy, so it can only narrow access).
-- A reel with a linked game is readable only if one of these holds:
--   * it has no linked game;
--   * the viewer owns the reel;
--   * the viewer is an admin (they could already read every reel);
--   * the game is public to everyone: not private, hidden, cancelled or organisation-hidden, and
--     an adult-only age range (public.game_age_range_is_adult_only, the rule anonymous reads of
--     hosted_games use);
--   * the viewer hosts the game or is on its roster.
-- A reel whose game no longer exists is treated as not public, so it stays with its owner.
--
-- Nothing else changes. Signed-in owners, admins, the game's host and players, and reels with no
-- game read exactly what they read before. Server code that reads with the service role bypasses
-- row level security and applies the same rule itself (highlight feed, public reel list and page).
--
-- Rolling back: dropping the policy widens reads of these reels again. Treat that as a decision,
-- not a routine undo; fix forward instead.

CREATE OR REPLACE FUNCTION private_sec.reel_game_readable(_game_id text, _owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE(
    _game_id IS NULL
    OR (auth.uid() IS NOT NULL AND auth.uid() = _owner)
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role = 'admin'
    )
    OR EXISTS (
      SELECT 1 FROM public.hosted_games g
      WHERE g.id = _game_id
        AND (
          (g.is_private = false
            AND g.hidden_at IS NULL
            AND g.org_hidden_at IS NULL
            AND g.cancelled_at IS NULL
            AND public.game_age_range_is_adult_only(g.min_age, g.max_age))
          OR (auth.uid() IS NOT NULL AND g.host_id = auth.uid())
        )
    )
    OR (auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.game_participants p
      WHERE p.game_id = _game_id AND p.user_id = auth.uid()
    )),
    false
  );
$$;

COMMENT ON FUNCTION private_sec.reel_game_readable(text, uuid) IS
  'True when the current viewer may read a reel linked to _game_id: no game, the owner, an admin, '
  'a game that is public to everyone, or the game''s host or a player. Missing game or unknown '
  'data is false. Used by the restrictive policy on highlight_reels.';

-- A policy runs this as the querying role, so those roles need EXECUTE (as for reel_publicly_visible).
REVOKE ALL ON FUNCTION private_sec.reel_game_readable(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.reel_game_readable(text, uuid)
  TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Reels of games that are not public are readable only by their circle"
  ON public.highlight_reels;
CREATE POLICY "Reels of games that are not public are readable only by their circle"
  ON public.highlight_reels
  AS RESTRICTIVE
  FOR SELECT
  TO anon, authenticated
  USING (private_sec.reel_game_readable(game_id, user_id));
