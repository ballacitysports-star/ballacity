-- SEC-8: payment authorization oracles (independent review). Applied after SEC-7 (20261108130000). Forward-only.
--
--  1. A payment submission's host_id is chosen by the database: the game's payee (private_sec.game_payee). The client's value is ignored, so
--     an insert no longer answers "is X the payee of this game". A game with no payee gets one generic refusal. The approval check now runs
--     before the destination is resolved.
--  2. Approval before payment fails closed: a missing payment-settings row means approval is required, and a game whose host is not a
--     confirmed adult always requires it. get_host_payment_methods and payer_to_payee no longer count a payment claim the caller wrote
--     themselves: only a verified payment, an approved request (or, for payer_to_payee, a claim made after an approved request) or a place
--     on the roster.
--  3. A payment can only be submitted by the player it is for (a00_payment_self_only, first trigger): the cohort and guardian checks no longer
--     run for someone else's account. The guardian-first check also applies to the service role (PayPal capture inserts as it).
--  4. A join request or a roster row can only be written for the caller (a000_*_self_only, first trigger): the age, guardian and block checks
--     no longer run for someone else's account. Server-side writers (service role, definer functions) are unchanged.
--  5. public.payment_precondition_error(game, player): the same approval / guardian / cohort / payee rules as the triggers, for the PayPal
--     server functions to check before money moves (service role only). paypal_orders gains 'refunded' and 'unrecorded'.
--  6. get_game_host_paypal returns the merchant id of the game's payee, only when the payee is a confirmed adult and the caller can see the
--     listing or is involved with the game (the same gate as get_game_host_payment_methods). Anonymous visitors can no longer call it.
-- See docs/privacy/sec8-payment-oracles.md.

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.game_payee(text)') IS NULL OR to_regprocedure('public.game_payee_id(text)') IS NULL            -- PAY-1
     OR to_regprocedure('private_sec.payer_to_payee(uuid,uuid)') IS NULL OR to_regprocedure('private_sec.can_notify(uuid,uuid)') IS NULL
     OR to_regprocedure('public.get_game_host_payment_methods(uuid,text)') IS NULL                                                  -- SEC-7
     OR to_regprocedure('public.require_approval_for_minor_hosted_payment()') IS NULL OR to_regclass('public.game_contact_windows') IS NULL
     OR to_regprocedure('private_sec.is_guardian_of(uuid,uuid)') IS NULL OR to_regprocedure('private_sec.rpc_probe_denied(text,uuid[],name)') IS NULL -- SEC-2
     OR to_regprocedure('public.enforce_payment_destination()') IS NULL OR to_regprocedure('public.enforce_approval_before_payment()') IS NULL
     OR to_regprocedure('public.enforce_guardian_before_payment()') IS NULL OR to_regprocedure('public.get_host_payment_methods(uuid)') IS NULL
     OR to_regprocedure('public.get_game_host_paypal(text)') IS NULL OR to_regclass('public.paypal_orders') IS NULL THEN
    RAISE EXCEPTION 'SEC-8: a required earlier release migration (PAY-1, SEC-2, SEC-7) has not been applied';
  END IF;
END $guard$;

