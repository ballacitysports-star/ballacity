-- Payment health: how often paid games go wrong, in numbers a superadmin can read.
--
-- BallaCity does not hold game fees (players pay hosts directly), so whether a
-- protected-payments / escrow product is worth building depends on how often a
-- host cancels after being paid, a player disputes a payment, or a refund the
-- policy says is owed goes unsent. This function counts exactly those from the
-- records the app already keeps. It only reads; it changes no payment data.
--
-- Superadmin only: it is checked here, not just in the admin page, because the
-- result names hosts and the page is not an authorization boundary.
CREATE OR REPLACE FUNCTION public.payment_health_metrics(_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _since timestamptz;
  _subs jsonb;
  _by_type jsonb;
  _refunds jsonb;
  _cancel jsonb;
  _hosts jsonb;
BEGIN
  IF NOT COALESCE(public.is_superadmin(auth.uid()), false) THEN
    RAISE EXCEPTION 'SUPERADMIN_ONLY' USING ERRCODE = '42501';
  END IF;

  _days := LEAST(GREATEST(COALESCE(_days, 90), 1), 730);
  _since := now() - make_interval(days => _days);

  -- Submissions made in the window. "disputed" counts any payment that was ever
  -- disputed (status moves on once it is resolved, disputed_at stays).
  SELECT jsonb_build_object(
           'total', count(*),
           'verified', count(*) FILTER (WHERE status = 'verified'),
           'pending', count(*) FILTER (WHERE status = 'pending'),
           'rejected', count(*) FILTER (WHERE status = 'rejected'),
           'cancelled', count(*) FILTER (WHERE status = 'cancelled'),
           'disputed', count(*) FILTER (WHERE disputed_at IS NOT NULL),
           'dispute_rate_pct', round(100.0 * count(*) FILTER (WHERE disputed_at IS NOT NULL)
                                     / NULLIF(count(*), 0), 1),
           'verified_dollars', COALESCE(sum(paid_amount) FILTER (WHERE status = 'verified'), 0)
         )
    INTO _subs
    FROM public.payment_submissions
   WHERE submitted_at >= _since;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.submissions DESC), '[]'::jsonb)
    INTO _by_type
    FROM (
      SELECT COALESCE(payment_type, 'unknown') AS payment_type,
             count(*) AS submissions,
             count(*) FILTER (WHERE status = 'verified') AS verified,
             count(*) FILTER (WHERE disputed_at IS NOT NULL) AS disputed
        FROM public.payment_submissions
       WHERE submitted_at >= _since
       GROUP BY 1
    ) x;

  -- Refunds. Outstanding ones count whenever they were created: a refund owed
  -- for weeks matters more than one decided yesterday. refund_settled_at is when
  -- the policy worked the refund out, not when the host sent it.
  SELECT jsonb_build_object(
           'owed_now_count', count(*) FILTER (WHERE refund_status = 'owed'),
           'owed_now_dollars', COALESCE(sum(refund_amount) FILTER (WHERE refund_status = 'owed'), 0),
           'owed_overdue_count', count(*) FILTER (
             WHERE refund_status = 'owed' AND refund_settled_at < now() - interval '3 days'),
           'owed_overdue_dollars', COALESCE(sum(refund_amount) FILTER (
             WHERE refund_status = 'owed' AND refund_settled_at < now() - interval '3 days'), 0),
           'sent_in_window', count(*) FILTER (
             WHERE refund_status = 'refunded' AND refunded_at >= _since),
           'kept_in_window', count(*) FILTER (
             WHERE refund_status = 'kept' AND refund_settled_at >= _since)
         )
    INTO _refunds
    FROM public.payment_submissions
   WHERE refund_status IS NOT NULL;

  -- Host cancellations after taking money. A game cancelled by its host turns
  -- each verified payment into a cancelled one with reason 'game_cancelled'.
  SELECT jsonb_build_object(
           'games_that_took_payment', (
             SELECT count(DISTINCT game_id) FROM public.payment_submissions
              WHERE submitted_at >= _since AND status IN ('verified', 'cancelled')),
           'games_cancelled_after_payment', count(DISTINCT game_id),
           'players_affected', count(*),
           'dollars_affected', COALESCE(sum(paid_amount), 0)
         )
    INTO _cancel
    FROM public.payment_submissions
   WHERE cancellation_reason = 'game_cancelled' AND cancelled_at >= _since;

  _cancel := _cancel || jsonb_build_object(
    'rate_pct', round(100.0 * (_cancel->>'games_cancelled_after_payment')::numeric
                      / NULLIF((_cancel->>'games_that_took_payment')::numeric, 0), 1));

  -- Hosts with more than one problem, worst first. Names are for the admin only.
  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.problems DESC, x.host_id), '[]'::jsonb)
    INTO _hosts
    FROM (
      SELECT h.host_id,
             p.display_name,
             h.cancelled_games,
             h.disputes,
             h.overdue_refunds,
             h.cancelled_games + h.disputes + h.overdue_refunds AS problems
        FROM (
          SELECT host_id,
                 count(DISTINCT game_id) FILTER (
                   WHERE cancellation_reason = 'game_cancelled' AND cancelled_at >= _since) AS cancelled_games,
                 count(*) FILTER (WHERE disputed_at >= _since) AS disputes,
                 count(*) FILTER (
                   WHERE refund_status = 'owed' AND refund_settled_at < now() - interval '3 days') AS overdue_refunds
            FROM public.payment_submissions
           GROUP BY host_id
        ) h
        LEFT JOIN public.profiles p ON p.id = h.host_id
       WHERE h.cancelled_games + h.disputes + h.overdue_refunds >= 2
       ORDER BY problems DESC, h.host_id
       LIMIT 10
    ) x;

  RETURN jsonb_build_object(
    'days', _days,
    'since', _since,
    'submissions', _subs,
    'by_type', _by_type,
    'refunds', _refunds,
    'host_cancellations', _cancel,
    'repeat_hosts', _hosts
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payment_health_metrics(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.payment_health_metrics(integer) TO authenticated, service_role;
