-- ROLLBACK for supabase/migrations/20261103140000_payment_settings_host_guard.sql.
-- NOT a migration. Re-opens the hole: any signed-in account can write payment settings for any game, a payment
-- submission can name any payee, and "the latest settings row" is believed again.
--     PGOPTIONS="-c app.confirm_reopen_payment_settings=yes" psql ... -f <this file>
-- It stops, changing nothing, while public.game_removals exists: roll back 20261204110000, 20261204100000 and
-- 20261202100000 first, in that order (docs/rollbacks/20261204110000_paid_invite_capacity.down.sql,
-- docs/rollbacks/20261204100000_removal_ask_limits.down.sql, docs/rollbacks/20261202100000_removal_sticks.down.sql).
-- Run while removals are recorded, it would put back a join gate and a release sweep that do not read them.
-- It also stops, changing nothing, unless each of the seven functions it puts back (validate_join_request,
-- enforce_approval_before_payment, enforce_game_join_gate, release_expired_payment_holds, settle_paid_spot,
-- get_game_refund_terms, get_game_host_payment_methods) is exactly what 20261103140000 created (md5 below). Its
-- CREATE OR REPLACE would otherwise overwrite a later definition without a word. On main these were redefined later:
-- enforce_game_join_gate by 20261202100000, release_expired_payment_holds by 20261125100000 and 20261202100000, and
-- get_game_host_payment_methods by 20261111120000, 20261119200000 and 20261128120000. Their rollbacks must have put
-- 20261103140000's bodies back before this one runs; clearing game_removals alone is not enough. A changed body
-- needs a person to look first.
-- It also stops while any other function still calls one of the four helpers it drops at the end (a function body
-- is a string, so DROP FUNCTION would succeed and that function would fail later).
-- PRODUCTION CHECK: the md5 values were computed on the local Postgres 16 from a replay of the migrations up to and
-- including 20261103140000. Production runs 17, where pg_get_functiondef text may differ. The guard fails closed (it
-- refuses, changing nothing), but check before an emergency with this read-only query; on the state 20261103140000
-- left it must list exactly the md5 values in the guard below:
--     SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)) FROM pg_proc p
--      WHERE p.oid IN ('public.validate_join_request()'::regprocedure,
--                      'public.enforce_approval_before_payment()'::regprocedure,
--                      'public.enforce_game_join_gate()'::regprocedure,
--                      'public.release_expired_payment_holds(text)'::regprocedure,
--                      'public.settle_paid_spot(text,uuid,text)'::regprocedure,
--                      'public.get_game_refund_terms(text)'::regprocedure,
--                      'public.get_game_host_payment_methods(uuid,text)'::regprocedure) ORDER BY 1;
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_payment_settings', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets any account write payment settings for any game. Set app.confirm_reopen_payment_settings=yes to proceed deliberately.';
  END IF;
END
$guard$;
DO $defs$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.validate_join_request()',                   '360371fe6b5b898d64af524f45ca563c'],
    ['public.enforce_approval_before_payment()',         '3ffff8c3b95ae10ce43cdc4197cc886a'],
    ['public.enforce_game_join_gate()',                  '9d4924a2d53915fca8fa245e15281a25'],
    ['public.release_expired_payment_holds(text)',       '3eee00253e98ac807138ccf333f1c498'],
    ['public.settle_paid_spot(text,uuid,text)',          '57f56d6ca1f73350c5896219236713ee'],
    ['public.get_game_refund_terms(text)',               'b3a83c3ae050ffd7f92869d29df5c6b5'],
    ['public.get_game_host_payment_methods(uuid,text)',  'ca5a74909181a98cf1416c6a5d37d156']];
  _fn regprocedure;
  _got text;
  i int;
