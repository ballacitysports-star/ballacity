-- Refund policies for paid games, tryouts/camps and trainer sessions.
--
-- ballaCity never moves money: players pay hosts directly. A refund policy is
-- the host's rule for what a player gets back, and for games — where payment
-- is recorded in payment_submissions — the app works out what's owed, tells
-- both sides, and tracks it until the host marks it refunded.
--
-- Rules (the time frame is the event's cancellation cutoff, cancel_cutoff_min):
--   until_cutoff  full refund before the cutoff; late cancels and no-shows get
--                 late_refund_pct (default 0, i.e. the fee is kept)
--   before_start  full refund for any cancel before start; no-shows get
--                 late_refund_pct
--   none          non-refundable
-- A host cancelling the whole game always owes everyone a full refund.

-- 1) Policy settings, per game (with its fee), per tryout/camp post, per trainer.
DO $cols$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['game_payment_settings', 'team_posts', 'teams'] LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS refund_rule text NOT NULL DEFAULT %L', t, 'until_cutoff');
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS late_refund_pct integer NOT NULL DEFAULT 0', t);
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_refund_rule_chk');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (refund_rule IN (''until_cutoff'', ''before_start'', ''none''))',
      t, t || '_refund_rule_chk');
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', t, t || '_late_refund_pct_chk');
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (late_refund_pct BETWEEN 0 AND 100)',
      t, t || '_late_refund_pct_chk');
  END LOOP;
END
$cols$;

-- 2) Refund tracking on recorded game payments.
ALTER TABLE public.payment_submissions
  ADD COLUMN IF NOT EXISTS refund_status text,
  ADD COLUMN IF NOT EXISTS refund_pct integer,
  ADD COLUMN IF NOT EXISTS refund_amount numeric(10, 2),
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refund_settled_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE public.payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_refund_status_chk;
ALTER TABLE public.payment_submissions ADD CONSTRAINT payment_submissions_refund_status_chk
  CHECK (refund_status IS NULL OR refund_status IN ('owed', 'refunded', 'kept'));
ALTER TABLE public.payment_submissions DROP CONSTRAINT IF EXISTS payment_submissions_refund_reason_chk;
ALTER TABLE public.payment_submissions ADD CONSTRAINT payment_submissions_refund_reason_chk
  CHECK (refund_reason IS NULL OR refund_reason IN ('player_cancelled', 'no_show', 'game_cancelled'));

