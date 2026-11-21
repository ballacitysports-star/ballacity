-- ROLLBACK for supabase/migrations/20261128100000_managed_account_handover.sql (docs/managed-account-handover.md).
-- NOT a migration. It unschedules the daily expiry (when pg_cron is there), drops the eight functions and the three helper
-- functions the migration added, and drops private_sec.managed_handovers. Nothing else changes: no #452 reader, no
-- managed_accounts row, no guardian link, no consent, no notification is touched by the rollback.
--
-- WHAT IT CANNOT UNDO: a handover that was already completed. Completion removed that account's managed_accounts row,
-- revoked its sessions and device pairing and ended its guardian links; the person has their own sign-in now. Those accounts
-- stay what they are (family_audit_log keeps one 'managed.handover_completed' row each, and private_sec.guardian_link_age_events
-- lists the links that were ended). Putting a person back under a guardian would be a decision for the owner, not a rollback.
-- What it does remove: every PENDING handover. Its emailed link stops working (the app shows "This link isn't valid any more")
-- and the guardian's Parent Center loses the "Hand over this account" entry; the accounts stay managed and linked exactly as
-- they are, so nothing is stranded. The table holds no address or token for an ended handover, so nothing sensitive is kept.
-- Effect on the app that shipped with the migration: guardian_managed_handovers() is missing, so the Parent Center hides the
-- handover entry (fail closed); the link page and the start call report that handover is not available. No other code reads
-- these objects.
-- It stops, changing nothing, if any function the migration added no longer has the definition the migration gave it (a later
-- migration changed it): a person needs to look first. It also stops if somebody is finishing a handover this minute.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_managed_account_handover_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_managed_account_handover_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{
    "public.start_managed_handover(uuid, uuid, text, text)": "9d262dbc33a97c5b2fc78842559efc90",
    "public.cancel_managed_handover(uuid)": "69b886ed84cf2b19a63f89760c5535c0",
    "public.guardian_managed_handovers()": "10d70a0360f69a006ccb08f55b9c0bf7",
    "public.managed_handover_lookup(text)": "b07c5054b879cd8a72c3170741185ee4",
    "public.claim_managed_handover(text)": "00cee931dc6120c1bb30acd444af9731",
    "public.release_managed_handover(text)": "7ce4f9b726ea7c77fdfab6a95998dded",
    "public.finish_managed_handover(text)": "fd9745b5cf8bac5ee3b59e592dcbe4b2",
    "private_sec.expire_managed_handovers(uuid, integer)": "2fba4893efbc2866dbd8ec832fc8661a",
    "private_sec.handover_mailbox_key(text)": "2a52e6e7b916500321a45c1b7fcfb030",
    "private_sec.handover_mask_email(text)": "b53dad6803c97720cbdd22d3eb63f450",
    "private_sec.handover_display_name(uuid, text)": "ccf97e99001000ee1dc7d2ab1a2edcf4"
  }'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_managed_account_handover_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this cancels every pending handover (their emailed links stop working) and removes the way to hand an adult''s managed account over. It cannot undo a handover that already completed. Set app.confirm_managed_account_handover_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261128100000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM private_sec.managed_handovers h WHERE h.status = 'pending' AND h.claimed_at > now() - interval '2 minutes') THEN
    RAISE EXCEPTION 'Refusing to run: a handover is being finished right now. Try again in a few minutes.';
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- The daily expiry, when pg_cron is there.
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-managed-handovers');
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'expire-managed-handovers not unscheduled (it may not exist): %', SQLERRM;
END
$cron$;

DROP FUNCTION public.start_managed_handover(uuid, uuid, text, text);
DROP FUNCTION public.cancel_managed_handover(uuid);
DROP FUNCTION public.guardian_managed_handovers();
DROP FUNCTION public.managed_handover_lookup(text);
DROP FUNCTION public.claim_managed_handover(text);
DROP FUNCTION public.release_managed_handover(text);
DROP FUNCTION public.finish_managed_handover(text);
DROP FUNCTION private_sec.expire_managed_handovers(uuid, integer);
DROP TABLE private_sec.managed_handovers;
DROP FUNCTION private_sec.handover_mailbox_key(text);
DROP FUNCTION private_sec.handover_mask_email(text);
DROP FUNCTION private_sec.handover_display_name(uuid, text);

COMMIT;