BEGIN
  -- First, because it names the order to follow, which a bare md5 mismatch does not.
  IF to_regclass('public.game_removals') IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: public.game_removals exists, so 20261202100000 is still applied and this would put back a join gate and a release sweep that ignore recorded removals. Roll back 20261204110000, 20261204100000 and 20261202100000 first, in that order.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    _fn := to_regprocedure(_want[i][1]);
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
    IF _fn IS NULL OR _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261103140000 created (md5 %). A later change needs a person to look first.', _want[i][1], _got;
    END IF;
  END LOOP;
  -- The end of this file drops four helpers. A function body that calls one by name is a string Postgres does not
  -- track, so the drops would succeed and that function would fail at its next call. Refuse while any function this
  -- file does not replace or drop still names one (on main: get_game_join_policy, game_respond_invite,
  -- paypal_payment_block, get_game_payment_terms).
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO _got
    FROM pg_proc p
   WHERE p.prosrc ~ '\m(game_payee|game_payee_id|can_manage_game_payment_settings|can_read_game_payment_settings)\M'
     AND NOT p.oid = ANY (array_remove(ARRAY[
           to_regprocedure('public.validate_join_request()'), to_regprocedure('public.enforce_approval_before_payment()'),
           to_regprocedure('public.enforce_game_join_gate()'), to_regprocedure('public.release_expired_payment_holds(text)'),
           to_regprocedure('public.settle_paid_spot(text,uuid,text)'), to_regprocedure('public.get_game_refund_terms(text)'),
           to_regprocedure('public.get_game_host_payment_methods(uuid,text)'),
           to_regprocedure('public.enforce_payment_destination()'),
           to_regprocedure('private_sec.can_read_game_payment_settings(text,uuid)'),
           to_regprocedure('public.game_payee_id(text)'),
           to_regprocedure('private_sec.can_manage_game_payment_settings(text)'),
           to_regprocedure('private_sec.game_payee(text)')]::oid[], NULL));
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: % still call a helper this rollback drops (game_payee, game_payee_id, can_manage_game_payment_settings or can_read_game_payment_settings). They would fail at their next call. Roll back the migrations that created them first, or keep the helpers.', _got;
  END IF;
END
$defs$;

DROP TRIGGER IF EXISTS aa_payment_destination_trg ON public.payment_submissions;
DROP FUNCTION IF EXISTS public.enforce_payment_destination();

DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings
  FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings
  FOR UPDATE TO authenticated USING (host_id = auth.uid()) WITH CHECK (host_id = auth.uid());
DROP POLICY IF EXISTS "Host and linked players read payment settings" ON public.game_payment_settings;
CREATE POLICY "Host and linked players read payment settings" ON public.game_payment_settings
  FOR SELECT TO authenticated
  USING (
    host_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.join_requests jr
                WHERE jr.game_id = game_payment_settings.game_id AND jr.player_id = auth.uid() AND jr.status = 'approved')
    OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                WHERE ps.game_id = game_payment_settings.game_id AND ps.player_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.game_participants gp
                WHERE gp.game_id = game_payment_settings.game_id AND gp.user_id = auth.uid())
  );

-- Previous function bodies.
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

CREATE OR REPLACE FUNCTION public.enforce_approval_before_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _requires_approval boolean;
  _is_approved boolean;
BEGIN
  SELECT requires_approval INTO _requires_approval
  FROM public.game_payment_settings
  WHERE game_id = NEW.game_id AND host_id = NEW.host_id
  LIMIT 1;

  IF COALESCE(_requires_approval, false) THEN
    SELECT EXISTS (
      SELECT 1 FROM public.join_requests
      WHERE game_id = NEW.game_id
        AND player_id = NEW.player_id
        AND status = 'approved'
    ) INTO _is_approved;

    IF NOT _is_approved THEN
      RAISE EXCEPTION 'Host approval required before payment can be submitted for this game.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enforce_game_join_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.release_expired_payment_holds(_game_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.settle_paid_spot(_game text, _player uuid, _reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s record;
  g record;
  ps record;
  _phase text;
  _pct integer;
  _amount numeric(10, 2);
  _paid numeric;
  _who text;
  _rule_text text;
