-- WP 5.6 (docs/product/phase-5-validation-plan.md): prompt hosts to mark attendance.
--
-- The 5-minute sweep (src/lib/game-reminders.server.ts, promptHostsForAttendance) sends a game's host one in-app notice
-- ('game_attendance_prompt') and a push 2 hours after the game ends, when the game is not cancelled, has at least one
-- participant other than the host, and nobody's attendance is marked yet. The notice links to the Attendance block on the
-- game page (/games/<id>?tab=overview#attendance). This column is how it sends the prompt once per game (each game of a
-- series is its own row, so each is prompted once):
--
--   hosted_games.attendance_prompted_at  NULL: no prompt yet. Set: when the sweep sent the prompt. public.send_attendance_prompt
--                                        (below) stamps the game (UPDATE ... WHERE attendance_prompted_at IS NULL, so two
--                                        runs at once never both send it) and writes the notice in one transaction: if
--                                        the notice cannot be written nothing is stamped, and the next run retries.
--
-- Server only, by the rule of 20261129100000 (notifications.push_sent_at): no request carrying a member's identity may set,
-- change or clear it, on insert or update, directly or through a SECURITY DEFINER function; the sweep runs as the service
-- role and passes. A host could otherwise silence or replay their own prompt. The existing hosted_games policies, grants and
-- triggers are unchanged: the sweep calls public.send_attendance_prompt as the service role, where auth.uid() is NULL, so
-- the hosting, facility and hide guards let its update through as they do any server write (touch_updated_at still stamps
-- updated_at).
--
-- notifications.type has no CHECK constraint (checked in the replayed schema), so the new type needs no schema change.
-- Additive: one nullable column, one trigger function, one trigger, one server-only function. Rollback: docs/rollbacks/
-- 20261129110000_attendance_prompt.down.sql, after the sweep code that writes the column is reverted.

-- Locks: ALTER TABLE ... ADD COLUMN and CREATE TRIGGER take a short exclusive lock on the table; the wait for it is limited
-- to 5 s so a long-running transaction cannot queue every reader behind this migration. On a timeout, retry.
SET lock_timeout = '5s';

ALTER TABLE public.hosted_games ADD COLUMN attendance_prompted_at timestamptz;

COMMENT ON COLUMN public.hosted_games.attendance_prompted_at IS
  'WP 5.6: when the 5-minute sweep sent the host the "mark attendance" prompt for this game. NULL: not sent. Server only.';

CREATE FUNCTION private_sec.guard_hosted_game_attendance_prompted_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.attendance_prompted_at IS NOT NULL THEN
      RAISE EXCEPTION 'ATTENDANCE_PROMPT_SERVER_ONLY: only the server records the attendance prompt.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.attendance_prompted_at IS DISTINCT FROM OLD.attendance_prompted_at THEN
    RAISE EXCEPTION 'ATTENDANCE_PROMPT_SERVER_ONLY: only the server records the attendance prompt.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.guard_hosted_game_attendance_prompted_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER hosted_games_attendance_prompted_at_server_only
BEFORE INSERT OR UPDATE OF attendance_prompted_at ON public.hosted_games
FOR EACH ROW EXECUTE FUNCTION private_sec.guard_hosted_game_attendance_prompted_at();

-- The prompt itself: the claim and the notice in one transaction, so a run that is cut off (pg_net stops waiting after 5
-- seconds and the Worker's remaining work is cancelled) can never leave a game stamped with no notice. It stamps the game
-- only if it is still unprompted, not cancelled, has a participant other than its host and nobody's attendance is marked
-- (checked again here, so a host who marks attendance while the sweep runs gets no prompt), then writes the notice to the
-- game's host (hosted_games.host_id, the one person host_mark_attendance lets mark it besides moderators) and returns its
-- id. NULL: nothing was sent. The words come from the sweep (attendancePromptText: the game's title, never a player's
-- name). Server code only: the service role calls it; no member or visitor may.
CREATE FUNCTION public.send_attendance_prompt(_game text, _title text, _body text, _link text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _host uuid;
  _id   uuid;
BEGIN
  UPDATE public.hosted_games g
     SET attendance_prompted_at = now()
   WHERE g.id = _game
     AND g.attendance_prompted_at IS NULL
     AND g.cancelled_at IS NULL
     AND COALESCE(g.status, '') <> 'cancelled'
     AND g.host_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.game_participants p WHERE p.game_id = g.id AND p.user_id <> g.host_id)
     AND NOT EXISTS (SELECT 1 FROM public.game_participants p
                      WHERE p.game_id = g.id AND (p.attended IS NOT NULL OR p.attendance_marked_at IS NOT NULL))
  RETURNING g.host_id INTO _host;
  IF _host IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_host, 'game_attendance_prompt', _title, _body, _link)
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.send_attendance_prompt(text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_attendance_prompt(text, text, text, text) TO service_role;
COMMENT ON FUNCTION public.send_attendance_prompt(text, text, text, text) IS
  'Server code only (WP 5.6): stamps hosted_games.attendance_prompted_at and writes the host''s attendance prompt in one transaction; NULL when the game is no longer due.';

RESET lock_timeout;
