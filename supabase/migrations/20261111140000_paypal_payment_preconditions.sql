-- PayPal checkout checks every payment rule before any money moves, and never loses a captured payment (task #69).
--
-- The server records a PayPal payment with the service role, after PayPal has moved the money, and then puts the
-- player on the roster with the service role. Several rules apply to those two writes whoever makes them, so a capture
-- that broke one of them moved the money and then failed to record it (the server ignored the error), or recorded it
-- and left the player off the roster:
--   payment_submissions  enforce_approval_before_payment  the payee's settings require an approved request
--                        enforce_game_payment_cohort      the player and the host may both coordinate payments
--                        enforce_payment_destination      the payment goes to the game's payee
--   game_participants    enforce_game_join_gate           not cancelled, not completed, joining open, a free seat
--                        enforce_game_age_requirement     the game's age range, unless the host approved the request
--                        enforce_child_game_participation the account may take part in games at all
--                        addPaidPlayerToRoster            an approved request when the game is request-to-join
-- Others apply only to a signed-in writer, which the server is not, and checkout skipped them: the guardian rule
-- (20261111100000 already asks it before the money moves), a host's block (enforce_host_block), and joining a game
-- that is over by the clock (the join gate's own check for a player joining themselves).
--
--   1. private_sec.paypal_payment_block(game): NULL when the signed-in caller may pay for the game now, else a code.
--      It answers only for auth.uid() (it takes no user), reuses the existing helpers (game_payee,
--      game_payments_allowed, child_game_participation_allowed, game_payment_guardian_ready, is_game_participant) and
--      changes no rule: no trigger is touched.
--   2. public.paypal_payment_precondition(game): the API entry point. It runs as the caller, so a game the caller
--      cannot see through hosted_games' row level security is GAME_NOT_FOUND before anything else is said about it,
--      then asks 1. Signed-in callers only: PUBLIC, anon and the service role cannot call either function.
--   3. paypal_orders.status gains 'capturing' (a capture is under way: one request at a time), 'refunded_unrecorded'
--      (captured, could not be recorded, refunded) and 'captured_unrecorded' (captured, could not be recorded, and the
--      refund failed too: the money is with the host and a superadmin has to settle it by hand).
-- Deploy order: this migration BEFORE the app. The server's check fails closed, so a published server without these
-- functions refuses every PayPal checkout.
-- Rollback: docs/rollbacks/20261111140000_paypal_payment_preconditions.down.sql (guarded). Roll it back before
-- 20261111100000's rollback, which refuses while this one is applied.

DO $guard$
BEGIN
  IF to_regprocedure('public.game_payment_guardian_ready(text)') IS NULL
     OR to_regprocedure('private_sec.game_payee(text)') IS NULL
     OR to_regprocedure('public.game_payments_allowed(uuid)') IS NULL
     OR to_regprocedure('public.child_game_participation_allowed(uuid)') IS NULL
     OR to_regprocedure('public.is_game_participant(text, uuid)') IS NULL
     OR to_regprocedure('public.game_duration_minutes(text)') IS NULL
     OR to_regclass('public.paypal_orders') IS NULL THEN
    RAISE EXCEPTION '20261111140000: an earlier migration it builds on (20261111100000_paypal_guardian_rule and the payment and join gates) is not applied';
  END IF;
END
$guard$;

-- ============================================================ 1. the rules, for the signed-in caller only
CREATE OR REPLACE FUNCTION private_sec.paypal_payment_block(_game_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me constant uuid := auth.uid();
  g record;
  _payee uuid;
  _approved boolean;
  _rostered boolean;
  _requires boolean;
  _has_settings boolean;
  _age int;
  _ends timestamptz;
BEGIN
  IF _me IS NULL THEN
    RETURN 'SIGN_IN_REQUIRED';
  END IF;

  SELECT id, host_id, status, cancelled_at, completed_at, joins_closed, signup_cutoff_min, max_players, date, ends_at,
         duration, min_age, max_age
    INTO g
    FROM public.hosted_games WHERE id = _game_id;
  IF NOT FOUND THEN
    RETURN 'GAME_NOT_FOUND';
  END IF;

  -- The join gate refuses any roster place in a cancelled or completed game, the server's included.
  IF g.cancelled_at IS NOT NULL OR g.status = 'cancelled' THEN
    RETURN 'GAME_CANCELLED';
  END IF;
  IF g.completed_at IS NOT NULL OR g.status = 'completed' THEN
    RETURN 'GAME_COMPLETED';
  END IF;

  -- enforce_payment_destination: the money goes to the game's payee. enforce_game_payment_cohort: the payee must be
  -- allowed to coordinate payments. One code for both, so the answer says nothing about the host's age.
  _payee := private_sec.game_payee(_game_id);
  IF _payee = _me THEN
    RETURN 'OWN_GAME';
  END IF;
  IF _payee IS NULL OR NOT public.game_payments_allowed(_payee) THEN
    RETURN 'PAYMENT_DESTINATION_INVALID';
  END IF;
  -- enforce_game_payment_cohort, for the player.
  IF NOT public.game_payments_allowed(_me) THEN
    RETURN 'PAYMENTS_NOT_AVAILABLE';
  END IF;
  -- enforce_child_game_participation: the paid place could not be given.
  IF NOT public.child_game_participation_allowed(_me) THEN
    RETURN 'GAME_PARTICIPATION_BLOCKED';
  END IF;
  -- enforce_host_block, which the server's write skips.
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = g.host_id AND b.blocked_id = _me) THEN
    RETURN 'BLOCKED_BY_HOST';
  END IF;
  -- Paying twice for one game.
  IF EXISTS (SELECT 1 FROM public.payment_submissions ps
              WHERE ps.game_id = _game_id AND ps.player_id = _me AND ps.status = 'verified') THEN
    RETURN 'ALREADY_PAID';
  END IF;

  _approved := EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE jr.game_id = _game_id AND jr.player_id = _me AND jr.status = 'approved');
  _rostered := public.is_game_participant(_game_id, _me);

  -- enforce_approval_before_payment reads the payee's settings (one row: game_id, host_id is unique) and treats a
  -- missing row as no approval needed. addPaidPlayerToRoster treats a missing row as request-to-join, so a player not
  -- yet on the roster would pay and not be placed.
  SELECT s.requires_approval INTO _requires
    FROM public.game_payment_settings s
   WHERE s.game_id = _game_id AND s.host_id = _payee;
  _has_settings := FOUND;
  IF NOT _approved AND (COALESCE(_requires, false) OR (NOT _has_settings AND NOT _rostered)) THEN
    RETURN 'HOST_APPROVAL_REQUIRED';
  END IF;

  -- 20261111100000's rule (enforce_guardian_before_payment, with an adult exempt), asked as it is everywhere else.
  IF NOT public.game_payment_guardian_ready(_game_id) THEN
    RETURN 'GUARDIAN_APPROVAL_REQUIRED';
  END IF;

  -- The rest decide whether the paid place can be given. A player already on the roster keeps it.
  IF NOT _rostered THEN
    -- enforce_game_age_requirement: an age range needs a known age inside it, or the host's approval.
    IF (g.min_age IS NOT NULL OR g.max_age IS NOT NULL) AND NOT _approved THEN
      SELECT date_part('year', age(pb.birthday))::int INTO _age
        FROM public.profile_birthdays pb WHERE pb.user_id = _me AND pb.birthday IS NOT NULL;
      IF _age IS NULL OR (g.min_age IS NOT NULL AND _age < g.min_age) OR (g.max_age IS NOT NULL AND _age > g.max_age) THEN
        RETURN 'AGE_REQUIREMENT_NOT_MET';
      END IF;
    END IF;
    -- The join gate's own check for a player joining themselves: over by the clock.
    _ends := CASE
               WHEN g.ends_at IS NOT NULL AND g.ends_at > g.date THEN g.ends_at
               ELSE g.date + make_interval(mins => public.game_duration_minutes(g.duration))
             END;
    IF now() >= _ends THEN
      RETURN 'GAME_COMPLETED';
    END IF;
    -- The join gate: closed joining or the signup cutoff stops a player the host has not approved.
    IF NOT _approved AND (g.joins_closed OR (COALESCE(g.signup_cutoff_min, 0) > 0
                                             AND now() >= g.date - make_interval(mins => g.signup_cutoff_min))) THEN
      RETURN 'GAME_JOINS_CLOSED';
    END IF;
    -- The join gate: a free seat.
    IF (SELECT count(*) FROM public.game_participants gp WHERE gp.game_id = _game_id) >= GREATEST(g.max_players, 1) THEN
      RETURN 'GAME_FULL';
    END IF;
  END IF;

  RETURN NULL;
END
$$;
REVOKE ALL ON FUNCTION private_sec.paypal_payment_block(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION private_sec.paypal_payment_block(text) TO authenticated;

-- ============================================================ 2. the API entry point, as the caller
CREATE OR REPLACE FUNCTION public.paypal_payment_precondition(_game_id text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN 'SIGN_IN_REQUIRED';
  END IF;
  -- A game the caller cannot see (hidden, or private and not theirs) gets the same answer as one that does not exist.
  IF NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id) THEN
    RETURN 'GAME_NOT_FOUND';
  END IF;
  RETURN private_sec.paypal_payment_block(_game_id);
END
$$;
REVOKE ALL ON FUNCTION public.paypal_payment_precondition(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.paypal_payment_precondition(text) TO authenticated;

-- ============================================================ 3. order statuses for a capture under way or unrecorded
ALTER TABLE public.paypal_orders DROP CONSTRAINT paypal_orders_status_check;
ALTER TABLE public.paypal_orders ADD CONSTRAINT paypal_orders_status_check CHECK (status = ANY (ARRAY[
  'created'::text, 'approved'::text, 'capturing'::text, 'captured'::text, 'failed'::text, 'cancelled'::text,
  'refunded_unrecorded'::text, 'captured_unrecorded'::text]));
