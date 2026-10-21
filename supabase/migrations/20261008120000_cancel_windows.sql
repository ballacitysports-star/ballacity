-- Cancellation windows.
--
-- Players can always cancel a game, tryout/camp or trainer session, but doing
-- it inside the host's cancellation cutoff (default: 2 hours before start)
-- is recorded as a late cancellation. Late cancellations count against the
-- player's reliability the same way a no-show does, and the host/trainer is
-- told it was late.
--
-- Recording happens here, in triggers on the rows a cancellation already
-- touches, so it can't be skipped by any client path.

-- 1) The cutoff, set per game / tryout post / trainer. 0 turns it off.
ALTER TABLE public.hosted_games
  ADD COLUMN IF NOT EXISTS cancel_cutoff_min integer NOT NULL DEFAULT 120;
ALTER TABLE public.team_posts
  ADD COLUMN IF NOT EXISTS cancel_cutoff_min integer NOT NULL DEFAULT 120;
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS cancel_cutoff_min integer NOT NULL DEFAULT 120;

DO $chk$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['hosted_games', 'team_posts', 'teams'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_cancel_cutoff_min_chk');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (cancel_cutoff_min BETWEEN 0 AND 10080)',
      t, t || '_cancel_cutoff_min_chk');
  END LOOP;
END
$chk$;

-- 2) The record of late cancellations.
CREATE TABLE IF NOT EXISTS public.late_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('game', 'tryout', 'session')),
  ref_id text NOT NULL,
  team_id text,
  owner_id uuid,
  title text,
  event_at timestamptz NOT NULL,
  cutoff_min integer NOT NULL,
  minutes_before integer NOT NULL,
  cancelled_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, ref_id)
);
CREATE INDEX IF NOT EXISTS late_cancellations_user_idx ON public.late_cancellations (user_id);

ALTER TABLE public.late_cancellations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.late_cancellations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.late_cancellations TO authenticated;
GRANT ALL ON public.late_cancellations TO service_role;

-- The player, their guardian, the host/trainer, and team staff can see it.
-- Nobody writes to it directly; only the triggers below do.
DROP POLICY IF EXISTS "Involved people can read late cancellations" ON public.late_cancellations;
CREATE POLICY "Involved people can read late cancellations"
  ON public.late_cancellations FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR owner_id = auth.uid()
    OR public.is_guardian_of(auth.uid(), user_id)
    OR (team_id IS NOT NULL AND public.is_team_manager(team_id, auth.uid()))
  );

