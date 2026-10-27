-- Game joins: make the database enforce what the join screen already promises.
--
-- A player writes their own game_participants row (RLS: auth.uid() = user_id),
-- so the screen is not a boundary. Probing a replayed copy of the schema found
-- these gaps, each a plain INSERT away:
--
--   1. Two players taking the last spot at the same moment both got it: the
--      gate counted the roster without serialising joins to the game.
--   2. Host approval and payment were checked only by the screen. A player
--      could skip both for an approval-required or paid game, and a minor with
--      a guardian could skip the host and the guardian's per-request approval,
--      by inserting a roster row with no join request at all.
--   3. A game that ended days ago still took joins.
--   4. A guardian's "Can join games" switch was honoured only for under-13s,
--      and withdrawn consent only locked under-13s out of games, although the
--      Parent Center shows the switch for every child and teams, reels and the
--      client already treat withdrawn consent as a lock for every cohort that
--      needs it.
--   5. The host closing joining, or the signup cutoff passing, blocked a player
--      the host had already approved and who then paid: the money moved but the
--      roster add was refused. The screen says payment for approved players
--      "stays available"; the roster add now agrees.
--
-- The new rules apply to a player joining for themselves (auth.uid() = the
-- player). The server's own roster add after a verified payment runs as the
-- service role and is not made to prove what it has just verified.

-- ---------------------------------------------------------------------------
-- How long a game lasts, read the same way the app reads it ("90 min", "1.5 h",
-- "2 hours"; anything unreadable is 90 minutes). See parseDurationMin.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_duration_minutes(_duration text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v numeric;
BEGIN
  IF _duration IS NULL THEN RETURN 90; END IF;
  BEGIN
    v := substring(_duration from '[0-9]+(?:\.[0-9]+)?')::numeric;
  EXCEPTION WHEN others THEN
    v := NULL;
  END;
  IF v IS NULL OR v <= 0 THEN RETURN 90; END IF;
  IF _duration ~* 'h' THEN v := v * 60; END IF;
  -- A game longer than two weeks is a typo, and an interval that large is not
  -- worth overflowing over.
  RETURN LEAST(round(v), 20160)::integer;
END;
$$;

-- ---------------------------------------------------------------------------
-- Can this account take part in games at all?
--
--   * Consent: a cohort that needs a parent's consent (under 13, and 13-15
--     under the current age policy) is locked out of games while consent is
--     withdrawn or missing. Before, only under-13s were.
--   * The guardian's "Can join games" switch: under 13 it defaults to off (a
--     guardian turns it on); for a minor with an active guardian link it
--     defaults to on and is honoured when the guardian turns it off.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.child_game_participation_allowed(_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.child_features_locked(_user) THEN false
    WHEN public.age_cohort_of(_user) = 'child_under_13' THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), false)
    WHEN public.is_minor(_user)
         AND EXISTS (SELECT 1 FROM public.guardian_links gl
                      WHERE gl.child_user_id = _user AND gl.status = 'active') THEN
      COALESCE((SELECT game_participation FROM public.child_controls WHERE child_user_id = _user), true)
    ELSE true
  END;
$$;

-- ---------------------------------------------------------------------------
-- The join gate.
-- ---------------------------------------------------------------------------
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
  _self boolean;
  _approved boolean;
  _requires_approval boolean;
  _fee numeric;
  _ends timestamptz;
BEGIN
  -- Lock the game while its roster is checked, so two joins for the last spot
  -- queue up instead of both counting an empty seat. NO KEY UPDATE does not
  -- conflict with the key-share lock the roster row's foreign key takes, so it
  -- cannot deadlock against other writes that reference the game.
  SELECT id, host_id, status, cancelled_at, completed_at, joins_closed,
         signup_cutoff_min, max_players, date, ends_at, duration, price
    INTO g
  FROM public.hosted_games WHERE id = NEW.game_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  _is_host := (g.host_id = auth.uid()) OR (g.host_id = NEW.user_id);
  _self := auth.uid() IS NOT NULL AND auth.uid() = NEW.user_id;

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

  -- Over by the clock, whether or not anyone marked it completed.
  IF _self THEN
    _ends := CASE
      WHEN g.ends_at IS NOT NULL AND g.ends_at > g.date THEN g.ends_at
      ELSE g.date + make_interval(mins => public.game_duration_minutes(g.duration))
    END;
    IF now() >= _ends THEN
      RAISE EXCEPTION 'GAME_COMPLETED: this game has already ended.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.join_requests jr
     WHERE jr.game_id = NEW.game_id
       AND jr.player_id = NEW.user_id
       AND jr.status = 'approved'
  ) INTO _approved;

  -- Closing joining, or the signup cutoff, stops new players. A player the host
  -- has already approved keeps their place in line to pay and be rostered.
  IF NOT _approved THEN
    IF g.joins_closed THEN
      RAISE EXCEPTION 'GAME_JOINS_CLOSED: the host has closed joining for this game.'
        USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(g.signup_cutoff_min, 0) > 0
       AND now() >= g.date - make_interval(mins => g.signup_cutoff_min) THEN
      RAISE EXCEPTION 'GAME_SIGNUP_CLOSED: signups closed before start time.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- What the join screen requires of a player joining for themselves. With no
  -- settings row the screen treats the game as request-to-join, so this does.
  IF _self THEN
    SELECT s.requires_approval, s.entry_fee
      INTO _requires_approval, _fee
    FROM public.game_payment_settings s
    WHERE s.game_id = NEW.game_id
    ORDER BY s.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      _requires_approval := true;
      _fee := g.price;
    END IF;

    IF COALESCE(_requires_approval, true) AND NOT _approved THEN
      RAISE EXCEPTION 'GAME_APPROVAL_REQUIRED: the host has to approve your request to join first.'
        USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(_fee, 0) > 0 AND NOT EXISTS (
      SELECT 1 FROM public.payment_submissions ps
       WHERE ps.game_id = NEW.game_id
         AND ps.player_id = NEW.user_id
         AND ps.status = 'verified'
    ) THEN
      RAISE EXCEPTION 'GAME_PAYMENT_REQUIRED: the entry fee has to be confirmed by the host first.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COUNT(*) INTO _count FROM public.game_participants WHERE game_id = NEW.game_id;
  IF _count >= GREATEST(g.max_players, 1) THEN
    RAISE EXCEPTION 'GAME_FULL: the roster is full.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;
