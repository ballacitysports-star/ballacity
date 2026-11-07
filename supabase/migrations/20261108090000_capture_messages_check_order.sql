-- Capture: production's order of the three conditions in messages_body_or_attachment_chk.
--
-- Production has (deleted_at IS NOT NULL) OR (body present) OR (attachment present); a replay of the repository builds
-- the same rule with deleted_at last. They accept exactly the same rows, but the catalog fingerprint compares the text,
-- so this was the last cosmetic difference between production and main (release records 2026-11-07).
--
-- NO-OP ON PRODUCTION: the constraint is rebuilt only where its text differs from production's. On a replay it is
-- dropped and re-added in production's order; every existing row already satisfies it.
--
-- Rollback: docs/rollbacks/20261108090000_capture_messages_check_order.down.sql.
DO $c$
DECLARE
  _want text := 'CHECK (((deleted_at IS NOT NULL) OR ((body IS NOT NULL) AND (length(btrim(body)) > 0)) OR (attachment_path IS NOT NULL)))';
  _have text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _have
    FROM pg_constraint
   WHERE conname = 'messages_body_or_attachment_chk' AND conrelid = 'public.messages'::regclass;
  IF _have IS DISTINCT FROM _want THEN
    ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_or_attachment_chk;
    ALTER TABLE public.messages ADD CONSTRAINT messages_body_or_attachment_chk
      CHECK (deleted_at IS NOT NULL OR (body IS NOT NULL AND length(btrim(body)) > 0) OR attachment_path IS NOT NULL);
  END IF;
END
$c$;