-- Inserts a row when the cancellation falls inside the cutoff. Returns true
-- only for a new record, so callers notify once.
CREATE OR REPLACE FUNCTION public.record_late_cancellation(
  _user uuid, _kind text, _ref text, _team text, _owner uuid, _title text,
  _event_at timestamptz, _cutoff integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _cutoff IS NULL OR _cutoff <= 0 OR _event_at IS NULL THEN
    RETURN false;
  END IF;
  -- Before the window: an ordinary cancellation. After start: not a cancellation.
  IF now() >= _event_at OR now() < _event_at - make_interval(mins => _cutoff) THEN
    RETURN false;
  END IF;
  INSERT INTO public.late_cancellations
    (user_id, kind, ref_id, team_id, owner_id, title, event_at, cutoff_min, minutes_before, cancelled_by)
  VALUES
    (_user, _kind, _ref, _team, _owner, _title, _event_at, _cutoff,
     GREATEST(0, floor(extract(epoch FROM (_event_at - now())) / 60)::int), auth.uid())
  ON CONFLICT (user_id, kind, ref_id) DO NOTHING;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.record_late_cancellation(uuid, text, text, text, uuid, text, timestamptz, integer)
  FROM PUBLIC, anon, authenticated;

-- Shared copy for "N min / N hours" in notifications.
CREATE OR REPLACE FUNCTION public.minutes_phrase(_m integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _m IS NULL THEN ''
    WHEN _m < 60 THEN _m || ' min'
    WHEN _m % 60 = 0 THEN (_m / 60) || CASE WHEN _m = 60 THEN ' hour' ELSE ' hours' END
    ELSE (_m / 60) || 'h ' || (_m % 60) || 'm'
  END;
$$;

-- 3) Games: a player dropping their own spot (participant row or approved
-- request) inside the window. Host removals and automatic spot-hold releases
-- are not the player's doing and are skipped.
CREATE OR REPLACE FUNCTION public.track_late_game_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _g record;
  _who text;
  _mins integer;
BEGIN
  IF TG_TABLE_NAME = 'game_participants' THEN
    _uid := OLD.user_id;
  ELSE
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;
    _uid := OLD.player_id;
  END IF;

  IF auth.uid() IS NULL OR auth.uid() <> _uid THEN RETURN OLD; END IF;
  IF COALESCE(current_setting('ballacity.system_release', true), '') = 'on' THEN RETURN OLD; END IF;

  SELECT id, title, date, host_id, cancel_cutoff_min, cancelled_at, completed_at
    INTO _g FROM public.hosted_games WHERE id = OLD.game_id;
  IF _g.id IS NULL OR _g.cancelled_at IS NOT NULL OR _g.completed_at IS NOT NULL THEN
    RETURN OLD;
  END IF;

  IF public.record_late_cancellation(_uid, 'game', _g.id::text, NULL, _g.host_id, _g.title,
                                     _g.date, _g.cancel_cutoff_min)
     AND _g.host_id IS NOT NULL AND _g.host_id <> _uid THEN
    SELECT display_name INTO _who FROM public.profiles WHERE id = _uid;
    _mins := GREATEST(0, floor(extract(epoch FROM (_g.date - now())) / 60)::int);
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      _g.host_id,
      'participant_left_late',
      left(COALESCE(_who, 'A player') || ' cancelled late · ' || _g.title, 200),
      'Dropped ' || public.minutes_phrase(_mins) || ' before start (your cutoff is ' ||
        public.minutes_phrase(_g.cancel_cutoff_min) || '). Their spot is open again.',
      '/games/' || _g.id
    );
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.track_late_game_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_participants_late_cancel ON public.game_participants;
CREATE TRIGGER game_participants_late_cancel
  AFTER DELETE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.track_late_game_cancel();

DROP TRIGGER IF EXISTS join_requests_late_cancel ON public.join_requests;
CREATE TRIGGER join_requests_late_cancel
  AFTER DELETE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.track_late_game_cancel();

-- 4) Tryouts and camps: the attendee or their guardian cancelling a
-- registration. The team's notice is sent by the app, worded as late.
CREATE OR REPLACE FUNCTION public.track_late_tryout_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _p record;
BEGIN
  IF OLD.status <> 'registered' OR NEW.status <> 'cancelled' THEN RETURN NEW; END IF;
  IF auth.uid() IS NULL
     OR (auth.uid() <> NEW.user_id AND NOT public.is_guardian_of(auth.uid(), NEW.user_id)) THEN
    RETURN NEW;
  END IF;
  SELECT id, title, event_date, team_id, author_id, cancel_cutoff_min
    INTO _p FROM public.team_posts WHERE id = NEW.post_id;
  IF _p.id IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_late_cancellation(NEW.user_id, 'tryout', _p.id::text, _p.team_id,
                                          _p.author_id, _p.title, _p.event_date, _p.cancel_cutoff_min);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.track_late_tryout_cancel() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tryout_rsvps_late_cancel ON public.tryout_rsvps;
CREATE TRIGGER tryout_rsvps_late_cancel
  AFTER UPDATE ON public.tryout_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.track_late_tryout_cancel();

-- 5) Trainer sessions: replaces the notifier from 20261007160000 so it also
-- records late cancellations and says so in the trainer's notice. Session
-- times are wall-clock times in the trainer's time zone.
CREATE OR REPLACE FUNCTION public.notify_trainer_session_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _who text;
  _when text;
  _t record;
  _start timestamptz;
  _late boolean := false;
  _mins integer;
