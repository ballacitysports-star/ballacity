-- Payment terms a prospective player may read BEFORE approval or payment (docs/paid-path-gates.md section 6 (c), the
-- open items of docs/release/records/2026-11-20-pay-fresh-viewer.md). Owner instruction 2026-11-21: "do all 3 steps as
-- your best recommendation".
--
-- THE GAP. game_payment_settings is hidden by row level security from a viewer who is not yet the payee, an approved
-- requester, a payer or a participant (private_sec.can_read_game_payment_settings). So a new player on a paid open game
-- saw the game's price and nothing else: not the entry fee PayPal will actually charge (game_payment_settings.entry_fee,
-- which wins over hosted_games.price), not the payment deadline, not which payment apps the host takes, and not that the
-- host approves players first. Only get_game_join_policy (the approval flag) and get_game_refund_terms were public.
-- Second gap, same function family: public.get_game_host_payment_methods still returned the host's payment handles
-- (Venmo name, Cash App tag...) through the API to a signed-in viewer the pay page refuses on an open game (outside the
-- age range, a full roster, a host's block, a guardian's switch...). The page never drew them; the API response held them.
--
--   1. public.get_game_payment_terms(_game_id): ONE read-only SECURITY DEFINER function, signed-in callers only. It
--      returns at most one row, and only about the caller's own view of the game: the entry fee, its currency (USD: the
--      only currency BallaCity charges in, src/lib/paypal.functions.ts), the payment deadline, the TYPES of payment
--      method the host accepts (venmo, cashapp, zelle, paypal, applecash, googlepay, cash, custom: a fixed list, never
--      the host's own label, handle, link, contact or instructions) and whether the host approves players before they
--      pay. No handle and no free text, so nothing that names a person or an account. The handles and the host's general
--      payment instructions (free text, which may hold a handle) stay behind exactly the entitlement they had: the row,
--      and get_game_host_payment_methods. No row at all (empty, the same as a game with no payment settings) unless ALL of:
--        - the game exists and the caller may see it: the hosted_games read rules for a signed-in account (an open game,
--          the host, a hidden game the host or its players and requesters see, a private game its host, players,
--          requesters and invitees see). A private or hidden game the caller cannot see is empty, never "not found";
--        - nobody is suspended (the caller or the host) and no block stands between the caller and the host, in either
--          direction;
--        - the host's settings row for the game is the payee's (private_sec.game_payee) and it charges a fee;
--        - the caller may coordinate payments (game_payments_allowed: not under 16, an age known, no consent lock), the
--          payee is a confirmed adult (the rule of get_game_host_payment_methods), and the caller passes the guardian rule
--          the pay page applies (game_payment_guardian_ready: a minor with a guardian link needs the approval first);
--        - private_sec.payment_claim_block(game, caller) has nothing against the caller: a cancelled or ended game, a
--          guardian's "Can join games" switch, the host's block, the age range (unless approved or on the roster), closed
--          joining, a full roster (#434, PayPal and the manual claim ask the same).
--      The host reading their own game is answered without the caller rules (they hold the row). A refused caller gets
--      the same empty answer as a game with no payment settings, so the answer reveals nothing about the game's rules.
--   2. public.get_game_host_payment_methods ONLY TIGHTENS: a caller who is not the payee, not on the roster and has no
--      claim of their own for the game, and whom payment_claim_block would refuse, now gets nothing. Everyone else gets
--      exactly what they got: the payee, a rostered player (who keeps the handles whatever happens to the game, as the
--      pay page lets them pay for an ended game they still owe), a payer with a claim in, and any stranger or approved
--      requester the claim rules would let through. The body is otherwise the one of 20261119200000, character for
--      character apart from the new check (rollback: docs/rollbacks/20261128120000_game_payment_terms.down.sql).
-- Not changed: row level security on game_payment_settings; the approval rule (a visible game's handles still need
-- approval only through the page, as before: payMethodsHeldForApproval; the owner decided "behind exactly the existing
-- entitlement"); no guardian rule is loosened (every new condition only removes an answer).
-- Deploy order: this migration BEFORE or WITH the app change; the app works without it (the terms read fails, the page
-- shows what it showed before). Rollback: docs/rollbacks/20261128120000_game_payment_terms.down.sql (guarded).

DO $guard$
BEGIN
  IF to_regprocedure('private_sec.payment_claim_block(text, uuid)') IS NULL
     OR to_regprocedure('private_sec.game_payee(text)') IS NULL
     OR to_regprocedure('private_sec.can_read_game_payment_settings(text, uuid)') IS NULL
     OR to_regprocedure('private_sec.blocks_exist_between(uuid, uuid)') IS NULL
     OR to_regprocedure('private_sec.has_game_invite(text, uuid)') IS NULL
     OR to_regprocedure('private_sec.is_game_participant(text, uuid)') IS NULL
     OR to_regprocedure('private_sec.game_payments_allowed(uuid)') IS NULL
     OR to_regprocedure('public.game_payment_guardian_ready(text)') IS NULL
     OR to_regprocedure('public.age_cohort_of(uuid)') IS NULL
     OR to_regprocedure('public.get_game_host_payment_methods(uuid, text)') IS NULL THEN
    RAISE EXCEPTION '20261128120000: an earlier migration it builds on (20261119200000_payment_claim_preconditions, 20261125100000_profile_blocks_suspension and the payment gates) is not applied';
  END IF;
  IF md5(pg_get_functiondef('public.get_game_host_payment_methods(uuid, text)'::regprocedure)) <> 'ea525f29aa2da2aca39d9a797ce8a11e' THEN
    RAISE EXCEPTION '20261128120000: public.get_game_host_payment_methods is not the definition 20261119200000 created; a later change needs a person to look first';
  END IF;
END
$guard$;

-- ============================================================ 1. what a prospective player may know
CREATE OR REPLACE FUNCTION public.get_game_payment_terms(_game_id text)
RETURNS TABLE (entry_fee numeric, currency text, payment_deadline timestamptz, accepted_methods text[], requires_approval boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me constant uuid := auth.uid();
  g record;
  _s public.game_payment_settings%ROWTYPE;
BEGIN
  IF _me IS NULL THEN
    RETURN;
  END IF;

  SELECT gg.id, gg.host_id, gg.is_private, gg.hidden_at, gg.moderator_hidden_at
    INTO g
    FROM public.hosted_games gg WHERE gg.id = _game_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- The caller may see the game: the hosted_games read rules for a signed-in account, nothing wider.
  IF NOT (
       (NOT g.is_private AND g.hidden_at IS NULL)
       OR g.host_id = _me
       OR (NOT g.is_private AND g.hidden_at IS NOT NULL AND g.moderator_hidden_at IS NULL
           AND (private_sec.is_game_participant(g.id, _me)
                OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.player_id = _me)))
       OR (g.is_private
           AND (private_sec.is_game_participant(g.id, _me)
                OR EXISTS (SELECT 1 FROM public.join_requests jr WHERE jr.game_id = g.id AND jr.player_id = _me)
                OR private_sec.has_game_invite(g.id, _me)))
     ) THEN
    RETURN;
  END IF;

  -- Nobody suspended, and no block between the two of them, in either direction.
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id IN (_me, g.host_id) AND p.suspended_at IS NOT NULL) THEN
    RETURN;
  END IF;
  IF _me <> g.host_id AND private_sec.blocks_exist_between(_me, g.host_id) THEN
    RETURN;
  END IF;

  -- The payee's row for this game (the payee is the game's host: private_sec.game_payee), and only a game with a fee.
  SELECT s.* INTO _s
    FROM public.game_payment_settings s
   WHERE s.game_id = _game_id AND s.host_id = private_sec.game_payee(_game_id)
   ORDER BY s.created_at DESC
   LIMIT 1;
  IF NOT FOUND OR _s.entry_fee IS NULL OR _s.entry_fee <= 0 THEN
    RETURN;
  END IF;

  -- The rules a player who has not paid yet has to pass, the pay page's own (the host holds the row and needs none).
  IF _me <> g.host_id THEN
    -- Only a confirmed adult takes payments, as get_game_host_payment_methods says.
    IF public.age_cohort_of(g.host_id) IS DISTINCT FROM 'adult' THEN
      RETURN;
    END IF;
    IF NOT private_sec.game_payments_allowed(_me) THEN
      RETURN;
    END IF;
    IF NOT public.game_payment_guardian_ready(_game_id) THEN
      RETURN;
    END IF;
    IF private_sec.payment_claim_block(_game_id, _me) IS NOT NULL THEN
      RETURN;
    END IF;
  END IF;

  RETURN QUERY
    SELECT _s.entry_fee,
           'USD'::text,
           _s.payment_deadline,
           COALESCE((SELECT array_agg(x.payment_type ORDER BY x.first_added)
                       FROM (SELECT hpm.payment_type, min(hpm.created_at) AS first_added
                               FROM public.host_payment_methods hpm
                              WHERE hpm.host_id = g.host_id
                                AND hpm.is_enabled = true
                                AND (COALESCE(array_length(_s.accepted_method_ids, 1), 0) = 0
                                     OR hpm.id = ANY(_s.accepted_method_ids))
                              GROUP BY hpm.payment_type) x), '{}'::text[]),
           _s.requires_approval;
END;
$$;
REVOKE ALL ON FUNCTION public.get_game_payment_terms(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_game_payment_terms(text) TO authenticated;

-- ============================================================ 2. no handles for a caller the claim rules refuse
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
  -- Not to a caller the pay page refuses and the database would refuse (private_sec.payment_claim_block: a cancelled or
  -- ended game, a guardian's switch, the host's block, outside the age range, closed joining, a full roster): the page
  -- never drew the handles for them, and the response held them. A caller already in the game keeps them: the payee, a
  -- rostered player (who may still owe for a game that has ended) and a payer with a claim in.
  IF _me IS DISTINCT FROM _host_id
     AND NOT public.is_game_participant(_game_id, _me)
     AND NOT EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.game_id = _game_id AND ps.player_id = _me)
     AND private_sec.payment_claim_block(_game_id, _me) IS NOT NULL THEN
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
