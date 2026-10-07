-- Spot holds for paid games.
--
-- When a host approves a player on a paid game, the spot is held for
-- `payment_hold_minutes`. If the player hasn't submitted payment (or been
-- marked paid) before the hold runs out, the approval is released so the
-- spot can go to someone else, and the next player on the waitlist is told a
-- spot opened up. NULL keeps today's behaviour: no automatic release.
--
-- A hold only applies before tip-off. Once the game has started the host is
-- collecting at the court, so nothing is released after `hosted_games.date`.

ALTER TABLE public.game_payment_settings
  ADD COLUMN IF NOT EXISTS payment_hold_minutes integer;

ALTER TABLE public.game_payment_settings
  DROP CONSTRAINT IF EXISTS game_payment_settings_payment_hold_minutes_chk;
ALTER TABLE public.game_payment_settings
  ADD CONSTRAINT game_payment_settings_payment_hold_minutes_chk
  CHECK (payment_hold_minutes IS NULL OR payment_hold_minutes BETWEEN 15 AND 10080);

COMMENT ON COLUMN public.game_payment_settings.payment_hold_minutes IS
  'Minutes an approved player has to submit payment before their spot is released. NULL = never auto-release.';

-- Releases every expired hold, or only those for one game.
--
-- Called three ways, all idempotent:
--   * lazily by the game page (any signed-in viewer, one game at a time) so
--     holds release even where no scheduler is configured;
--   * by pg_cron below, when the extension is available;
--   * by /api/public/payments/release-holds for an external scheduler.
-- Returns the number of holds released.
CREATE OR REPLACE FUNCTION public.release_expired_payment_holds(_game_id uuid DEFAULT NULL)
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
  -- A sweep across every game is for the scheduler only; signed-in callers
  -- must name the game they are looking at.
  IF _game_id IS NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A game id is required.' USING ERRCODE = '42501';
  END IF;

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

    -- Offer the opening to whoever has waited longest. When one sweep frees
    -- several spots, each goes to a different waiting player.
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

REVOKE ALL ON FUNCTION public.release_expired_payment_holds(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_expired_payment_holds(uuid) TO authenticated, service_role;

-- Sweep every five minutes where pg_cron is installed. Environments without
-- it rely on the lazy page sweep and the scheduler endpoint instead.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'release-expired-payment-holds',
      '*/5 * * * *',
      'SELECT public.release_expired_payment_holds()'
    );
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'pg_cron schedule for payment holds skipped: %', SQLERRM;
END
$cron$;
