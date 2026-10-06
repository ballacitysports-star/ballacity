-- ============================================================
-- Auto-waitlist promotion + late-drop (flake) tracking
-- ============================================================

-- 1. Waitlist offers --------------------------------------------------------
-- A paid / approval-required run offers the freed spot to the next player for
-- a 30 minute claim window instead of auto-joining them.
ALTER TABLE public.game_position_waitlist
  ADD COLUMN IF NOT EXISTS offered_at timestamptz,
  ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

ALTER TABLE public.game_position_waitlist
  DROP CONSTRAINT IF EXISTS game_position_waitlist_status_check;
ALTER TABLE public.game_position_waitlist
  ADD CONSTRAINT game_position_waitlist_status_check
  CHECK (status IN ('waiting', 'approved', 'declined', 'offered', 'expired'));

CREATE INDEX IF NOT EXISTS idx_game_position_waitlist_offers
  ON public.game_position_waitlist (game_id, status, offer_expires_at);

-- An offer holds its spot while the claim window is open, or while the player's
-- payment is waiting on the host (so a slow host never strands a paid player).
CREATE OR REPLACE FUNCTION public.waitlist_offer_is_live(
  _status text, _expires timestamptz, _offered_at timestamptz, _game_id text, _user_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _status = 'offered' AND (
    (_expires IS NOT NULL AND _expires > now())
    OR EXISTS (
      SELECT 1 FROM public.payment_submissions ps
      WHERE ps.game_id = _game_id
        AND ps.player_id = _user_id
        AND ps.status IN ('pending', 'verified')
        AND ps.submitted_at >= COALESCE(_offered_at, '-infinity'::timestamptz)
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.waitlist_reserved_count(_game_id text, _exclude_user uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT count(*)::int
  FROM public.game_position_waitlist wl
  WHERE wl.game_id = _game_id
    AND wl.status = 'offered'
    AND (_exclude_user IS NULL OR wl.user_id <> _exclude_user)
    AND public.waitlist_offer_is_live(wl.status, wl.offer_expires_at, wl.offered_at, wl.game_id, wl.user_id);
$$;

REVOKE ALL ON FUNCTION public.waitlist_offer_is_live(text, timestamptz, timestamptz, text, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.waitlist_reserved_count(text, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Join gate: live offers reserve capacity; promotion may fill after cutoff --
-- Promotion functions below set app.waitlist_promotion for their own
-- transaction only. It relaxes the sign-up cutoff (a waitlisted player is not a
-- new sign-up, and filling late drop-outs is the point) and nothing else.
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
  _promotion boolean := COALESCE(current_setting('app.waitlist_promotion', true), '') = 'on';
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

  IF NOT _promotion
     AND COALESCE(g.signup_cutoff_min, 0) > 0
     AND now() >= g.date - make_interval(mins => g.signup_cutoff_min) THEN
    RAISE EXCEPTION 'GAME_SIGNUP_CLOSED: signups closed before start time.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COUNT(*) INTO _count FROM public.game_participants WHERE game_id = NEW.game_id;
  -- Spots offered to other waitlisted players are held for them.
  _count := _count + public.waitlist_reserved_count(NEW.game_id, NEW.user_id);
  IF _count >= GREATEST(g.max_players, 1) THEN
    RAISE EXCEPTION 'GAME_FULL: the roster is full.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enforce_game_join_gate() FROM PUBLIC, anon, authenticated;

-- 3. Join requests: allow the promotion functions to record an approval -------
CREATE OR REPLACE FUNCTION public.validate_join_request()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _expected_host uuid;
  _g record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A claimed waitlist offer stands in for host approval. Only the
    -- claim_waitlist_offer function sets this, for its own transaction.
    IF COALESCE(current_setting('app.waitlist_promotion', true), '') = 'on' THEN
      NEW.status := 'approved';
      NEW.reviewed_at := now();
      NEW.reviewer_notes := 'Approved from a waitlist offer.';
      RETURN NEW;
    END IF;

    NEW.status := 'pending';
    NEW.reviewer_notes := NULL;
    NEW.reviewed_at := NULL;

    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'Must be signed in to request to join.' USING ERRCODE = '28000';
    END IF;
    IF NEW.player_id <> auth.uid() THEN
      RAISE EXCEPTION 'Cannot create a join request for another player.' USING ERRCODE = '42501';
    END IF;
    IF NEW.player_id = NEW.host_id THEN
      RAISE EXCEPTION 'Hosts cannot request to join their own game.';
    END IF;

    SELECT host_id INTO _expected_host
    FROM public.game_payment_settings
    WHERE game_id = NEW.game_id
    LIMIT 1;
    IF _expected_host IS NOT NULL AND _expected_host <> NEW.host_id THEN
      RAISE EXCEPTION 'host_id does not match the game host.' USING ERRCODE = '42501';
    END IF;

    -- Signup window enforcement (only for real hosted games).
    SELECT date, status, joins_closed, signup_cutoff_min
      INTO _g
      FROM public.hosted_games
     WHERE id = NEW.game_id
     LIMIT 1;
    IF _g IS NOT NULL THEN
      IF _g.status = 'completed' THEN
        RAISE EXCEPTION 'This game has ended.';
      END IF;
      IF _g.status = 'in_progress' OR now() >= _g.date THEN
        RAISE EXCEPTION 'This game has already started.';
      END IF;
      IF _g.joins_closed THEN
        RAISE EXCEPTION 'The host has closed joining for this game.';
      END IF;
      IF coalesce(_g.signup_cutoff_min, 0) > 0
         AND now() >= _g.date - make_interval(mins => _g.signup_cutoff_min) THEN
        RAISE EXCEPTION 'Signups are closed for this game.';
      END IF;
    END IF;

    IF NEW.message IS NOT NULL AND length(NEW.message) > 500 THEN
      RAISE EXCEPTION 'Message too long (max 500 characters).';
    END IF;

    IF NEW.idempotency_key IS NULL OR length(NEW.idempotency_key) = 0 THEN
      RAISE EXCEPTION 'idempotency_key is required.';
    END IF;
    IF length(NEW.idempotency_key) > 200 THEN
      RAISE EXCEPTION 'idempotency_key too long (max 200 characters).';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.player_id <> OLD.player_id
       OR NEW.host_id   <> OLD.host_id
       OR NEW.game_id   <> OLD.game_id
       OR NEW.idempotency_key <> OLD.idempotency_key THEN
      RAISE EXCEPTION 'player_id, host_id, game_id, and idempotency_key are immutable.' USING ERRCODE = '42501';
    END IF;
    IF NEW.status NOT IN ('pending','approved','rejected') THEN
      RAISE EXCEPTION 'Invalid status: %', NEW.status;
    END IF;
    IF NEW.reviewer_notes IS NOT NULL AND length(NEW.reviewer_notes) > 1000 THEN
      RAISE EXCEPTION 'Reviewer notes too long (max 1000 characters).';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Joining the roster clears the player's waitlist entries ------------------
CREATE OR REPLACE FUNCTION public.clear_waitlist_on_join()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.game_position_waitlist
  WHERE game_id = NEW.game_id AND user_id = NEW.user_id;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.clear_waitlist_on_join() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clear_waitlist_on_join ON public.game_participants;
CREATE TRIGGER trg_clear_waitlist_on_join
  AFTER INSERT ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.clear_waitlist_on_join();

-- 5. Promotion ----------------------------------------------------------------
-- Fills every open spot from the waitlist, oldest request first. Free / open
-- runs auto-join the player; paid or approval-required runs offer the spot for
-- 30 minutes. Stale offers are released first so the spot cascades to the next
-- player. Idempotent and serialised per game (the game row is locked), so it is
-- safe to call after every roster change and as a periodic sweep.
--
-- Returns a jsonb array of {entryId, userId, outcome, position, expiresAt,
-- gameTitle} where outcome is promoted | offered | expired | declined, so the
-- caller can notify. service_role only.
CREATE OR REPLACE FUNCTION public.promote_next_waitlist_player(_game_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  s record;
  w record;
  _fee numeric;
  _needs_approval boolean;
  _free int;
  _results jsonb := '[]'::jsonb;
  _window constant interval := interval '30 minutes';
BEGIN
  SELECT id, host_id, title, price, max_players, positions_needed, status, cancelled_at, completed_at
    INTO g
  FROM public.hosted_games WHERE id = _game_id FOR UPDATE;

  IF NOT FOUND
     OR g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL
     OR g.status IN ('cancelled', 'completed') THEN
    RETURN _results;
  END IF;

  PERFORM set_config('app.waitlist_promotion', 'on', true);

  -- Release offers whose window lapsed without a claim / payment.
  FOR w IN
    UPDATE public.game_position_waitlist wl
       SET status = 'expired', reviewed_at = now()
     WHERE wl.game_id = _game_id
       AND wl.status = 'offered'
       AND NOT public.waitlist_offer_is_live(wl.status, wl.offer_expires_at, wl.offered_at, wl.game_id, wl.user_id)
    RETURNING wl.id, wl.user_id, wl.position
  LOOP
    -- Drop the approval the claim created so an expired offer cannot be paid for.
    DELETE FROM public.join_requests
     WHERE game_id = _game_id AND player_id = w.user_id
       AND idempotency_key = 'waitlist:' || w.id::text;
    _results := _results || jsonb_build_object(
      'entryId', w.id, 'userId', w.user_id, 'outcome', 'expired',
      'position', w.position, 'expiresAt', NULL, 'gameTitle', g.title);
  END LOOP;

  SELECT * INTO s FROM public.game_payment_settings WHERE game_id = _game_id LIMIT 1;
  _fee := COALESCE(s.entry_fee, g.price, 0);
  -- No settings row means the host never opened the game up: approval required.
  _needs_approval := CASE WHEN s IS NULL THEN true ELSE s.requires_approval END;

  _free := g.max_players
    - (SELECT count(*) FROM public.game_participants WHERE game_id = _game_id)
    - public.waitlist_reserved_count(_game_id, NULL);

  WHILE _free > 0 LOOP
    SELECT wl.* INTO w
    FROM public.game_position_waitlist wl
    WHERE wl.game_id = _game_id
      AND wl.status = 'waiting'
      -- Only fill positions that still have room (positions_needed is optional).
      AND CASE
        WHEN jsonb_typeof(g.positions_needed) = 'object'
         AND g.positions_needed ? wl.position
         AND (g.positions_needed ->> wl.position) ~ '^\d+$'
        THEN (
          (SELECT count(*) FROM public.game_participants gp
            WHERE gp.game_id = _game_id AND gp.position = wl.position)
          + (SELECT count(*) FROM public.game_position_waitlist o
              WHERE o.game_id = _game_id AND o.position = wl.position AND o.status = 'offered'
                AND public.waitlist_offer_is_live(o.status, o.offer_expires_at, o.offered_at, o.game_id, o.user_id))
        ) < (g.positions_needed ->> wl.position)::int
        ELSE true
      END
    ORDER BY wl.created_at ASC, wl.id ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    EXIT WHEN NOT FOUND;

    IF EXISTS (SELECT 1 FROM public.game_participants WHERE game_id = _game_id AND user_id = w.user_id) THEN
      DELETE FROM public.game_position_waitlist WHERE id = w.id;
      CONTINUE;
    END IF;

    -- A host who already turned this player down keeps that decision.
    IF EXISTS (
      SELECT 1 FROM public.join_requests
      WHERE game_id = _game_id AND player_id = w.user_id AND status = 'rejected'
    ) THEN
      UPDATE public.game_position_waitlist SET status = 'declined', reviewed_at = now() WHERE id = w.id;
      CONTINUE;
    END IF;

    IF _fee <= 0 AND NOT _needs_approval THEN
      BEGIN
        INSERT INTO public.game_participants (game_id, user_id, position)
        VALUES (_game_id, w.user_id, w.position);
        _results := _results || jsonb_build_object(
          'entryId', w.id, 'userId', w.user_id, 'outcome', 'promoted',
          'position', w.position, 'expiresAt', NULL, 'gameTitle', g.title);
        _free := _free - 1;
      EXCEPTION WHEN OTHERS THEN
        -- Capacity / host-closed errors are about the game, not the player.
        IF SQLERRM LIKE 'GAME\_%' THEN
          EXIT;
        END IF;
        -- Age, guardian-consent and similar rules make this player ineligible.
        UPDATE public.game_position_waitlist SET status = 'declined', reviewed_at = now() WHERE id = w.id;
        _results := _results || jsonb_build_object(
          'entryId', w.id, 'userId', w.user_id, 'outcome', 'declined',
          'position', w.position, 'expiresAt', NULL, 'gameTitle', g.title);
      END;
    ELSE
      UPDATE public.game_position_waitlist
         SET status = 'offered', offered_at = now(), offer_expires_at = now() + _window, claimed_at = NULL
       WHERE id = w.id;
      _results := _results || jsonb_build_object(
        'entryId', w.id, 'userId', w.user_id, 'outcome', 'offered',
        'position', w.position, 'expiresAt', now() + _window, 'gameTitle', g.title);
      _free := _free - 1;
    END IF;
  END LOOP;

  PERFORM set_config('app.waitlist_promotion', 'off', true);
  RETURN _results;
END $$;

-- 6. Claim / decline an offer ---------------------------------------------------
-- Returns {result: 'joined'|'pay'|'expired'}. 'pay' means the spot is held and
-- the player still has to submit payment (and, on approval-required games, the
-- host approval is recorded for them) before the offer window closes.
CREATE OR REPLACE FUNCTION public.claim_waitlist_offer(_entry_id uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
  g record;
  s record;
  _game_id text;
  _fee numeric;
  _needs_approval boolean;
BEGIN
  -- Lock the game before the entry, matching promote_next_waitlist_player, so
  -- a claim and a promotion sweep can never deadlock.
  SELECT game_id INTO _game_id FROM public.game_position_waitlist
   WHERE id = _entry_id AND user_id = _user;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: this spot offer is no longer available.' USING ERRCODE = 'P0001';
  END IF;

  SELECT id, host_id, price, status, cancelled_at, completed_at INTO g
  FROM public.hosted_games WHERE id = _game_id FOR UPDATE;
  IF NOT FOUND OR g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL
     OR g.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'GAME_UNAVAILABLE: this game is no longer open.' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO w FROM public.game_position_waitlist
   WHERE id = _entry_id AND user_id = _user FOR UPDATE;
  IF NOT FOUND OR w.status <> 'offered' THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: this spot offer is no longer available.' USING ERRCODE = 'P0001';
  END IF;

  IF NOT public.waitlist_offer_is_live(w.status, w.offer_expires_at, w.offered_at, w.game_id, w.user_id) THEN
    RETURN jsonb_build_object('result', 'expired');
  END IF;

  SELECT * INTO s FROM public.game_payment_settings WHERE game_id = w.game_id LIMIT 1;
  _fee := COALESCE(s.entry_fee, g.price, 0);
  _needs_approval := CASE WHEN s IS NULL THEN true ELSE s.requires_approval END;

  PERFORM set_config('app.waitlist_promotion', 'on', true);

  IF _fee <= 0 THEN
    INSERT INTO public.game_participants (game_id, user_id, position)
    VALUES (w.game_id, _user, w.position)
    ON CONFLICT DO NOTHING;
    DELETE FROM public.game_position_waitlist WHERE id = w.id;
    PERFORM set_config('app.waitlist_promotion', 'off', true);
    RETURN jsonb_build_object('result', 'joined');
  END IF;

  IF _needs_approval THEN
    INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key)
    VALUES (w.game_id, g.host_id, _user, 'waitlist:' || w.id::text)
    ON CONFLICT (game_id, player_id) DO UPDATE
      SET status = 'approved', reviewed_at = now(),
          reviewer_notes = 'Approved from a waitlist offer.';
  END IF;

  UPDATE public.game_position_waitlist SET claimed_at = COALESCE(claimed_at, now()) WHERE id = w.id;
  PERFORM set_config('app.waitlist_promotion', 'off', true);
  RETURN jsonb_build_object('result', 'pay');
END $$;

CREATE OR REPLACE FUNCTION public.decline_waitlist_offer(_entry_id uuid, _user uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w record;
BEGIN
  SELECT * INTO w FROM public.game_position_waitlist
   WHERE id = _entry_id AND user_id = _user FOR UPDATE;
  IF NOT FOUND OR w.status <> 'offered' THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: this spot offer is no longer available.' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.payment_submissions ps
    WHERE ps.game_id = w.game_id AND ps.player_id = _user
      AND ps.status IN ('pending', 'verified')
      AND ps.submitted_at >= COALESCE(w.offered_at, '-infinity'::timestamptz)
  ) THEN
    RAISE EXCEPTION 'OFFER_PAID: you already submitted payment — withdraw from the game instead.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.game_position_waitlist
     SET status = 'declined', reviewed_at = now()
   WHERE id = w.id;
  DELETE FROM public.join_requests
   WHERE game_id = w.game_id AND player_id = _user
     AND idempotency_key = 'waitlist:' || w.id::text;
  RETURN jsonb_build_object('result', 'declined');
END $$;

REVOKE ALL ON FUNCTION public.promote_next_waitlist_player(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_waitlist_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decline_waitlist_offer(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_next_waitlist_player(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_waitlist_offer(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.decline_waitlist_offer(uuid, uuid) TO service_role;

-- 7. Live queue rank -----------------------------------------------------------
-- RLS only lets a player see their own waitlist rows, so rank is computed here.
CREATE OR REPLACE FUNCTION public.my_waitlist_ranks(_game_id text)
RETURNS TABLE(entry_id uuid, queue_position text, queue_rank integer, queue_total integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    mine.id,
    mine.position,
    (SELECT count(*) FROM public.game_position_waitlist o
      WHERE o.game_id = mine.game_id AND o.position = mine.position
        AND o.status IN ('waiting', 'offered')
        AND (o.created_at, o.id) <= (mine.created_at, mine.id))::int,
    (SELECT count(*) FROM public.game_position_waitlist o
      WHERE o.game_id = mine.game_id AND o.position = mine.position
        AND o.status IN ('waiting', 'offered'))::int
  FROM public.game_position_waitlist mine
  WHERE mine.game_id = _game_id
    AND mine.user_id = auth.uid()
    AND mine.status IN ('waiting', 'offered');
$$;

REVOKE ALL ON FUNCTION public.my_waitlist_ranks(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_waitlist_ranks(text) TO authenticated;

-- 8. Late drops ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.game_late_drops (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  game_id text NOT NULL REFERENCES public.hosted_games(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minutes_before_start integer NOT NULL,
  dropped_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_game_late_drops_user ON public.game_late_drops (user_id);

ALTER TABLE public.game_late_drops ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.game_late_drops TO authenticated;
GRANT ALL ON public.game_late_drops TO service_role;

-- Rows are written only by the trigger below, never by clients.
CREATE POLICY "Players see their own late drops"
  ON public.game_late_drops FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Hosts see late drops for their games"
  ON public.game_late_drops FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.hosted_games hg
    WHERE hg.id = game_late_drops.game_id AND hg.host_id = auth.uid()
  ));

-- A player removing themselves from a roster within 2 hours of start (or after
-- it started) is a late drop. Host removals, cancelled / finished games and
-- all-day games are not. Keep the 2h window in step with src/lib/late-drop.ts.
CREATE OR REPLACE FUNCTION public.log_late_drop()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() <> OLD.user_id OR OLD.attended IS NOT NULL THEN
    RETURN OLD;
  END IF;

  SELECT host_id, date, all_day, status, cancelled_at, completed_at INTO g
  FROM public.hosted_games WHERE id = OLD.game_id;

  IF NOT FOUND
     OR g.host_id = OLD.user_id
     OR COALESCE(g.all_day, false)
     OR g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL
     OR g.status IN ('cancelled', 'completed') THEN
    RETURN OLD;
  END IF;

  IF now() >= g.date - interval '2 hours' THEN
    INSERT INTO public.game_late_drops (game_id, user_id, minutes_before_start)
    VALUES (
      OLD.game_id, OLD.user_id,
      GREATEST(0, floor(extract(epoch FROM (g.date - now())) / 60)::int)
    )
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;
  RETURN OLD;
END $$;

REVOKE ALL ON FUNCTION public.log_late_drop() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_log_late_drop ON public.game_participants;
CREATE TRIGGER trg_log_late_drop
  AFTER DELETE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.log_late_drop();

-- 9. Reliability for hosts ---------------------------------------------------------
-- Counts only. Visible to the player, moderators, and a host who has the player
-- on a roster, join request or waitlist of one of their games.
CREATE OR REPLACE FUNCTION public.player_reliability(_user uuid)
RETURNS TABLE(games_attended integer, no_shows integer, late_drops integer)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() <> _user
     AND NOT public.is_moderator(auth.uid())
     AND NOT EXISTS (
       SELECT 1 FROM public.hosted_games hg
       WHERE hg.host_id = auth.uid()
         AND (
           EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = hg.id AND gp.user_id = _user)
           OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = hg.id AND jr.player_id = _user)
           OR EXISTS (SELECT 1 FROM public.game_position_waitlist wl WHERE wl.game_id = hg.id AND wl.user_id = _user)
         )
     ) THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE gp.user_id = _user AND gp.attended IS TRUE AND g.cancelled_at IS NULL)::int,
    (SELECT count(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE gp.user_id = _user AND gp.attended IS FALSE AND g.cancelled_at IS NULL)::int,
    (SELECT count(*) FROM public.game_late_drops ld WHERE ld.user_id = _user)::int;
END $$;

REVOKE ALL ON FUNCTION public.player_reliability(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.player_reliability(uuid) TO authenticated;
