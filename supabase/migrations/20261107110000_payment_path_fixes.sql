-- PAY-1: payment-path fixes found by independent review (payments are NOT enabled or activated by this migration).
--  1. Guardian payment managers received no payment notifications. can_notify gains the ONE-WAY private_sec.payer_to_payee(payer, payee):
--     an actual payment submission, payer to the adult who holds or now manages it (inside the guardian-controls check for minors).
--  2. Refund notices go to each submission's stored host_id (the person who was paid), one summary per holder on cancellation; that adult
--     keeps read access to rows whose refund is owed.
--  3. A minor host with no payee can save FREE settings for a FREE listing; private_sec.game_settings_holder makes that row readable and
--     used by the join gate. Payment destinations still use game_payee only.
--  4. payment_submissions: reading needs the current payee manager (or an owed refund held by that adult); verifying needs the current payee.
--     get_game_host_payment_methods answers only for a visible listing or an involved caller (host, payee, APPROVED requester, participant,
--     or their guardian).
-- Replaces (definitions taken from the release stack's final versions): can_notify (R7), settle_paid_spot, settle_on_game_cancelled,
-- get_game_host_payment_methods (PRIV-2B). Forward-fix only.

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.game_payee(text)') IS NULL OR to_regprocedure('private_sec.messaging_connection(uuid,uuid)') IS NULL
     OR to_regprocedure('private_sec.can_manage_game_payment_settings(text)') IS NULL THEN
    RAISE EXCEPTION 'PAY-1: a required earlier release migration has not been applied';
  END IF;
END $guard$;

-- Review round 4: the relation is DIRECTIONAL (payer -> money holder) and comes only from an actual payment submission the payer made.
-- A join request alone is not a payment relation; the payee never gains a way to reach a minor through it (payee -> payer notices
-- about a payment are written by the server's own definer functions, not through can_notify).
CREATE OR REPLACE FUNCTION private_sec.payer_to_payee(_payer uuid, _payee uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _payer IS NOT NULL AND _payee IS NOT NULL AND _payer <> _payee
     AND public.age_cohort_of(_payee) = 'adult'
     AND EXISTS (SELECT 1 FROM public.payment_submissions ps
                  WHERE ps.player_id = _payer AND ps.submitted_at > now() - interval '120 days'
                    AND (ps.host_id = _payee OR private_sec.game_payee(ps.game_id) = _payee))
$$;
REVOKE ALL ON FUNCTION private_sec.payer_to_payee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.payer_to_payee(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_notify(_caller uuid, _target uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- R7 final (review round 4, ec0b771e) plus PAY-1's one-way payer -> payee relation, inside the guardian-controls check for minors.
  SELECT
    _caller IS NOT NULL AND _target IS NOT NULL AND (
      _caller = _target
      OR (
        -- not an oracle: a signed-in caller who is neither party learns nothing about the pair (service role has no auth.uid())
        (auth.uid() IS NULL OR auth.uid() IN (_caller, _target))
        AND NOT public.blocks_exist_between(_caller, _target)
        AND CASE
          -- a person who is not a confirmed adult is involved: the guardian's controls first, then an authorized context, or a host dealing
          -- with a live join request (pending or approved, last 90 days); a rejected or old request is not a relationship
          WHEN COALESCE(public.age_cohort_of(_caller), 'unknown') <> 'adult' OR COALESCE(public.age_cohort_of(_target), 'unknown') <> 'adult' THEN
            private_sec.messaging_controls_block(_caller, _target) IS NULL
            AND (
              private_sec.messaging_connection(_caller, _target)
              -- PAY-1: a payer may notify the adult who holds (or now manages) their payment; never the reverse
              OR private_sec.payer_to_payee(_caller, _target)
              -- a host dealing with a live join request: host to player only; a player may notify a host only when that host is a confirmed
              -- adult; an under-13 player's request counts only once a verified guardian approved it (under-13 contact stays guardian-mediated)
              OR EXISTS (SELECT 1 FROM public.join_requests jr
                          WHERE jr.status IN ('pending', 'approved') AND jr.created_at > now() - interval '90 days'
                            AND ((jr.host_id = _caller AND jr.player_id = _target)
                                 OR (jr.host_id = _target AND jr.player_id = _caller AND public.age_cohort_of(_target) = 'adult'))
                            AND (COALESCE(public.age_cohort_of(jr.player_id), 'unknown') <> 'child_under_13'
                                 OR (jr.guardian_approved_at IS NOT NULL AND public.is_guardian_of(jr.guardian_approved_by, jr.player_id))))
            )
          ELSE
            private_sec.payer_to_payee(_caller, _target)
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
    FROM public.game_payment_settings WHERE game_id = _game AND host_id = s.host_id ORDER BY created_at DESC LIMIT 1;  -- PAY-1: the terms of the person who was paid

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
        s.host_id, 'payment_refund_owed',   -- PAY-1: the person who received the money (never a minor host who was not paid)
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
  h record;
BEGIN
  IF OLD.cancelled_at IS NOT NULL OR NEW.cancelled_at IS NULL THEN RETURN NEW; END IF;
  FOR p IN
    SELECT DISTINCT player_id FROM public.payment_submissions
     WHERE game_id = NEW.id AND status = 'verified' AND refund_status IS NULL
  LOOP
    PERFORM public.settle_paid_spot(NEW.id, p.player_id, 'game_cancelled');
  END LOOP;
  -- PAY-1: one summary per person who actually received money for this game (the stored payee of each submission)
  FOR h IN
    SELECT ps.host_id AS holder, count(*) AS n, COALESCE(sum(ps.refund_amount), 0) AS total
      FROM public.payment_submissions ps
     WHERE ps.game_id = NEW.id AND ps.refund_reason = 'game_cancelled' AND ps.refund_status = 'owed' AND ps.host_id IS NOT NULL
     GROUP BY ps.host_id
  LOOP
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      h.holder, 'payment_refund_owed',
      left(h.n || CASE WHEN h.n = 1 THEN ' refund' ELSE ' refunds' END || ' owed · $' || h.total, 200),
      NEW.title || ' was cancelled, so everyone who paid gets a full refund. Send them in your payment app, then mark each one refunded on the game''s Payments tab.',
      '/games/' || NEW.id
    );
  END LOOP;
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
  -- PAY-1: only someone who can see the game (a public listing) or is involved with it (host, payee, approved requester, participant, or their guardian)
  IF NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id
                  AND ((NOT COALESCE(g.is_private, false) AND g.hidden_at IS NULL)
                       OR g.host_id = auth.uid() OR auth.uid() = _host_id
                       OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.status = 'approved'   -- a self-made request is not involvement
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
-- final review #5: only for a game that is itself free; a paid listing whose payee went away (guardian link revoked) cannot be turned
-- into a free, open game by the minor host's own settings row.
CREATE OR REPLACE FUNCTION private_sec.is_game_host_without_payee(_game text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT private_sec.is_game_host(_game) AND private_sec.game_payee(_game) IS NULL
     AND EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game AND COALESCE(g.price, 0) = 0)
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

-- 3b. (review round 4) The free-settings row of a minor host with no payment manager must also be READ and USED: the settings read
-- policy, the client's upsert (which needs SELECT) and the join gate all looked only for the payee's row. The settings holder is the
-- payee, or, when the game has no payee, its host; such a row can only ever be free (insert/update policies above, plus
-- enforce_minor_payment_settings). Payment destinations still use game_payee only (enforce_payment_destination is unchanged).
CREATE OR REPLACE FUNCTION private_sec.game_settings_holder(_game_id text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(private_sec.game_payee(g.id), CASE WHEN COALESCE(g.price, 0) = 0 THEN g.host_id END)   -- final review #5: free listings only
    FROM public.hosted_games g WHERE g.id = _game_id
$$;
REVOKE ALL ON FUNCTION private_sec.game_settings_holder(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.game_settings_holder(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.can_read_game_payment_settings(_game_id text, _host_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT auth.uid() IS NOT NULL
     AND _host_id = private_sec.game_settings_holder(_game_id)  -- PAY-1
     AND (
       _host_id = auth.uid()
       OR EXISTS (SELECT 1 FROM public.join_requests jr
                   WHERE jr.game_id = _game_id AND jr.player_id = auth.uid() AND jr.status = 'approved')
       OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                   WHERE ps.game_id = _game_id AND ps.player_id = auth.uid())
       OR EXISTS (SELECT 1 FROM public.game_participants gp
                   WHERE gp.game_id = _game_id AND gp.user_id = auth.uid())
     )
$function$
;

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
      AND s.host_id = private_sec.game_settings_holder(s.game_id)  -- PAY-1: a free minor-hosted game's own settings count
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
$function$
;

CREATE OR REPLACE FUNCTION private_sec.caller_is_adult()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT auth.uid() IS NOT NULL AND public.age_cohort_of(auth.uid()) = 'adult'
$$;
REVOKE ALL ON FUNCTION private_sec.caller_is_adult() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.caller_is_adult() TO authenticated, service_role;

-- 4. submissions follow the current payee
DROP POLICY IF EXISTS "Hosts see submissions for their games" ON public.payment_submissions;
CREATE POLICY "Hosts see submissions for their games" ON public.payment_submissions FOR SELECT TO authenticated
  -- the current payee manager; or the adult who received the money, for refunds they still owe (mark_refund_sent is keyed on them)
  USING (host_id = auth.uid() AND (private_sec.can_manage_game_payment_settings(game_id)
         OR (refund_status = 'owed' AND private_sec.caller_is_adult())));
DROP POLICY IF EXISTS "Hosts update submissions for their games" ON public.payment_submissions;
CREATE POLICY "Hosts update submissions for their games" ON public.payment_submissions FOR UPDATE TO authenticated
  USING (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id))
  WITH CHECK (host_id = auth.uid() AND private_sec.can_manage_game_payment_settings(game_id));

-- SEC-2 interplay: can_notify is a wrapped helper; re-wrap when the containment migration is present.
DO $rewrap$ BEGIN
  IF to_regprocedure('private_sec.wrap_oracle_helpers()') IS NOT NULL THEN PERFORM private_sec.wrap_oracle_helpers(); END IF;
END $rewrap$;