BEGIN
  IF OLD.status = 'accepted' AND NEW.status = 'cancelled' AND auth.uid() = OLD.from_user_id THEN
    SELECT display_name INTO _who FROM public.profiles WHERE id = OLD.from_user_id;
    SELECT timezone, cancel_cutoff_min INTO _t FROM public.teams WHERE id = OLD.trainer_id;

    IF OLD.preferred_date IS NOT NULL AND OLD.preferred_start_time IS NOT NULL THEN
      BEGIN
        _start := (OLD.preferred_date + OLD.preferred_start_time)
                  AT TIME ZONE COALESCE(NULLIF(_t.timezone, ''), 'America/New_York');
      EXCEPTION WHEN others THEN
        _start := NULL; -- unknown time zone name: don't block the cancel over it
      END;
      _late := public.record_late_cancellation(OLD.from_user_id, 'session', OLD.id::text,
                                               OLD.trainer_id, OLD.to_user_id,
                                               COALESCE(OLD.session_type, 'Session'),
                                               _start, _t.cancel_cutoff_min);
    END IF;

    _when := CASE
      WHEN OLD.preferred_date IS NOT NULL
        THEN to_char(OLD.preferred_date, 'Mon FMDD') ||
             CASE WHEN OLD.preferred_start_time IS NOT NULL
                  THEN ' at ' || to_char(OLD.preferred_start_time, 'FMHH12:MI AM') ELSE '' END
      ELSE NULL
    END;
    _mins := CASE WHEN _start IS NOT NULL
                  THEN GREATEST(0, floor(extract(epoch FROM (_start - now())) / 60)::int) END;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      OLD.to_user_id,
      CASE WHEN _late THEN 'trainer_session_cancelled_late' ELSE 'trainer_session_cancelled' END,
      left(COALESCE(_who, 'A player') ||
           CASE WHEN _late THEN ' cancelled their session late' ELSE ' cancelled their session' END, 200),
      COALESCE(OLD.session_type, 'Session') || COALESCE(' · ' || _when, '') ||
        CASE WHEN _late
             THEN '. Cancelled ' || public.minutes_phrase(_mins) || ' before start (your cutoff is ' ||
                  public.minutes_phrase(_t.cancel_cutoff_min) || '). '
             ELSE '. ' END ||
        'That time is open again.',
      '/trainers/' || OLD.trainer_id
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_trainer_session_cancelled() FROM PUBLIC, anon, authenticated;