-- ======================================================================================== shared rules (one definition for triggers and server)
-- Whether a payment for this game needs an approved join request first. Fails closed: no game, no settings row, or a host who is not a
-- confirmed adult all mean yes. Only the payee's newest settings row counts.
CREATE OR REPLACE FUNCTION private_sec.payment_requires_approval(_game_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT COALESCE((
    SELECT COALESCE(public.age_cohort_of(g.host_id), 'unknown') <> 'adult'
        OR COALESCE((SELECT s.requires_approval FROM public.game_payment_settings s
                      WHERE s.game_id = g.id AND s.host_id = private_sec.game_payee(g.id)
                      ORDER BY s.created_at DESC LIMIT 1), true)
      FROM public.hosted_games g WHERE g.id = _game_id), true)
$function$;
REVOKE ALL ON FUNCTION private_sec.payment_requires_approval(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.payment_requires_approval(text) TO service_role;

CREATE OR REPLACE FUNCTION private_sec.payment_approval_missing(_game_id text, _player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT private_sec.payment_requires_approval(_game_id)
     AND NOT EXISTS (SELECT 1 FROM public.join_requests jr
                      WHERE jr.game_id = _game_id AND jr.player_id = _player AND jr.status = 'approved')
$function$;
REVOKE ALL ON FUNCTION private_sec.payment_approval_missing(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.payment_approval_missing(text, uuid) TO service_role;

-- A player with an active guardian link needs that guardian's approval of this game's request before any payment.
CREATE OR REPLACE FUNCTION private_sec.payment_guardian_missing(_game_id text, _player uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.guardian_links gl WHERE gl.child_user_id = _player AND gl.status = 'active')
     AND NOT EXISTS (SELECT 1 FROM public.join_requests jr
                      WHERE jr.game_id = _game_id AND jr.player_id = _player
                        AND jr.guardian_approved_at IS NOT NULL AND jr.status IN ('pending', 'approved'))
$function$;
REVOKE ALL ON FUNCTION private_sec.payment_guardian_missing(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.payment_guardian_missing(text, uuid) TO service_role;

-- For the PayPal server functions: NULL when this player may pay for this game now, else a code. Service role only (it names any player).
CREATE OR REPLACE FUNCTION public.payment_precondition_error(_game_id text, _player uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN _player IS NULL OR NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id) THEN 'GAME_NOT_FOUND'
    WHEN NOT private_sec.game_payments_allowed(_player) THEN 'PAYMENTS_NOT_AVAILABLE'
    WHEN private_sec.game_payee(_game_id) IS NULL OR private_sec.game_payee(_game_id) = _player THEN 'PAYMENT_DESTINATION_INVALID'
    WHEN private_sec.payment_approval_missing(_game_id, _player) THEN 'HOST_APPROVAL_REQUIRED'
    WHEN private_sec.payment_guardian_missing(_game_id, _player) THEN 'GUARDIAN_APPROVAL_REQUIRED'
  END
$function$;
REVOKE ALL ON FUNCTION public.payment_precondition_error(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.payment_precondition_error(text, uuid) TO service_role;

-- ======================================================================================== 3. a payment is submitted only by its player
CREATE OR REPLACE FUNCTION public.enforce_payment_self_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- One answer for every other account, whatever its age, guardian link or approvals: no later check runs for it.
  -- A signed-in or anonymous API request; the service role (no auth.uid()) writes for the player it has checked.
  IF (auth.uid() IS NOT NULL OR COALESCE(auth.role(), '') IN ('anon', 'authenticated'))
     AND NEW.player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'PAYMENT_PLAYER_INVALID: you can only submit a payment for yourself.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.enforce_payment_self_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a00_payment_self_only ON public.payment_submissions;
CREATE TRIGGER a00_payment_self_only BEFORE INSERT ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_payment_self_only();

-- ======================================================================================== 2. approval before payment fails closed
-- Resolves the payee itself (never NEW.host_id), and fires before the destination trigger, so a stranger without an approved request gets
-- this refusal whatever host_id they name.
CREATE OR REPLACE FUNCTION public.enforce_approval_before_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Every API writer is checked, the service role included; only a direct database session (migrations, maintenance) is exempt.
  IF auth.uid() IS NULL AND COALESCE(auth.role(), '') NOT IN ('service_role', 'anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF private_sec.payment_approval_missing(NEW.game_id, NEW.player_id) THEN
    RAISE EXCEPTION 'Host approval required before payment can be submitted for this game.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.enforce_approval_before_payment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS enforce_approval_before_payment_trg ON public.payment_submissions;
DROP TRIGGER IF EXISTS a01_payment_approval_trg ON public.payment_submissions;
CREATE TRIGGER a01_payment_approval_trg BEFORE INSERT ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_approval_before_payment();

-- ======================================================================================== 1. the database names the payee
CREATE OR REPLACE FUNCTION public.enforce_payment_destination()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _payee uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.host_id IS NOT DISTINCT FROM OLD.host_id AND NEW.game_id IS NOT DISTINCT FROM OLD.game_id THEN
    RETURN NEW;
  END IF;
  _payee := private_sec.game_payee(NEW.game_id);
  IF TG_OP = 'INSERT' THEN
    NEW.host_id := _payee;      -- whatever the client sent
  END IF;
  IF _payee IS NULL OR NEW.host_id IS DISTINCT FROM _payee THEN
    RAISE EXCEPTION 'PAYMENT_DESTINATION_INVALID: payment cannot be sent for this game.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.enforce_payment_destination() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_payment_destination() TO service_role;

-- R5 review F1: an API update that moves a claim to another game or payee is refused first, with one answer, before the destination check
-- could tell a guessed payee from any other account. SECURITY INVOKER on purpose: current_user is the API role for a direct statement and
-- the function owner inside definer code (settle_*, the refund engine), which keeps its own rules. No client path changes these columns.
CREATE OR REPLACE FUNCTION public.lock_payment_submission_keys()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated')
     AND (NEW.game_id IS DISTINCT FROM OLD.game_id OR NEW.host_id IS DISTINCT FROM OLD.host_id OR NEW.player_id IS DISTINCT FROM OLD.player_id) THEN
    RAISE EXCEPTION 'PAYMENT_FIELD_FORBIDDEN: the game, payee and player of a payment cannot be changed.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.lock_payment_submission_keys() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lock_payment_submission_keys() TO anon, authenticated, service_role;
DROP TRIGGER IF EXISTS a00_payment_keys_locked ON public.payment_submissions;
CREATE TRIGGER a00_payment_keys_locked BEFORE UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION public.lock_payment_submission_keys();

-- ======================================================================================== 5. guardian-first also for the service role
CREATE OR REPLACE FUNCTION public.enforce_guardian_before_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Only a direct database session (migrations, maintenance) is exempt. A signed-in request and the service role (PayPal capture writes the
  -- verified payment as it) are both checked.
  IF NEW.player_id IS NULL OR (auth.uid() IS NULL AND COALESCE(auth.role(), '') <> 'service_role') THEN
    RETURN NEW;
  END IF;
  IF private_sec.payment_guardian_missing(NEW.game_id, NEW.player_id) THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.enforce_guardian_before_payment() FROM PUBLIC, anon, authenticated;

-- ======================================================================================== 4. join requests and roster rows are for the caller
CREATE OR REPLACE FUNCTION public.enforce_join_request_self_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  -- Same message validate_join_request gives (it runs later and stays the backstop), raised before the age, guardian and block checks.
  IF auth.uid() IS NOT NULL AND NEW.player_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot create a join request for another player.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.enforce_join_request_self_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a000_join_request_self_only ON public.join_requests;
CREATE TRIGGER a000_join_request_self_only BEFORE INSERT ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION public.enforce_join_request_self_only();

-- game_participants: row security already allows a client to add only itself, but the age, guardian, block and join-gate triggers ran first
-- and answered for the other account. A direct API write (the anon/authenticated role) for someone else now stops here. Server writers
-- (service role rostering a paid player, definer functions acting for a host or guardian) run as another role and are unaffected.
CREATE OR REPLACE FUNCTION public.enforce_participant_self_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
BEGIN
  IF current_user IN ('anon', 'authenticated') AND NEW.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot add another player to a game.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION public.enforce_participant_self_only() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_participant_self_only() TO anon, authenticated, service_role;
DROP TRIGGER IF EXISTS a000_participant_self_only ON public.game_participants;
CREATE TRIGGER a000_participant_self_only BEFORE INSERT ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_participant_self_only();

-- ======================================================================================== 2. handles and messaging need real involvement
CREATE OR REPLACE FUNCTION public.get_host_payment_methods(_host_id uuid)
 RETURNS TABLE(id uuid, host_id uuid, payment_type text, label text, username text, payment_url text, contact_info text, instructions text, is_enabled boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RETURN; END IF;
  IF public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN RETURN; END IF;

  -- SEC-8: a payment claim the caller wrote is not involvement (anyone can write one); a verified payment, an approved request or a place on
  -- the roster of a game this person is the payee of is.
  IF _me = _host_id
     OR EXISTS (SELECT 1 FROM public.join_requests jr
                 WHERE jr.player_id = _me AND jr.status = 'approved' AND private_sec.game_payee(jr.game_id) = _host_id)
     OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                 WHERE ps.player_id = _me AND ps.host_id = _host_id AND ps.status = 'verified')
     OR EXISTS (SELECT 1 FROM public.game_participants gp
                 WHERE gp.user_id = _me AND private_sec.game_payee(gp.game_id) = _host_id)
  THEN
    RETURN QUERY
      SELECT hpm.id, hpm.host_id, hpm.payment_type, hpm.label, hpm.username, hpm.payment_url, hpm.contact_info, hpm.instructions, hpm.is_enabled
      FROM public.host_payment_methods hpm
      WHERE hpm.host_id = _host_id AND hpm.is_enabled = true;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION private_sec.payer_to_payee(_payer uuid, _payee uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- SEC-8: only a payment the payee verified, or one made after the payer's request to that game was approved. A claim anyone can write
  -- (pending, rejected, cancelled, with no approval) opens nothing.
  SELECT _payer IS NOT NULL AND _payee IS NOT NULL AND _payer <> _payee
     AND public.age_cohort_of(_payee) = 'adult'
     AND EXISTS (SELECT 1 FROM public.payment_submissions ps
                  WHERE ps.player_id = _payer AND ps.submitted_at > now() - interval '120 days'
                    AND (ps.host_id = _payee OR private_sec.game_payee(ps.game_id) = _payee)
                    AND (ps.status = 'verified'
                         OR EXISTS (SELECT 1 FROM public.join_requests jr
                                     WHERE jr.game_id = ps.game_id AND jr.player_id = _payer AND jr.status = 'approved'
                                       AND COALESCE(jr.reviewed_at, jr.created_at) <= ps.submitted_at)))
$function$;

-- ======================================================================================== 6. PayPal merchant id: payee only, involved callers only
CREATE OR REPLACE FUNCTION private_sec.game_payee_visible_to(_game_id text, _payee uuid, _me uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- The gate of get_game_host_payment_methods (SEC-7): anyone who can see an adult-hosted public listing; otherwise only the host, the
  -- payee, an approved requester, a participant, their verified guardian, or staff.
  SELECT _me IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.hosted_games g WHERE g.id = _game_id
       AND ((NOT COALESCE(g.is_private, false) AND g.hidden_at IS NULL AND public.age_cohort_of(g.host_id) = 'adult')
            OR g.host_id = _me OR _me = _payee
            OR private_sec.is_moderator(_me) OR private_sec.is_superadmin(_me)
            OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.status = 'approved'
                        AND (jr.player_id = _me OR private_sec.is_guardian_of(_me, jr.player_id)))
            OR EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = g.id
                        AND (gp.user_id = _me OR private_sec.is_guardian_of(_me, gp.user_id)))))
$function$;
REVOKE ALL ON FUNCTION private_sec.game_payee_visible_to(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_game_host_paypal(_game_id text)
 RETURNS TABLE(merchant_id text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _me uuid := auth.uid();
  _payee uuid := private_sec.game_payee(_game_id);
BEGIN
  IF _me IS NULL OR _payee IS NULL OR public.age_cohort_of(_payee) IS DISTINCT FROM 'adult' THEN RETURN; END IF;
  IF NOT private_sec.game_payee_visible_to(_game_id, _payee, _me) THEN RETURN; END IF;
  RETURN QUERY SELECT hpa.merchant_id FROM public.host_paypal_accounts hpa WHERE hpa.host_id = _payee LIMIT 1;
END $function$;
REVOKE ALL ON FUNCTION public.get_game_host_paypal(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_game_host_paypal(text) TO authenticated, service_role;

-- ======================================================================================== 5. PayPal order outcomes after capture
-- 'refunded': captured, then refunded because the payment could not be recorded. 'unrecorded': captured, not recorded, refund failed (support).
ALTER TABLE public.paypal_orders DROP CONSTRAINT IF EXISTS paypal_orders_status_check;
ALTER TABLE public.paypal_orders ADD CONSTRAINT paypal_orders_status_check
  CHECK (status = ANY (ARRAY['created', 'approved', 'captured', 'failed', 'cancelled', 'refunded', 'unrecorded']));
