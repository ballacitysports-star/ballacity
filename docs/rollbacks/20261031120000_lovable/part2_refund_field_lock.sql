-- Lovable rollback, hotfix 20261031120000 (PR #287), part 2 of 4: refund-field lock (payment_submissions).
-- RE-OPENS F11: a player can again write refund_* fields on their own payment claim.
-- Only with the owner's explicit approval, and recorded. Send this whole file to Lovable's agent as one migration,
-- unchanged (docs/release/hotfix-286-287-runbook.md, section 7). It is one statement, so it applies whole or not at all.
DO $rollback$
BEGIN
  DROP TRIGGER IF EXISTS a00_payment_refund_fields_locked ON public.payment_submissions;
  DROP FUNCTION IF EXISTS public.lock_payment_refund_fields();
  IF to_regprocedure('public.lock_payment_refund_fields()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'a00_payment_refund_fields_locked') THEN
    RAISE EXCEPTION 'rollback of 20261031120000 part 2 incomplete';
  END IF;
END
$rollback$;