-- 3) The rule itself. _phase: 'early' (before the cutoff), 'late' (inside it),
-- 'started' (at or after start).
CREATE OR REPLACE FUNCTION public.refund_pct_for(_rule text, _late_pct integer, _reason text, _phase text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _reason = 'game_cancelled' THEN 100
    WHEN _rule = 'none' THEN 0
    WHEN _reason = 'no_show' THEN COALESCE(_late_pct, 0)
    WHEN _rule = 'before_start' THEN CASE WHEN _phase = 'started' THEN COALESCE(_late_pct, 0) ELSE 100 END
    ELSE CASE WHEN _phase = 'early' THEN 100 ELSE COALESCE(_late_pct, 0) END
  END;
$$;

-- Players may cancel or dispute their own payment but not touch evidence or
-- review fields. The refund engine below writes refund fields while the
-- player is the signed-in user, so it marks itself and is let through.
-- (Same function as before plus the first IF.)
CREATE OR REPLACE FUNCTION public.guard_payment_player_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  baseline public.payment_submissions;
BEGIN
  IF COALESCE(current_setting('ballacity.refund_engine', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL
     OR auth.uid() <> OLD.player_id
     OR auth.uid() = OLD.host_id THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'pending' THEN
    RETURN NEW;
  END IF;

  baseline := OLD;
  baseline.status := NEW.status;
  baseline.notes := NEW.notes;
  baseline.cancellation_reason := NEW.cancellation_reason;
  baseline.cancelled_at := NEW.cancelled_at;
  baseline.dispute_reason := NEW.dispute_reason;
  baseline.disputed_at := NEW.disputed_at;
  baseline.disputed_by := NEW.disputed_by;

  IF to_jsonb(NEW) IS DISTINCT FROM to_jsonb(baseline) THEN
    RAISE EXCEPTION 'PAYMENT_FIELD_FORBIDDEN: payment evidence and host review fields cannot be changed while cancelling or disputing.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;

-- 4) Settle a player's verified payment for a game: work out the refund
-- under the game's policy, record it, and tell the player (and the host when
-- a refund is owed). Idempotent: a payment is settled once.
--
-- Returns 'settled', 'none' (nothing to settle) or 'failed'. It never raises:
-- a refund problem must not stop a player leaving or a host cancelling, so on
-- failure it logs a warning and the caller carries on as before.
CREATE OR REPLACE FUNCTION public.settle_paid_spot(_game text, _player uuid, _reason text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  END IF;
  RETURN 'settled';
END;
$$;
REVOKE ALL ON FUNCTION public.settle_paid_spot(text, uuid, text) FROM PUBLIC, anon, authenticated;

-- 5a) A player leaving their own spot settles their payment. Host removals
-- and automatic spot-hold releases are not the player cancelling.
CREATE OR REPLACE FUNCTION public.settle_on_player_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  IF TG_TABLE_NAME = 'game_participants' THEN
    _uid := OLD.user_id;
  ELSE
    IF OLD.status <> 'approved' THEN RETURN OLD; END IF;
    _uid := OLD.player_id;
  END IF;
  IF auth.uid() IS NULL OR auth.uid() <> _uid THEN RETURN OLD; END IF;
  IF COALESCE(current_setting('ballacity.system_release', true), '') = 'on' THEN RETURN OLD; END IF;
  PERFORM public.settle_paid_spot(OLD.game_id, _uid, 'player_cancelled');
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_on_player_leave() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_participants_settle_refund ON public.game_participants;
CREATE TRIGGER game_participants_settle_refund
  AFTER DELETE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.settle_on_player_leave();

DROP TRIGGER IF EXISTS join_requests_settle_refund ON public.join_requests;
CREATE TRIGGER join_requests_settle_refund
  AFTER DELETE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.settle_on_player_leave();

-- 5b) A verified payment is a record of money paid; a player can't erase it.
-- Older app versions delete it when the player leaves: settle it instead and
-- keep the row.
CREATE OR REPLACE FUNCTION public.keep_verified_payment_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'verified' AND auth.uid() IS NOT NULL AND auth.uid() = OLD.player_id
     AND auth.uid() IS DISTINCT FROM OLD.host_id THEN
    -- Keep the record unless settling failed; then behave as before.
    IF public.settle_paid_spot(OLD.game_id, OLD.player_id, 'player_cancelled') <> 'failed' THEN
      RETURN NULL;
    END IF;
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION public.keep_verified_payment_on_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payment_submissions_keep_verified ON public.payment_submissions;
CREATE TRIGGER payment_submissions_keep_verified
  BEFORE DELETE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.keep_verified_payment_on_delete();

-- 5c) No-shows: marking a paid player absent applies the no-show share;
-- un-marking it (host corrected attendance) undoes an unpaid settlement.
CREATE OR REPLACE FUNCTION public.settle_on_no_show()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.attended IS FALSE AND OLD.attended IS DISTINCT FROM FALSE THEN
    PERFORM public.settle_paid_spot(NEW.game_id, NEW.user_id, 'no_show');
  ELSIF OLD.attended IS FALSE AND NEW.attended IS DISTINCT FROM FALSE THEN
    PERFORM set_config('ballacity.refund_engine', 'on', true);
    UPDATE public.payment_submissions
       SET refund_status = NULL, refund_pct = NULL, refund_amount = NULL,
           refund_reason = NULL, refund_settled_at = NULL
     WHERE game_id = NEW.game_id AND player_id = NEW.user_id
       AND refund_reason = 'no_show' AND refund_status IN ('owed', 'kept');
    PERFORM set_config('ballacity.refund_engine', 'off', true);
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_on_no_show() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_participants_settle_no_show ON public.game_participants;
CREATE TRIGGER game_participants_settle_no_show
  AFTER UPDATE OF attended ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.settle_on_no_show();

-- 5d) Host cancels the game: everyone who paid is owed a full refund. The
-- host gets one summary.
CREATE OR REPLACE FUNCTION public.settle_on_game_cancelled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p record;
  _n integer := 0;
  _total numeric := 0;
