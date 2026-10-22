-- Let owners hide their own listings from the public, without touching the
-- moderators' Hide.
--
-- Covered: hosted games, team posts, teams, trainer profiles (teams of kind
-- 'coach') and gym listings (trainer_orgs).
--
-- Until now each table had one `hidden_at`, set only by moderators (server
-- code), and the app reads `hidden_at IS NULL` to decide what is public. Two
-- reasons for two new sources instead of letting owners write it:
--   * a moderator's Hide must hold: an owner must not be able to clear it, or
--     mistake "I hid it" for "BallaCity hid it";
--   * a moderator unhiding must not reveal something its owner hid.
--
-- So each table gets `moderator_hidden_at` (the moderators' Hide) and
-- `owner_hidden_at` (the owner's), and `hidden_at` stays the one effective value
-- every existing query and policy already reads, kept in step by a trigger:
--   hidden_at = COALESCE(moderator_hidden_at, owner_hidden_at)
-- Server code that writes `hidden_at` directly (the Moderation tab, service
-- role) keeps working: such a write is recorded as the moderator's Hide.
--
-- Who may write what:
--   * a signed-in person who is not a moderator cannot change `hidden_at` or
--     `moderator_hidden_at`, and changes `owner_hidden_at` only through
--     `set_listing_hidden`, which re-checks that they own or manage the listing;
--   * moderators and server code (auth.uid() IS NULL) may write any of them.
--
-- Who still sees a hidden listing:
--   * games: the host always; players and requesters when only the host hid it;
--   * teams: managers always; members when only the owner hid it (and their
--     roster rows stay readable to them);
--   * trainer profiles: as teams;
--   * gyms: the existing rule (owner, admins, members, moderators);
--   * team posts: the author and the team's managers (the existing gate).
-- Everyone else, signed in or not, stops seeing it, in the database.

-- ---- columns ---------------------------------------------------------------

ALTER TABLE public.hosted_games  ADD COLUMN IF NOT EXISTS owner_hidden_at timestamptz,
                                  ADD COLUMN IF NOT EXISTS moderator_hidden_at timestamptz;
ALTER TABLE public.team_posts    ADD COLUMN IF NOT EXISTS owner_hidden_at timestamptz,
                                  ADD COLUMN IF NOT EXISTS moderator_hidden_at timestamptz;
ALTER TABLE public.teams         ADD COLUMN IF NOT EXISTS owner_hidden_at timestamptz,
                                  ADD COLUMN IF NOT EXISTS moderator_hidden_at timestamptz;
ALTER TABLE public.trainer_orgs  ADD COLUMN IF NOT EXISTS owner_hidden_at timestamptz,
                                  ADD COLUMN IF NOT EXISTS moderator_hidden_at timestamptz;

-- Everything hidden so far was hidden by a moderator.
UPDATE public.hosted_games SET moderator_hidden_at = hidden_at WHERE hidden_at IS NOT NULL AND moderator_hidden_at IS NULL;
UPDATE public.team_posts   SET moderator_hidden_at = hidden_at WHERE hidden_at IS NOT NULL AND moderator_hidden_at IS NULL;
UPDATE public.teams        SET moderator_hidden_at = hidden_at WHERE hidden_at IS NOT NULL AND moderator_hidden_at IS NULL;
UPDATE public.trainer_orgs SET moderator_hidden_at = hidden_at WHERE hidden_at IS NOT NULL AND moderator_hidden_at IS NULL;

-- ---- keep `hidden_at` in step, and guard who writes what -------------------

CREATE OR REPLACE FUNCTION public.sync_listing_hidden()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _privileged boolean := auth.uid() IS NULL OR public.is_moderator(auth.uid());
  _via_rpc boolean := COALESCE(current_setting('app.listing_hide_rpc', true), '') = 'on';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT _privileged THEN
      NEW.hidden_at := NULL;
      NEW.moderator_hidden_at := NULL;
      NEW.owner_hidden_at := NULL;
    ELSIF NEW.hidden_at IS NOT NULL AND NEW.moderator_hidden_at IS NULL AND NEW.owner_hidden_at IS NULL THEN
      NEW.moderator_hidden_at := NEW.hidden_at;
    END IF;
  ELSE
    IF NEW.hidden_at IS DISTINCT FROM OLD.hidden_at
       OR NEW.moderator_hidden_at IS DISTINCT FROM OLD.moderator_hidden_at THEN
      IF NOT _privileged THEN
        RAISE EXCEPTION 'LISTING_HIDDEN_MODERATOR_ONLY' USING ERRCODE = '42501';
      END IF;
      -- A plain write of `hidden_at` by server code is the moderator's Hide or Unhide.
      IF NEW.moderator_hidden_at IS NOT DISTINCT FROM OLD.moderator_hidden_at THEN
        NEW.moderator_hidden_at := NEW.hidden_at;
      END IF;
    END IF;
    IF NEW.owner_hidden_at IS DISTINCT FROM OLD.owner_hidden_at AND NOT (_privileged OR _via_rpc) THEN
      RAISE EXCEPTION 'LISTING_HIDE_RPC_ONLY' USING ERRCODE = '42501';
    END IF;
  END IF;
  NEW.hidden_at := COALESCE(NEW.moderator_hidden_at, NEW.owner_hidden_at);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_listing_hidden() FROM PUBLIC, anon, authenticated;

-- Named to sort last: team_posts has an older guard (enforce_post_text_moderation)
-- that pins `hidden_at` for signed-in writers and must run first.
DROP TRIGGER IF EXISTS zz_sync_listing_hidden ON public.hosted_games;
CREATE TRIGGER zz_sync_listing_hidden BEFORE INSERT OR UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.sync_listing_hidden();
DROP TRIGGER IF EXISTS zz_sync_listing_hidden ON public.team_posts;
CREATE TRIGGER zz_sync_listing_hidden BEFORE INSERT OR UPDATE ON public.team_posts
  FOR EACH ROW EXECUTE FUNCTION public.sync_listing_hidden();
DROP TRIGGER IF EXISTS zz_sync_listing_hidden ON public.teams;
CREATE TRIGGER zz_sync_listing_hidden BEFORE INSERT OR UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.sync_listing_hidden();
DROP TRIGGER IF EXISTS zz_sync_listing_hidden ON public.trainer_orgs;
CREATE TRIGGER zz_sync_listing_hidden BEFORE INSERT OR UPDATE ON public.trainer_orgs
  FOR EACH ROW EXECUTE FUNCTION public.sync_listing_hidden();

-- ---- the one way an owner hides or shows -----------------------------------

CREATE OR REPLACE FUNCTION public.set_listing_hidden(_kind text, _id text, _hidden boolean)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _ts timestamptz := CASE WHEN _hidden THEN now() ELSE NULL END;
  _effective timestamptz;
  _rows integer := 0;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('app.listing_hide_rpc', 'on', true);

  IF _kind = 'game' THEN
    UPDATE public.hosted_games SET owner_hidden_at = _ts
     WHERE id = _id AND host_id = _me
    RETURNING hidden_at INTO _effective;
  ELSIF _kind = 'post' THEN
    UPDATE public.team_posts SET owner_hidden_at = _ts
     WHERE id = _id::uuid AND (author_id = _me OR public.is_team_manager(team_id, _me))
    RETURNING hidden_at INTO _effective;
  ELSIF _kind = 'team' THEN
    UPDATE public.teams SET owner_hidden_at = _ts
     WHERE id = _id AND kind = 'team' AND (owner_id = _me OR public.is_team_manager(id, _me))
    RETURNING hidden_at INTO _effective;
  ELSIF _kind = 'trainer' THEN
    UPDATE public.teams SET owner_hidden_at = _ts
     WHERE id = _id AND kind = 'coach' AND owner_id = _me
    RETURNING hidden_at INTO _effective;
  ELSIF _kind = 'gym' THEN
    UPDATE public.trainer_orgs SET owner_hidden_at = _ts
     WHERE id = _id::uuid AND (owner_id = _me OR public.is_trainer_org_admin(id, _me))
    RETURNING hidden_at INTO _effective;
  ELSE
    RAISE EXCEPTION 'UNKNOWN_LISTING_KIND' USING ERRCODE = '22023';
  END IF;

  GET DIAGNOSTICS _rows = ROW_COUNT;
  -- The flag is only for the update above; nothing later in this transaction may reuse it.
  PERFORM set_config('app.listing_hide_rpc', 'off', true);
  IF _rows = 0 THEN
    -- One answer for "not there" and "not yours", so a stranger learns nothing.
    RAISE EXCEPTION 'LISTING_NOT_FOUND' USING ERRCODE = '42501';
  END IF;
  RETURN _effective;
END;
$$;

REVOKE ALL ON FUNCTION public.set_listing_hidden(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_listing_hidden(text, text, boolean) TO authenticated;

-- ---- who can still see a hidden listing ------------------------------------

-- Games. The public read used to look only at `is_private`; hiding was enforced
-- only in the app's list queries. Now the database holds it too.
DROP POLICY IF EXISTS "Public games are viewable by everyone" ON public.hosted_games;
CREATE POLICY "Public games are viewable by everyone"
  ON public.hosted_games FOR SELECT
  USING (is_private = false AND hidden_at IS NULL);

DROP POLICY IF EXISTS "Hidden public games viewable by host and players" ON public.hosted_games;
CREATE POLICY "Hidden public games viewable by host and players"
  ON public.hosted_games FOR SELECT TO authenticated
  USING (
    is_private = false
    AND hidden_at IS NOT NULL
    AND (
      host_id = auth.uid()
      OR (
        moderator_hidden_at IS NULL
        AND (
          public.is_game_participant(id, auth.uid())
          OR EXISTS (
            SELECT 1 FROM public.join_requests jr
            WHERE jr.game_id = hosted_games.id AND jr.player_id = auth.uid()
          )
        )
      )
    )
  );

-- Teams (and trainer profiles): members still see a team its owner hid.
DROP POLICY IF EXISTS "teams_read_signed_in" ON public.teams;
CREATE POLICY "teams_read_signed_in"
  ON public.teams FOR SELECT TO authenticated
  USING (
    hidden_at IS NULL
    OR private_sec.viewer_manages_team(id)
    OR (moderator_hidden_at IS NULL AND public.is_team_member(id, auth.uid()))
  );

-- A hidden team's roster stays readable to the people on it.
DROP POLICY IF EXISTS "team_members_read" ON public.team_members;
CREATE POLICY "team_members_read"
  ON public.team_members FOR SELECT TO anon, authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.id = team_members.team_id
        AND (
          t.hidden_at IS NULL
          OR private_sec.viewer_manages_team(t.id)
          OR (t.moderator_hidden_at IS NULL AND public.is_team_member(t.id, auth.uid()))
        )
    )
    AND private_sec.roster_row_visible(team_id, user_id)
  );
