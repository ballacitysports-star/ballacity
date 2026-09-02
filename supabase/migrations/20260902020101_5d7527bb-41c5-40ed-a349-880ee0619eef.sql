-- 1. Lifecycle columns
ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

ALTER TABLE public.game_participants
  ADD COLUMN IF NOT EXISTS attended boolean,
  ADD COLUMN IF NOT EXISTS attendance_marked_at timestamptz,
  ADD COLUMN IF NOT EXISTS attendance_marked_by uuid;

-- 2. Server-side join gate (cancelled / completed / closed / cutoff / capacity)
CREATE OR REPLACE FUNCTION public.enforce_game_join_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  _count int;
  _is_host boolean;
BEGIN
  SELECT id, host_id, status, cancelled_at, completed_at, joins_closed,
         signup_cutoff_min, max_players, date
    INTO g
  FROM public.hosted_games WHERE id = NEW.game_id;

  IF g IS NULL THEN
    RETURN NEW;
  END IF;

  _is_host := (g.host_id = auth.uid()) OR (g.host_id = NEW.user_id);

  IF g.cancelled_at IS NOT NULL OR g.status = 'cancelled' THEN
    RAISE EXCEPTION 'GAME_CANCELLED: this game was cancelled by the host.'
      USING ERRCODE = 'P0001';
  END IF;

  IF g.completed_at IS NOT NULL OR g.status = 'completed' THEN
    RAISE EXCEPTION 'GAME_COMPLETED: this game has already ended.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Host roster management bypasses the soft gates below.
  IF _is_host OR public.is_moderator(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF g.joins_closed THEN
    RAISE EXCEPTION 'GAME_JOINS_CLOSED: the host has closed joining for this game.'
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(g.signup_cutoff_min, 0) > 0
     AND now() >= g.date - make_interval(mins => g.signup_cutoff_min) THEN
    RAISE EXCEPTION 'GAME_SIGNUP_CLOSED: signups closed before start time.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO _count FROM public.game_participants WHERE game_id = NEW.game_id;
  IF _count >= GREATEST(g.max_players, 1) THEN
    RAISE EXCEPTION 'GAME_FULL: the roster is full.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enforce_game_join_gate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_game_join_gate ON public.game_participants;
CREATE TRIGGER trg_enforce_game_join_gate
  BEFORE INSERT ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_game_join_gate();

-- 3. Attendance may only be changed by the host or a moderator, and only from start time.
CREATE OR REPLACE FUNCTION public.guard_participant_attendance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
BEGIN
  IF NEW.attended IS NOT DISTINCT FROM OLD.attended THEN
    RETURN NEW;
  END IF;

  SELECT host_id, date, cancelled_at INTO g
  FROM public.hosted_games WHERE id = NEW.game_id;

  IF g IS NULL THEN
    RETURN NEW;
  END IF;

  IF g.host_id <> auth.uid() AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'ATTENDANCE_FORBIDDEN: only the host can mark attendance.'
      USING ERRCODE = 'P0001';
  END IF;

  IF g.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'ATTENDANCE_CANCELLED: this game was cancelled.'
      USING ERRCODE = 'P0001';
  END IF;

  IF now() < g.date THEN
    RAISE EXCEPTION 'ATTENDANCE_TOO_EARLY: attendance opens when the game starts.'
      USING ERRCODE = 'P0001';
  END IF;

  NEW.attendance_marked_at := now();
  NEW.attendance_marked_by := auth.uid();
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.guard_participant_attendance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_participant_attendance ON public.game_participants;
CREATE TRIGGER trg_guard_participant_attendance
  BEFORE UPDATE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.guard_participant_attendance();

-- 4. Host actions
CREATE OR REPLACE FUNCTION public.host_cancel_game(_game_id text, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  p record;
BEGIN
  SELECT id, host_id, title, cancelled_at INTO g
  FROM public.hosted_games WHERE id = _game_id;

  IF g IS NULL THEN
    RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001';
  END IF;
  IF g.host_id <> auth.uid() AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Only the host can cancel this game.' USING ERRCODE = 'P0001';
  END IF;
  IF g.cancelled_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.hosted_games
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = NULLIF(btrim(COALESCE(_reason, '')), ''),
        joins_closed = true,
        updated_at = now()
  WHERE id = _game_id;

  FOR p IN
    SELECT user_id FROM public.game_participants
    WHERE game_id = _game_id AND user_id <> g.host_id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      p.user_id, 'game_cancelled',
      g.title || ' was cancelled',
      COALESCE(NULLIF(btrim(COALESCE(_reason, '')), ''), 'The host cancelled this game.'),
      '/games/' || _game_id
    );
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.host_cancel_game(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_cancel_game(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_complete_game(_game_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE g record;
BEGIN
  SELECT host_id, date, cancelled_at, completed_at INTO g
  FROM public.hosted_games WHERE id = _game_id;

  IF g IS NULL THEN
    RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001';
  END IF;
  IF g.host_id <> auth.uid() AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Only the host can complete this game.' USING ERRCODE = 'P0001';
  END IF;
  IF g.cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'This game was cancelled.' USING ERRCODE = 'P0001';
  END IF;
  IF now() < g.date THEN
    RAISE EXCEPTION 'You can mark a game complete once it has started.' USING ERRCODE = 'P0001';
  END IF;
  IF g.completed_at IS NOT NULL THEN
    RETURN;
  END IF;

  UPDATE public.hosted_games
    SET status = 'completed', completed_at = now(), joins_closed = true, updated_at = now()
  WHERE id = _game_id;
END $$;

REVOKE ALL ON FUNCTION public.host_complete_game(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_complete_game(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.host_mark_attendance(_game_id text, _user_id uuid, _attended boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _host uuid;
BEGIN
  SELECT host_id INTO _host FROM public.hosted_games WHERE id = _game_id;
  IF _host IS NULL THEN
    RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001';
  END IF;
  IF _host <> auth.uid() AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Only the host can mark attendance.' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.game_participants
    SET attended = _attended,
        attendance_marked_at = now(),
        attendance_marked_by = auth.uid()
  WHERE game_id = _game_id AND user_id = _user_id;
END $$;

REVOKE ALL ON FUNCTION public.host_mark_attendance(text, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_mark_attendance(text, uuid, boolean) TO authenticated;

-- 5. Host attendance rate for the trust panel
CREATE OR REPLACE FUNCTION public.host_attendance_stats(_host uuid)
RETURNS TABLE(marked bigint, attended bigint, cancelled_games bigint, completed_games bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS NOT NULL),
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS TRUE),
    (SELECT COUNT(*) FROM public.hosted_games WHERE host_id = _host AND cancelled_at IS NOT NULL),
    (SELECT COUNT(*) FROM public.hosted_games WHERE host_id = _host AND completed_at IS NOT NULL)
$$;

REVOKE ALL ON FUNCTION public.host_attendance_stats(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.host_attendance_stats(uuid) TO authenticated;