BEGIN
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN RETURN NEW; END IF;
  FOR p IN
    SELECT DISTINCT player_id FROM public.payment_submissions
     WHERE game_id = NEW.id AND status = 'verified' AND refund_status IS NULL
  LOOP
    PERFORM public.settle_paid_spot(NEW.id, p.player_id, 'game_cancelled');
  END LOOP;
  SELECT count(*), COALESCE(sum(refund_amount), 0) INTO _n, _total
    FROM public.payment_submissions
   WHERE game_id = NEW.id AND refund_reason = 'game_cancelled' AND refund_status = 'owed';
  IF _n > 0 AND NEW.host_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      NEW.host_id, 'payment_refund_owed',
      left(_n || CASE WHEN _n = 1 THEN ' refund' ELSE ' refunds' END || ' owed · $' || _total, 200),
      NEW.title || ' was cancelled, so everyone who paid gets a full refund. Send them in your payment app, then mark each one refunded on the game''s Payments tab.',
      '/games/' || NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.settle_on_game_cancelled() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS hosted_games_settle_refunds ON public.hosted_games;
CREATE TRIGGER hosted_games_settle_refunds
  AFTER UPDATE OF cancelled_at ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION public.settle_on_game_cancelled();

-- 6) The host confirms they sent a refund.
CREATE OR REPLACE FUNCTION public.mark_refund_sent(_submission uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  _title text;
BEGIN
  SELECT * INTO s FROM public.payment_submissions WHERE id = _submission FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Payment not found.' USING ERRCODE = 'P0001'; END IF;
  IF s.host_id IS DISTINCT FROM auth.uid() AND NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Only the host can mark a refund as sent.' USING ERRCODE = '42501';
  END IF;
  IF s.refund_status IS DISTINCT FROM 'owed' THEN RETURN; END IF;

  PERFORM set_config('ballacity.refund_engine', 'on', true);
  UPDATE public.payment_submissions
     SET refund_status = 'refunded', refunded_at = now()
   WHERE id = _submission;
  PERFORM set_config('ballacity.refund_engine', 'off', true);

  SELECT title INTO _title FROM public.hosted_games WHERE id = s.game_id;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    s.player_id, 'payment_refunded',
    left('Refund sent · $' || s.refund_amount, 200),
    COALESCE(_title, 'Your game') || ': the host says they sent your $' || s.refund_amount ||
      ' refund. Check your payment app; if it hasn''t arrived, message the host.',
    '/games/' || s.game_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mark_refund_sent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_refund_sent(uuid) TO authenticated;

-- 7) Trainer sessions: the cancel notice now states what the trainer's
-- refund policy says. Session fees aren't recorded in the app, so it gives
-- the share, not an amount. (Same as 20261008120000 plus the policy line.)
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
  _phase text;
  _pct integer;
BEGIN
  IF OLD.status = 'accepted' AND NEW.status = 'cancelled' AND auth.uid() = OLD.from_user_id THEN
    SELECT display_name INTO _who FROM public.profiles WHERE id = OLD.from_user_id;
    SELECT timezone, cancel_cutoff_min, refund_rule, late_refund_pct
      INTO _t FROM public.teams WHERE id = OLD.trainer_id;

    IF OLD.preferred_date IS NOT NULL AND OLD.preferred_start_time IS NOT NULL THEN
      BEGIN
        _start := (OLD.preferred_date + OLD.preferred_start_time)
                  AT TIME ZONE COALESCE(NULLIF(_t.timezone, ''), 'America/New_York');
      EXCEPTION WHEN others THEN
        _start := NULL;
      END;
      _late := public.record_late_cancellation(OLD.from_user_id, 'session', OLD.id::text,
                                               OLD.trainer_id, OLD.to_user_id,
                                               COALESCE(OLD.session_type, 'Session'),
                                               _start, _t.cancel_cutoff_min);
    END IF;

    _phase := CASE
      WHEN _start IS NULL THEN 'early'
      WHEN now() >= _start THEN 'started'
      WHEN COALESCE(_t.cancel_cutoff_min, 0) > 0
           AND now() >= _start - make_interval(mins => _t.cancel_cutoff_min) THEN 'late'
      ELSE 'early'
    END;
    _pct := public.refund_pct_for(COALESCE(_t.refund_rule, 'until_cutoff'),
                                  COALESCE(_t.late_refund_pct, 0), 'player_cancelled', _phase);

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
        'That time is open again. ' ||
        CASE WHEN _pct = 100 THEN 'Your refund policy: refund any fee they paid in full.'
             WHEN _pct = 0 THEN 'Your refund policy: you keep any fee they paid.'
             ELSE 'Your refund policy: refund ' || _pct || '% of any fee they paid.' END,
      '/trainers/' || OLD.trainer_id
    );
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.notify_trainer_session_cancelled() FROM PUBLIC, anon, authenticated;