BEGIN
  SELECT * INTO s FROM public.payment_submissions
   WHERE game_id = _game AND player_id = _player AND status = 'verified' AND refund_status IS NULL
   ORDER BY submitted_at DESC LIMIT 1
   FOR UPDATE;
  IF s.id IS NULL THEN RETURN 'none'; END IF;

  SELECT id, title, date, host_id, cancel_cutoff_min INTO g FROM public.hosted_games WHERE id = _game;
  IF g.id IS NULL THEN RETURN 'none'; END IF;
  SELECT entry_fee, refund_rule, late_refund_pct INTO ps
    FROM public.game_payment_settings WHERE game_id = _game ORDER BY created_at DESC LIMIT 1;

  _phase := CASE
    WHEN now() >= g.date THEN 'started'
    WHEN COALESCE(g.cancel_cutoff_min, 0) > 0
         AND now() >= g.date - make_interval(mins => g.cancel_cutoff_min) THEN 'late'
    ELSE 'early'
  END;
  _pct := public.refund_pct_for(COALESCE(ps.refund_rule, 'until_cutoff'), COALESCE(ps.late_refund_pct, 0),
                                _reason, _phase);
  _paid := COALESCE(s.paid_amount, ps.entry_fee, 0);
  _amount := round(_paid * _pct / 100.0, 2);

  BEGIN
  PERFORM set_config('ballacity.refund_engine', 'on', true);
  UPDATE public.payment_submissions
     SET refund_pct = _pct,
         refund_amount = _amount,
         refund_status = CASE WHEN _amount > 0 THEN 'owed' ELSE 'kept' END,
         refund_reason = _reason,
         refund_settled_at = now(),
         -- A no-show still paid for a spot they held; the payment stays verified.
         status = CASE WHEN _reason = 'no_show' THEN status ELSE 'cancelled' END,
         cancellation_reason = CASE WHEN _reason = 'no_show' THEN cancellation_reason ELSE _reason END,
         cancelled_at = CASE WHEN _reason = 'no_show' THEN cancelled_at ELSE now() END
   WHERE id = s.id;
  PERFORM set_config('ballacity.refund_engine', 'off', true);
  EXCEPTION WHEN others THEN
    PERFORM set_config('ballacity.refund_engine', 'off', true);
    RAISE WARNING 'settle_paid_spot(%, %, %) failed: %', _game, _player, _reason, SQLERRM;
    RETURN 'failed';
  END;

  IF _paid <= 0 THEN RETURN 'settled'; END IF;

  SELECT display_name INTO _who FROM public.profiles WHERE id = _player;
  _rule_text := CASE
    WHEN _reason = 'game_cancelled' THEN 'the game was cancelled'
    WHEN _reason = 'no_show' THEN 'they were marked a no-show'
    WHEN _phase = 'early' THEN 'they cancelled before the cutoff'
    WHEN _phase = 'late' THEN 'they cancelled inside the cutoff'
    ELSE 'they cancelled after the start'
  END;

  IF _amount > 0 THEN
    -- The host gets one summary for a game they cancelled (see trigger below).
    IF _reason <> 'game_cancelled' THEN
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        g.host_id, 'payment_refund_owed',
        left('Refund owed · $' || _amount || ' to ' || COALESCE(_who, 'a player'), 200),
        g.title || ': ' || _rule_text || ', and your refund policy gives back ' || _pct ||
          '%. Send it in your payment app, then mark it refunded on the game''s Payments tab.',
        '/games/' || g.id
      );
    END IF;
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      _player, 'payment_refund_owed',
      left('Refund owed to you · $' || _amount, 200),
      g.title || ': the host owes you $' || _amount || ' under their refund policy. ' ||
        'ballaCity doesn''t hold money — the host sends it back directly in their payment app.',
      '/games/' || g.id
    );
    PERFORM public.notify_guardians_of(
      _player, 'payment_refund_owed',
      'Refund owed to ' || COALESCE(_who, 'your child') || ' · $' || _amount,
      g.title || ': the host owes ' || COALESCE(_who, 'your child') || ' $' || _amount ||
        ' under their refund policy. ballaCity doesn''t hold money — the host sends it back directly in their payment app.',
      '/games/' || g.id
    );
  ELSE
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      _player, 'payment_refund_kept',
      left('Fee not refunded · ' || g.title, 200),
      CASE WHEN _reason = 'no_show'
           THEN 'You were marked a no-show, and the host''s policy keeps the fee.'
           WHEN COALESCE(ps.refund_rule, 'until_cutoff') = 'none'
           THEN 'This game''s fee is non-refundable, so the host keeps it.'
           ELSE 'Under the host''s refund policy, a cancellation this close to the start isn''t refunded.' END,
      '/games/' || g.id
    );
    PERFORM public.notify_guardians_of(
      _player, 'payment_refund_kept',
      'Fee not refunded · ' || COALESCE(_who, 'your child') || ' · ' || g.title,
      CASE WHEN _reason = 'no_show'
           THEN COALESCE(_who, 'Your child') || ' was marked a no-show, and the host''s policy keeps the fee.'
           WHEN COALESCE(ps.refund_rule, 'until_cutoff') = 'none'
           THEN 'This game''s fee is non-refundable, so the host keeps it.'
           ELSE 'Under the host''s refund policy, a cancellation this close to the start isn''t refunded.' END,
      '/games/' || g.id
    );
  END IF;
  RETURN 'settled';
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_game_refund_terms(_game_id text)
 RETURNS TABLE(refund_rule text, late_refund_pct integer, refund_policy text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.refund_rule, s.late_refund_pct, s.refund_policy
  FROM public.game_payment_settings s
  JOIN public.hosted_games g ON g.id = s.game_id
  WHERE s.game_id = _game_id
    AND (
      g.is_private = false
      OR g.host_id = auth.uid()
      OR public.is_game_participant(g.id, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.join_requests jr
        WHERE jr.game_id = g.id AND jr.player_id = auth.uid()
      )
    )
  ORDER BY s.created_at DESC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.get_game_host_payment_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
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

DROP FUNCTION IF EXISTS private_sec.can_read_game_payment_settings(text, uuid);
DROP FUNCTION IF EXISTS public.game_payee_id(text);
DROP FUNCTION IF EXISTS private_sec.can_manage_game_payment_settings(text);
DROP FUNCTION IF EXISTS private_sec.game_payee(text);
COMMIT;
