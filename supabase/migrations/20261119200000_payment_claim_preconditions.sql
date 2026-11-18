-- A player's own manual payment claim meets the same game rules as PayPal checkout (docs/paid-path-gates.md section 6,
-- owner decision 2026-11-18, "approve all").
--
-- PayPal checkout asks private_sec.paypal_payment_block before any money moves (20261111140000). A manual claim (Venmo,
-- Cash App, ...: the player pays outside the app, then writes a payment_submissions row with their proof) was checked
-- only for host approval, the payment cohort, the guardian rule and the payee. So a claim was recorded, and the host
-- could verify it, for a place the roster can never give: a cancelled or finished game, closed joining, a full roster,
-- a guardian's "Can join games" switch turned off, a host's block, or an age range the player is outside of.
--
--   1. private_sec.payment_claim_block(game, player): the rules both paths share, in paypal_payment_block's order, NULL
--      when none refuses. For any player: GAME_CANCELLED, GAME_COMPLETED, GAME_PARTICIPATION_BLOCKED, BLOCKED_BY_HOST.
--      For a player not yet on the roster: AGE_REQUIREMENT_NOT_MET (not approved), GAME_COMPLETED (over by the clock),
--      GAME_JOINS_CLOSED (not approved, and joining closed or past the signup cutoff), GAME_FULL (roster count at
--      max_players; the owner decided this replaces the pay page's soft "just filled up" warning with a refusal).
--      It names a player, so nobody but the definer functions below may call it.
--   2. private_sec.paypal_payment_block(game) asks 1 instead of repeating those rules. Its answers do not change, in
--      value or order: it still checks a cancelled or completed game first, returns 1's GAME_PARTICIPATION_BLOCKED or
--      BLOCKED_BY_HOST where it returned them before (they come before the place rules in 1 too), and returns 1's place
--      rule last, as before. PayPal-only codes (OWN_GAME, PAYMENT_DESTINATION_INVALID, AGE_VERIFICATION_REQUIRED,
--      PAYMENTS_NOT_AVAILABLE, ALREADY_PAID, PAYMENT_IN_PROGRESS, HOST_APPROVAL_REQUIRED, GUARDIAN_APPROVAL_REQUIRED)
--      stay in it.
--   3. A BEFORE INSERT trigger on payment_submissions refuses a player's own claim with 1's code. It runs only when the
--      signed-in writer is the player (auth.uid() = player_id): a host's "Marked paid by host" row and the service
--      role's record of a PayPal capture (no signed-in writer) are not checked. PayPal asked before the money moved, and
--      refusing the record of a captured payment would be worse. It is named to fire after every other BEFORE INSERT
--      trigger, so the refusals those already give (host approval, cohort, guardian, payee, state) keep their messages.
--      INSERT only: claims already written are untouched, and withdrawing, disputing, rejecting or verifying one is not
--      checked.
--   4. public.get_game_host_payment_methods returns nothing to a caller who may not coordinate payments
--      (game_payments_allowed false: under 16, unknown age, or consent-locked), except the payee looking at their own
--      methods (section 6, "Also related" (a)). A guardian (an adult) is unaffected. Its body is otherwise unchanged;
--      it now pins search_path to '' (every name in it was already qualified).
-- Not changed (a separate owner question, it would loosen a guardian rule): the guardian adult exemption mismatch
-- between game_payment_guardian_ready and enforce_guardian_before_payment (section 6 "Also related" (d)).
-- Deploy order: this migration BEFORE the app change that maps the new codes; the app without it shows the raw
-- "CODE: sentence" text the database returns.
-- Rollback: docs/rollbacks/20261119200000_payment_claim_preconditions.down.sql (guarded).

DO $guard$
BEGIN
  IF to_regprocedure('private_sec.paypal_payment_block(text)') IS NULL
     OR to_regprocedure('public.child_game_participation_allowed(uuid)') IS NULL
     OR to_regprocedure('public.is_game_participant(text, uuid)') IS NULL
     OR to_regprocedure('public.game_duration_minutes(text)') IS NULL
     OR to_regprocedure('public.game_payments_allowed(uuid)') IS NULL
     OR to_regprocedure('public.get_game_host_payment_methods(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '20261119200000: an earlier migration it builds on (20261111140000_paypal_payment_preconditions and the payment and join gates) is not applied';
  END IF;
END
$guard$;

-- ============================================================ 1. the rules a paid place needs, for one player
CREATE OR REPLACE FUNCTION private_sec.payment_claim_block(_game_id text, _player uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  g record;
  _approved boolean;
  _age int;
  _ends timestamptz;
BEGIN
  SELECT id, host_id, status, cancelled_at, completed_at, joins_closed, signup_cutoff_min, max_players, date, ends_at,
         duration, min_age, max_age
    INTO g
    FROM public.hosted_games WHERE id = _game_id;
  -- No such game: nothing to say here (the caller, or the row's foreign key, answers that).
  IF NOT FOUND OR _player IS NULL THEN
    RETURN NULL;
  END IF;

  -- The join gate refuses any roster place in a cancelled or completed game, the server's included.
  IF g.cancelled_at IS NOT NULL OR g.status = 'cancelled' THEN
    RETURN 'GAME_CANCELLED';
  END IF;
  IF g.completed_at IS NOT NULL OR g.status = 'completed' THEN
    RETURN 'GAME_COMPLETED';
  END IF;
  -- enforce_child_game_participation: the paid place could not be given.
  IF NOT public.child_game_participation_allowed(_player) THEN
    RETURN 'GAME_PARTICIPATION_BLOCKED';
  END IF;
  -- enforce_host_block (one direction: the host blocked the player).
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = g.host_id AND b.blocked_id = _player) THEN
    RETURN 'BLOCKED_BY_HOST';
  END IF;

  -- The rest decide whether the paid place can be given. A player already on the roster keeps it.
  IF public.is_game_participant(_game_id, _player) THEN
    RETURN NULL;
  END IF;
  _approved := EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE jr.game_id = _game_id AND jr.player_id = _player AND jr.status = 'approved');
  -- enforce_game_age_requirement: an age range needs a known age inside it, or the host's approval.
  IF (g.min_age IS NOT NULL OR g.max_age IS NOT NULL) AND NOT _approved THEN
    SELECT date_part('year', age(pb.birthday))::int INTO _age
      FROM public.profile_birthdays pb WHERE pb.user_id = _player AND pb.birthday IS NOT NULL;
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

  RETURN NULL;
END
$$;
-- It answers about any player it is given, so no API role may call it: only the definer functions below do.
REVOKE ALL ON FUNCTION private_sec.payment_claim_block(text, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================ 2. PayPal asks 1 (same answers, same order)
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
  _shared text;
BEGIN
  IF _me IS NULL THEN
    RETURN 'SIGN_IN_REQUIRED';
  END IF;

  SELECT id, host_id, status, cancelled_at, completed_at
    INTO g
    FROM public.hosted_games WHERE id = _game_id;
  IF NOT FOUND THEN
    RETURN 'GAME_NOT_FOUND';
  END IF;

  -- The join gate refuses any roster place in a cancelled or completed game, the server's included. Asked first, as
  -- payment_claim_block asks it first.
  IF g.cancelled_at IS NOT NULL OR g.status = 'cancelled' THEN
    RETURN 'GAME_CANCELLED';
  END IF;
  IF g.completed_at IS NOT NULL OR g.status = 'completed' THEN
    RETURN 'GAME_COMPLETED';
  END IF;
  -- The rules a manual claim shares (payment_claim_block). Its answer here is not a cancelled or completed game (asked
  -- above), so it is GAME_PARTICIPATION_BLOCKED or BLOCKED_BY_HOST (returned where those were asked before), a place
  -- rule (returned last, where those were asked before), or NULL.
  _shared := private_sec.payment_claim_block(_game_id, _me);

  -- enforce_payment_destination: the money goes to the game's payee. enforce_game_payment_cohort: the payee must be
  -- allowed to coordinate payments. One code for both, so the answer says nothing about the host's age.
  _payee := private_sec.game_payee(_game_id);
  IF _payee = _me THEN
    RETURN 'OWN_GAME';
  END IF;
  IF _payee IS NULL OR NOT public.game_payments_allowed(_payee) THEN
    RETURN 'PAYMENT_DESTINATION_INVALID';
  END IF;
  -- enforce_child_game_participation, for a player joining themselves (the server's roster write skips it): a declared
  -- date of birth. Asked before the cohort rule, so a player with no birthday is told what to do: with
  -- 20261111120000 (minor-safety gates) game_payments_allowed is false for them too, and would answer first.
  IF NOT public.age_verified(_me) THEN
    RETURN 'AGE_VERIFICATION_REQUIRED';
  END IF;
  -- enforce_game_payment_cohort, for the player.
  IF NOT public.game_payments_allowed(_me) THEN
    RETURN 'PAYMENTS_NOT_AVAILABLE';
  END IF;
  -- enforce_child_game_participation (the paid place could not be given) and enforce_host_block (which the server's
  -- write skips), from payment_claim_block.
  IF _shared IN ('GAME_PARTICIPATION_BLOCKED', 'BLOCKED_BY_HOST') THEN
    RETURN _shared;
  END IF;
  -- Paying twice for one game.
  IF EXISTS (SELECT 1 FROM public.payment_submissions ps
              WHERE ps.game_id = _game_id AND ps.player_id = _me AND ps.status = 'verified') THEN
    RETURN 'ALREADY_PAID';
  END IF;
  -- Money this player moved for this game by PayPal that is not recorded yet: captured and still being recorded, or
  -- held because PayPal has not completed the capture (capturing with a capture id), captured with no record of it, or
  -- captured and neither recorded nor refunded. An order the server holds for its own capture with nothing captured yet
  -- is not counted: the capture asks this after holding it, and the unique index below keeps a second one out.
  IF EXISTS (SELECT 1 FROM public.paypal_orders o
              WHERE o.game_id = _game_id AND o.player_id = _me
                AND (o.status = 'captured_unrecorded'
                     OR (o.status = 'capturing' AND o.capture_id IS NOT NULL)
                     OR (o.status = 'captured' AND NOT EXISTS (
                           SELECT 1 FROM public.payment_submissions ps
                            WHERE ps.game_id = _game_id AND ps.player_id = _me
                              AND ps.transaction_reference = COALESCE(o.capture_id, o.order_id))))) THEN
    RETURN 'PAYMENT_IN_PROGRESS';
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

  -- The rest decide whether the paid place can be given (payment_claim_block: nothing for a player already on the
  -- roster; else the age range, over by the clock, closed joining or the signup cutoff, and a free seat).
  RETURN _shared;
END
$$;
-- Grants are kept by CREATE OR REPLACE (20261111140000: authenticated only).

-- ============================================================ 3. a player's own manual claim
CREATE OR REPLACE FUNCTION public.enforce_payment_claim_preconditions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _code text;
BEGIN
  -- Only the player's own claim. A host's "Marked paid by host" row (the host is the writer) and the service role's
  -- record of a PayPal capture (no signed-in writer; PayPal asked paypal_payment_block before the money moved) pass.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.player_id THEN
    RETURN NEW;
  END IF;
  _code := private_sec.payment_claim_block(NEW.game_id, NEW.player_id);
  IF _code IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%: %', _code, CASE _code
      WHEN 'GAME_CANCELLED' THEN 'this game was cancelled, so a payment for it cannot be recorded.'
      WHEN 'GAME_COMPLETED' THEN 'this game has already ended, so a payment for it cannot be recorded.'
      WHEN 'GAME_PARTICIPATION_BLOCKED' THEN 'a parent or guardian has to allow game participation before a payment can be recorded.'
      WHEN 'BLOCKED_BY_HOST' THEN 'you can''t join this host''s games, so a payment cannot be recorded.'
      WHEN 'AGE_REQUIREMENT_NOT_MET' THEN 'this game has an age requirement, so the host has to approve your request first.'
      WHEN 'GAME_JOINS_CLOSED' THEN 'joining is closed for this game, so a payment cannot be recorded.'
      WHEN 'GAME_FULL' THEN 'this game is full, so a payment for a place in it cannot be recorded.'
      ELSE 'a payment for this game cannot be recorded.'
    END
    USING ERRCODE = 'P0001';
END
$$;
REVOKE ALL ON FUNCTION public.enforce_payment_claim_preconditions() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_payment_claim_preconditions() TO service_role;

-- "zz_": after every other BEFORE INSERT trigger on the table (they fire in name order), so it adds refusals and
-- changes none of theirs.
DROP TRIGGER IF EXISTS zz_payment_claim_preconditions ON public.payment_submissions;
CREATE TRIGGER zz_payment_claim_preconditions BEFORE INSERT ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_claim_preconditions();

-- ============================================================ 4. no handles for a caller who may not pay
CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN
    RETURN;
  END IF;
  -- Only the game's payee has payment methods to show for it.
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN
    RETURN;
  END IF;
  -- Only to a caller who may coordinate payments (not under 16, an unknown age or a consent-locked account): the
  -- manual claim would be refused anyway, and the handles invite paying first. The payee sees their own.
  IF _me IS DISTINCT FROM _host_id AND NOT public.game_payments_allowed(_me) THEN
    RETURN;
  END IF;
  -- Only a confirmed adult's handles are shown: not a 16-17-year-old's, not an unknown age's (the payee sees their own).
  IF _me IS DISTINCT FROM _host_id AND public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN
    RETURN;
  END IF;
  -- Only to someone involved in the game (the payee, an approved requester, a payer, a participant: the rule of the
  -- payment settings row), or who can see it (the hosted_games read policies for a signed-in account).
  IF NOT private_sec.can_read_game_payment_settings(_game_id, _host_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.hosted_games g
        WHERE g.id = _game_id
          AND ((g.is_private = false AND g.hidden_at IS NULL)
               OR g.host_id = _me
               OR ((g.is_private = true OR g.moderator_hidden_at IS NULL)
                   AND (public.is_game_participant(g.id, _me)
                        OR EXISTS (SELECT 1 FROM public.join_requests jr
                                    WHERE jr.game_id = g.id AND jr.player_id = _me))))) THEN
    RETURN;
  END IF;

  SELECT *
  INTO _settings
  FROM public.game_payment_settings gps
  WHERE gps.game_id = _game_id
    AND gps.host_id = _host_id
  ORDER BY gps.created_at DESC
  LIMIT 1;

  IF _settings.id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (
        COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0
        OR hpm.id = ANY(_settings.accepted_method_ids)
      );
END;
$function$;
-- Grants are kept by CREATE OR REPLACE (authenticated and service_role; not anon).
