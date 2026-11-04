-- PAY-1: payment-path fixes found by independent review (payments are NOT enabled or activated by this migration).
--  1. A guardian payment manager (the payee of a minor-hosted game) received no payment notifications: can_notify had no payer/payee relation.
--     Added for adults and minors alike: the payer and the game's current payee, about a live payment or join request.
--  2. Refunds owed on a minor-hosted paid game notified the host, not the payee who holds the money. Now the current payee (the host when the host
--     is the payee).
--  3. A minor host could not save settings for a FREE game (the payee is NULL when no manager is needed), so every free minor-hosted game was
--     request-to-join. The real host may now write settings with entry_fee 0; paid settings still need the payee.
--  4. payment_submissions: the host_id stored on a submission could still read and verify it after the payee changed or a guardian link was revoked.
--     Reading needs the stored host to be the current payee or the game's host; verifying needs the current payee.
--     get_game_host_payment_methods answered for private games to anyone with the ids; now only for a visible listing or someone involved.
-- Replaces (definitions taken from the release stack's final versions): can_notify (R7), settle_paid_spot, settle_on_game_cancelled,
-- get_game_host_payment_methods (PRIV-2B). Forward-fix only.

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.game_payee(text)') IS NULL OR to_regprocedure('private_sec.messaging_connection(uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.can_manage_game_payment_settings(text)') IS NULL THEN
    RAISE EXCEPTION 'PAY-1: a required earlier release migration has not been applied';
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION private_sec.payment_relation(_a uuid, _b uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _a IS NOT NULL AND _b IS NOT NULL AND _a <> _b AND (
    EXISTS (SELECT 1 FROM public.payment_submissions ps
             WHERE ps.submitted_at > now() - interval '120 days'
               AND ((ps.player_id = _a AND private_sec.game_payee(ps.game_id) = _b) OR (ps.player_id = _b AND private_sec.game_payee(ps.game_id) = _a)))
    OR EXISTS (SELECT 1 FROM public.join_requests jr
                WHERE jr.status IN ('pending', 'approved') AND jr.created_at > now() - interval '90 days'
                  AND ((jr.player_id = _a AND private_sec.game_payee(jr.game_id) = _b) OR (jr.player_id = _b AND private_sec.game_payee(jr.game_id) = _a))))
$$;
REVOKE ALL ON FUNCTION private_sec.payment_relation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.payment_relation(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_notify(_caller uuid, _target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _caller IS NOT NULL AND _target IS NOT NULL AND (
      _caller = _target
      OR (
        -- not an oracle: a signed-in caller who is neither party learns nothing about the pair (service role has no auth.uid())
        (auth.uid() IS NULL OR auth.uid() IN (_caller, _target))
        AND NOT public.blocks_exist_between(_caller, _target)
        AND CASE
          -- a person who is not a confirmed adult is involved: an authorized context that the guardian's controls allow, or a host dealing
          -- with a live join request (pending or approved, last 90 days); a rejected or old request is not a relationship
          WHEN COALESCE(public.age_cohort_of(_caller), 'unknown') <> 'adult' OR COALESCE(public.age_cohort_of(_target), 'unknown') <> 'adult' THEN
            ((private_sec.messaging_connection(_caller, _target))
              AND private_sec.messaging_controls_block(_caller, _target) IS NULL)
            -- PAY-1: the payer and the game's current payee (a guardian payment manager included) about a live payment
            OR private_sec.payment_relation(_caller, _target)
            -- a host dealing with a live join request: host to player only; a player may notify a host only when that host is a confirmed adult
            OR EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE jr.status IN ('pending', 'approved') AND jr.created_at > now() - interval '90 days'
                          AND ((jr.host_id = _caller AND jr.player_id = _target)
                               OR (jr.host_id = _target AND jr.player_id = _caller AND public.age_cohort_of(_target) = 'adult')))
          ELSE
            private_sec.payment_relation(_caller, _target)
            OR EXISTS (SELECT 1 FROM public.conversation_participants a
                      JOIN public.conversation_participants b ON b.conversation_id = a.conversation_id
                     WHERE a.user_id = _caller AND b.user_id = _target)
            OR EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE (jr.host_id = _caller AND jr.player_id = _target) OR (jr.host_id = _target AND jr.player_id = _caller))
            OR EXISTS (SELECT 1 FROM public.game_participants gp JOIN public.hosted_games hg ON hg.id = gp.game_id
                        WHERE (hg.host_id = _caller AND gp.user_id = _target) OR (hg.host_id = _target AND gp.user_id = _caller))
            OR EXISTS (SELECT 1 FROM public.game_participants a JOIN public.game_participants b ON b.game_id = a.game_id
                        WHERE a.user_id = _caller AND b.user_id = _target)
            OR EXISTS (SELECT 1 FROM public.availability_contact_requests acr
                        WHERE (acr.from_user_id = _caller AND acr.to_user_id = _target) OR (acr.from_user_id = _target AND acr.to_user_id = _caller))
        END
      )
    );
$function$

;

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
    FROM public.game_payment_settings WHERE game_id = _game AND host_id = private_sec.game_payee(_game) ORDER BY created_at DESC LIMIT 1;

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
        COALESCE(private_sec.game_payee(g.id), g.host_id), 'payment_refund_owed',   -- PAY-1: the person who holds the money
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
$function$

;

CREATE OR REPLACE FUNCTION public.settle_on_game_cancelled()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE(private_sec.game_payee(NEW.id), NEW.host_id), 'payment_refund_owed',   -- PAY-1: the payee
      left(_n || CASE WHEN _n = 1 THEN ' refund' ELSE ' refunds' END || ' owed · $' || _total, 200),
      NEW.title || ' was cancelled, so everyone who paid gets a full refund. Send them in your payment app, then mark each one refunded on the game''s Payments tab.',
      '/games/' || NEW.id
    );
  END IF;
  RETURN NEW;
END;
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
BEGIN
  IF auth.uid() IS NULL THEN RETURN; END IF;
  IF public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN RETURN; END IF;
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN RETURN; END IF;
  -- PAY-1: only someone who can see the game (a public listing) or is involved with it (host, payee, requester, participant, or their guardian)
  IF NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id
                  AND ((NOT COALESCE(g.is_private, false) AND g.hidden_at IS NULL)
                       OR g.host_id = auth.uid() OR auth.uid() = _host_id
                       OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id
                                   AND (jr.player_id = auth.uid() OR public.is_guardian_of(auth.uid(), jr.player_id)))
                       OR EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = g.id
                                   AND (gp.user_id = auth.uid() OR public.is_guardian_of(auth.uid(), gp.user_id))))) THEN
    RETURN;
  END IF;

  SELECT * INTO _settings FROM public.game_payment_settings gps
   WHERE gps.game_id = _game_id AND gps.host_id = _host_id
   ORDER BY gps.created_at DESC LIMIT 1;
  IF _settings.id IS NULL THEN RETURN; END IF;

  RETURN QUERY
    SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
    FROM public.host_payment_methods hpm
    WHERE hpm.host_id = _host_id
      AND hpm.is_enabled = true
      AND (COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0 OR hpm.id = ANY(_settings.accepted_method_ids));
