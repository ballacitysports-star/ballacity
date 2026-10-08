-- Refund notices also reach a child's guardians.
--
-- A child's refund notices (owed, kept, sent) went only to the child's own
-- account, which a parent may never open. Copy them to the child's verified
-- guardians (and the account that manages a managed child), worded for the
-- parent. The child still gets their own notice, unchanged.

CREATE OR REPLACE FUNCTION public.notify_guardians_of(
  _player uuid, _type text, _title text, _body text, _link text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT x.g, _type, left(_title, 200), _body, _link
    FROM (
      SELECT parent_user_id AS g FROM public.guardian_links
       WHERE child_user_id = _player AND status = 'active' AND verified_at IS NOT NULL
      UNION
      SELECT managed_by FROM public.managed_accounts WHERE child_user_id = _player
    ) x
   WHERE x.g IS NOT NULL AND x.g <> _player;
$$;
REVOKE ALL ON FUNCTION public.notify_guardians_of(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;

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
$$;
REVOKE ALL ON FUNCTION public.settle_paid_spot(text, uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_refund_sent(_submission uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  _title text;
  _who text;
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
  SELECT display_name INTO _who FROM public.profiles WHERE id = s.player_id;
  PERFORM public.notify_guardians_of(
    s.player_id, 'payment_refunded',
    'Refund sent · $' || s.refund_amount || ' for ' || COALESCE(_who, 'your child'),
    COALESCE(_title, 'Your child''s game') || ': the host says they sent ' || COALESCE(_who, 'your child') ||
      '''s $' || s.refund_amount || ' refund. Check your payment app; if it hasn''t arrived, message the host.',
    '/games/' || s.game_id
  );
END;
$$;
REVOKE ALL ON FUNCTION public.mark_refund_sent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_refund_sent(uuid) TO authenticated;