-- 6) Spot-hold releases are automatic, not the player cancelling. Mark them
-- so the game trigger above skips them, even when the sweep runs from the
-- player's own open game page.
CREATE OR REPLACE FUNCTION public.release_expired_payment_holds(_game_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  _next uuid;
  _offered uuid[] := '{}';
  _released integer := 0;
BEGIN
  IF _game_id IS NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A game id is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('ballacity.system_release', 'on', true);

  FOR r IN
    SELECT jr.id, jr.game_id, jr.player_id, jr.host_id, g.title
      FROM public.join_requests jr
      JOIN public.game_payment_settings s ON s.game_id = jr.game_id
      JOIN public.hosted_games g ON g.id = jr.game_id
     WHERE jr.status = 'approved'
       AND (_game_id IS NULL OR jr.game_id = _game_id)
       AND jr.reviewed_at IS NOT NULL
       AND s.entry_fee > 0
       AND s.payment_hold_minutes IS NOT NULL
       AND jr.reviewed_at + make_interval(mins => s.payment_hold_minutes) <= now()
       AND now() < g.date
       AND g.cancelled_at IS NULL
       AND g.completed_at IS NULL
       AND COALESCE(g.status, '') NOT IN ('cancelled', 'completed', 'in_progress')
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_submissions ps
          WHERE ps.game_id = jr.game_id
            AND ps.player_id = jr.player_id
            AND ps.status IN ('pending', 'verified')
       )
     FOR UPDATE OF jr SKIP LOCKED
  LOOP
    UPDATE public.join_requests
       SET status = 'rejected',
           reviewer_notes = 'Payment window expired — your spot was released.',
           reviewed_at = now()
     WHERE id = r.id
       AND status = 'approved';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    DELETE FROM public.game_participants
     WHERE game_id = r.game_id
       AND user_id = r.player_id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.player_id,
      'payment_hold_expired',
      left('Spot released · ' || r.title, 200),
      'Your payment window ran out, so your spot was released. You can request to join again if spots are open.',
      '/games/' || r.game_id
    );

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.host_id,
      'payment_hold_expired',
      left('Unpaid spot released · ' || r.title, 200),
      'A player didn''t pay within the hold window, so their spot is open again.',
      '/games/' || r.game_id
    );

    _next := NULL;
    SELECT w.user_id INTO _next
      FROM public.game_position_waitlist w
     WHERE w.game_id = r.game_id
       AND w.status = 'waiting'
       AND w.user_id <> r.player_id
       AND NOT (w.user_id = ANY (_offered))
     ORDER BY w.created_at ASC
     LIMIT 1;
    IF _next IS NOT NULL THEN
      _offered := _offered || _next;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        _next,
        'waitlist_spot_open',
        left('A spot opened up · ' || r.title, 200),
        'You''re next on the waitlist. Grab it before someone else does.',
        '/games/' || r.game_id
      );
    END IF;

    _released := _released + 1;
  END LOOP;

  RETURN _released;
END;
$$;
REVOKE ALL ON FUNCTION public.release_expired_payment_holds(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_expired_payment_holds(text) TO authenticated, service_role;

-- 7) Reliability: late cancellations count as no-shows. Same signature and
-- output as before; only the no_shows column changes.
CREATE OR REPLACE FUNCTION public.player_activity_stats(_user uuid)
RETURNS TABLE(games_joined integer, games_attended integer, no_shows integer, games_completed integer,
              hosted_total integer, hosted_completed integer, hosted_cancelled integer, teams_count integer,
              review_count integer, review_avg numeric, verified_review_count integer,
              first_activity_at timestamp with time zone)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH parts AS (
    SELECT gp.attended, g.completed_at, g.cancelled_at, g.date, gp.created_at
    FROM public.game_participants gp
    JOIN public.hosted_games g ON g.id = gp.game_id
    WHERE gp.user_id = _user
  ),
  hosted AS (
    SELECT completed_at, cancelled_at, created_at FROM public.hosted_games WHERE host_id = _user
  ),
  revs AS (
    SELECT rating, verified FROM public.reviews
    WHERE reviewee_kind = 'player' AND reviewee_id = _user::text
      AND NOT flagged AND NOT is_private
  )
  SELECT
    (SELECT count(*) FROM parts WHERE cancelled_at IS NULL)::int,
    (SELECT count(*) FROM parts WHERE attended IS TRUE AND cancelled_at IS NULL)::int,
    ((SELECT count(*) FROM parts WHERE attended IS FALSE AND cancelled_at IS NULL)
      + (SELECT count(*) FROM public.late_cancellations WHERE user_id = _user))::int,
    (SELECT count(*) FROM parts WHERE cancelled_at IS NULL AND completed_at IS NOT NULL)::int,
    (SELECT count(*) FROM hosted)::int,
    (SELECT count(*) FROM hosted WHERE completed_at IS NOT NULL AND cancelled_at IS NULL)::int,
    (SELECT count(*) FROM hosted WHERE cancelled_at IS NOT NULL)::int,
    (SELECT count(*) FROM public.team_members WHERE user_id = _user)::int,
    (SELECT count(*) FROM revs)::int,
    (SELECT coalesce(avg(rating), 0) FROM revs),
    (SELECT count(*) FROM revs WHERE verified)::int,
    least(
      (SELECT min(created_at) FROM parts),
      (SELECT min(created_at) FROM hosted)
    );
$function$;
