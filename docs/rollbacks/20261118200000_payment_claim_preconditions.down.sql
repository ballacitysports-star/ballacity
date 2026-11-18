-- ROLLBACK for supabase/migrations/20261118200000_payment_claim_preconditions.sql (docs/paid-path-gates.md section 6).
-- NOT a migration. It reopens what the migration closed:
--   * a player's own manual payment claim (Venmo, Cash App, ...) is again recorded for a game that is cancelled,
--     finished (marked or by the clock), closed to joining or past its signup cutoff, or full, for a player whose
--     guardian turned off game participation, whom the host blocked, or who is outside the game's age range. The host
--     can verify it, and the roster place still cannot be given;
--   * get_game_host_payment_methods again shows the host's handles to a signed-in caller who may not coordinate
--     payments (under 16, unknown age, consent-locked).
-- It drops the trigger zz_payment_claim_preconditions and its function, puts back, byte for byte, the definitions in
-- force before the migration (md5(pg_get_functiondef)):
--   private_sec.paypal_payment_block(text): d234777c2826d82bb28610849426622a
--   public.get_game_host_payment_methods(uuid, text): 0749f4a8b63a6f2b23103f0e1077d419
-- and then drops private_sec.payment_claim_block(text, uuid). CREATE OR REPLACE keeps owners and grants. PayPal
-- checkout answers exactly as it did with the migration applied (the migration changed where its rules live, not
-- what it answers). No row is written or removed: claims recorded while the migration was in force stay.
-- The app change that shipped with the migration works either way and stays: its messages for the new codes are
-- simply never needed.
-- It stops, changing nothing, if any of the four functions no longer has the definition the migration gave it (a
-- later migration changed it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_payment_claim_preconditions_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_payment_claim_preconditions_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"private_sec.payment_claim_block(text,uuid)": "46a3cc02d2146f73270e679d2284a1b9", "private_sec.paypal_payment_block(text)": "725e863faca9e7d659358eb030b3adaf", "public.enforce_payment_claim_preconditions()": "8773e6a6822cd83426eb9d206e884b25", "public.get_game_host_payment_methods(uuid,text)": "ea525f29aa2da2aca39d9a797ce8a11e"}'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_payment_claim_preconditions_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets players record manual payment claims for games that can never give them the place (cancelled, ended, closed, full, blocked, outside the age range, or not allowed by a guardian), and shows host payment handles to accounts that may not pay. Set app.confirm_payment_claim_preconditions_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261118200000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP TRIGGER IF EXISTS zz_payment_claim_preconditions ON public.payment_submissions;
DROP FUNCTION IF EXISTS public.enforce_payment_claim_preconditions();

-- The definitions in force before the migration, unchanged.
CREATE OR REPLACE FUNCTION private_sec.paypal_payment_block(_game_id text)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$

;

CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
$function$

;

DROP FUNCTION IF EXISTS private_sec.payment_claim_block(text, uuid);

-- Check what was put back before committing.
DO $restored$
BEGIN
  IF md5(pg_get_functiondef('private_sec.paypal_payment_block(text)'::regprocedure)) IS DISTINCT FROM 'd234777c2826d82bb28610849426622a'
     OR md5(pg_get_functiondef('public.get_game_host_payment_methods(uuid,text)'::regprocedure)) IS DISTINCT FROM '0749f4a8b63a6f2b23103f0e1077d419' THEN
    RAISE EXCEPTION 'Rollback did not restore the pre-migration definitions; nothing was changed.';
  END IF;
END
$restored$;
COMMIT;