END;
$function$

;


CREATE OR REPLACE FUNCTION private_sec.is_game_host(_game text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game AND g.host_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION private_sec.is_game_host(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.is_game_host(text) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION private_sec.is_game_host_without_payee(_game text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private_sec.is_game_host(_game) AND private_sec.game_payee(_game) IS NULL
$$;
REVOKE ALL ON FUNCTION private_sec.is_game_host_without_payee(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.is_game_host_without_payee(text) TO authenticated, service_role;

-- 3. free-game settings for a minor host
DROP POLICY IF EXISTS "Hosts manage own game payment settings (insert)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (insert)" ON public.game_payment_settings FOR INSERT TO authenticated
  WITH CHECK (host_id = auth.uid() AND (private_sec.can_manage_game_payment_settings(game_id)
              OR (COALESCE(entry_fee, 0) = 0 AND private_sec.is_game_host_without_payee(game_id))));
DROP POLICY IF EXISTS "Hosts manage own game payment settings (update)" ON public.game_payment_settings;
CREATE POLICY "Hosts manage own game payment settings (update)" ON public.game_payment_settings FOR UPDATE TO authenticated
  USING (host_id = auth.uid())
  WITH CHECK (host_id = auth.uid() AND (private_sec.can_manage_game_payment_settings(game_id)
              OR (COALESCE(entry_fee, 0) = 0 AND private_sec.is_game_host_without_payee(game_id))));

-- 4. submissions follow the current payee
DROP POLICY IF EXISTS "Hosts see submissions for their games" ON public.payment_submissions;
CREATE POLICY "Hosts see submissions for their games" ON public.payment_submissions FOR SELECT TO authenticated
  USING (host_id = auth.uid() AND (private_sec.can_manage_game_payment_settings(game_id) OR private_sec.is_game_host(game_id)));
DROP POLICY IF EXISTS "Hosts update submissions for their games" ON public.payment_submissions;
CREATE POLICY "Hosts update submissions for their games" ON public.payment_submissions FOR UPDATE TO authenticated
  USING (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id))
  WITH CHECK (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id));

-- SEC-2 interplay: can_notify is a wrapped helper; re-wrap when the containment migration is present.
DO $rewrap$ BEGIN
  IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF;
END $rewrap$;
