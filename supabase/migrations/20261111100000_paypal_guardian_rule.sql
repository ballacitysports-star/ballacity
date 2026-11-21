-- Audit F03 follow-up: PayPal checkout follows the guardian rule.
--
-- A 16-17-year-old with an active guardian link needs a guardian's approval of their request for a game before paying
-- for it. enforce_guardian_before_payment enforces that on payment_submissions, but only for a signed-in writer
-- (auth.uid() set). The server's PayPal capture writes the payment with the service role, after PayPal has already
-- moved the money, so the trigger never sees it: a child could pay by PayPal checkout with no guardian approval at all.
--
-- The trigger has to keep letting that write through: by then the money has moved, and the payment must be recorded
-- (the roster gate still refuses the place). So the check moves in front of the money instead:
--   1. private_sec.guardian_payment_approval_missing(player, game): the payment gate's rule, in one place.
--   2. enforce_guardian_before_payment asks it. Its behaviour is unchanged.
--   3. public.game_payment_guardian_ready(game): whether the signed-in caller may pay for the game as far as the
--      guardian rule goes. The server asks it, as the player, before creating a PayPal order and again right before
--      capturing one, and refuses (nothing is charged) when it is not true. A player known to be 18 or over is exempt,
--      as the roster gate exempts adults, even if a guardian link made before 18 was never ended. (The payment trigger
--      has no such exemption for a manual payment; that is unchanged here.)
-- Deploy order: this migration BEFORE the app. The server's check fails closed, so a published server without this
-- function refuses every PayPal checkout.
-- Rollback: docs/rollbacks/20261111100000_paypal_guardian_rule.down.sql (guarded). Roll it back before
-- 20261110120000's rollback, which refuses while this one is applied.

-- ============================================================ 1. the payment gate's rule
CREATE OR REPLACE FUNCTION private_sec.guardian_payment_approval_missing(_player uuid, _game_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
           SELECT 1 FROM public.guardian_links gl
            WHERE gl.child_user_id = _player AND gl.status = 'active'
         )
     AND NOT EXISTS (
           SELECT 1 FROM public.join_requests jr
            WHERE jr.game_id = _game_id
              AND jr.player_id = _player
              AND jr.guardian_approved_at IS NOT NULL
              AND private_sec.guardian_approval_valid(_player, jr.guardian_approved_by)
              AND jr.status IN ('pending', 'approved')
         );
$$;
REVOKE ALL ON FUNCTION private_sec.guardian_payment_approval_missing(uuid, text) FROM PUBLIC, anon, authenticated;

-- ============================================================ 2. the trigger asks it (same behaviour)
CREATE OR REPLACE FUNCTION public.enforce_guardian_before_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- No signed-in writer: the server. It records a PayPal payment only after PayPal has moved the money, and it asks
  -- game_payment_guardian_ready before creating the order and before capturing it.
  IF auth.uid() IS NULL OR NEW.player_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF private_sec.guardian_payment_approval_missing(NEW.player_id, NEW.game_id) THEN
    RAISE EXCEPTION 'GUARDIAN_APPROVAL_REQUIRED: a parent or guardian has to approve this game before a payment can be sent.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$function$;

-- ============================================================ 3. asked by the server before any money moves
CREATE OR REPLACE FUNCTION public.game_payment_guardian_ready(_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (
       -- A player known to be 18 or over (a stored birthday) is under no guardian's authority, whatever link remains
       -- from before 18; the roster gate exempts adults the same way. An unknown age stays gated: is_minor would call
       -- it an adult, so it is not used here.
       EXISTS (SELECT 1 FROM public.profile_birthdays pb
                WHERE pb.user_id = auth.uid() AND pb.birthday IS NOT NULL
                  AND date_part('year', age(pb.birthday))::int >= 18)
       OR NOT private_sec.guardian_payment_approval_missing(auth.uid(), _game_id)
     );
$$;
REVOKE ALL ON FUNCTION public.game_payment_guardian_ready(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.game_payment_guardian_ready(text) TO authenticated;
