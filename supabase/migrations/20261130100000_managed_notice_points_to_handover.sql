-- The notice #452 (20261125200000) sends the MANAGING guardian when a managed account's person turns 18 now points to the
-- handover the guardian can start themselves (20261128100000, "Start handover" on the person's page in the Parent Center),
-- instead of "Contact support to plan handing it over". Owner open decision 1 of docs/managed-account-handover.md section 7.
--
-- WHAT THIS CHANGES: one string, in the body of private_sec.end_adult_guardian_links(integer). The title ('A managed account
-- has turned 18'), the link ('/parent'), the recipient (the managing guardian), the once-only rule (one 'managed_notice'
-- row in private_sec.guardian_link_age_events per person and guardian), the adult test (private_sec.is_known_adult), the
-- ending of unmanaged adults' links, the audit rows, the return value, the grants and the schedule are all untouched. The
-- function below is the one 20261125200000 created, character for character, apart from that string (checked in
-- supabase/tests/994_managed_notice_points_to_handover.test.sql, which puts the old string back into the stored
-- definition and compares it with the md5 20261125200000 gave it).
--
-- Old text: "<name> is 18 or over. Their account has no sign-in of its own, so it stays linked to you for now. Contact support to plan handing it over."
-- New text: "<name> is 18 or over. Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover"."
-- (the new text says: the person is an adult, the guardian still manages the account until the adult completes a handover,
-- and where to start it. It says nothing about consent, the law, age of majority or any record.)
--
-- NOTICES ALREADY SENT keep their old text: nothing is rewritten in public.notifications, and a managing guardian already
-- told is not told again (the 'managed_notice' row is still there).
--
-- Replaces a function only: no table, column, policy, grant or schedule changes. Rollback: docs/rollbacks/
-- 20261130100000_managed_notice_points_to_handover.down.sql (puts the previous definition back; guarded). The rollback of
-- 20261125200000 refuses while this migration is applied: roll this one back first.
-- Locks: CREATE OR REPLACE FUNCTION takes a brief lock on the function only; the lock wait is limited to 5 s.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION private_sec.end_adult_guardian_links(_limit integer DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _cap        integer := LEAST(GREATEST(COALESCE(_limit, 200), 1), 1000);
  r           record;
  _ended      integer := 0;
  _failed     integer := 0;
  _notices    integer := 0;
  _inserted   integer;
  _remaining  integer;
  _managed    integer;
  _name       text;
  _first      boolean;
BEGIN
  -- 1. Active links whose child is a known, unmanaged adult. Nothing else is selected, so nothing else can be touched.
  FOR r IN
    SELECT gl.id, gl.parent_user_id, gl.child_user_id
      FROM public.guardian_links gl
     WHERE gl.status = 'active'
       AND private_sec.guardian_authority_ended(gl.child_user_id)
     ORDER BY gl.created_at, gl.id
     LIMIT _cap
       FOR UPDATE OF gl SKIP LOCKED
  LOOP
    BEGIN
      -- The existing triggers write the family audit row ('link.revoked') and clear this guardian's approvals on
      -- requests that are not yet a place.
      UPDATE public.guardian_links SET status = 'revoked' WHERE id = r.id AND status = 'active';
      IF NOT FOUND THEN CONTINUE; END IF;
      _ended := _ended + 1;

      -- The adult is told once however many guardians they had and however the runs fell (the cap, or a locked row, can
      -- split one adult's guardians across runs): only when no link of theirs was recorded as ended before this one.
      _first := NOT EXISTS (SELECT 1 FROM private_sec.guardian_link_age_events e
                             WHERE e.child_user_id = r.child_user_id AND e.kind = 'ended');
      INSERT INTO private_sec.guardian_link_age_events (child_user_id, parent_user_id, kind)
      VALUES (r.child_user_id, r.parent_user_id, 'ended')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS _inserted = ROW_COUNT;

      -- The guardian is told once per child.
      IF _inserted = 1 THEN
        SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Your family member') INTO _name
          FROM (SELECT 1) s LEFT JOIN public.profiles p ON p.id = r.child_user_id;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (r.parent_user_id, 'guardian_link', 'Family link ended',
                _name || ' is 18 or over, so your family link with them has ended. They no longer appear in your Parent Center.',
                '/parent');
        IF _first THEN
          INSERT INTO public.notifications (user_id, type, title, body, link)
          VALUES (r.child_user_id, 'guardian_link', 'Your family link has ended',
                  'You are 18 or over, so the link to your parent or guardian has ended. They can no longer see or change your account settings.',
                  '/settings');
        END IF;
        _notices := _notices + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;   -- left active and still out of force in every reader; the next run tries again
      RAISE WARNING 'end_adult_guardian_links: link % not ended: %', r.id, SQLERRM;
    END;
  END LOOP;

  -- 2. Managed accounts that have turned 18: never ended here. Tell the managing guardian once.
  FOR r IN
    SELECT m.child_user_id, m.managed_by
      FROM public.managed_accounts m
     WHERE private_sec.is_known_adult(m.child_user_id)
       AND NOT EXISTS (SELECT 1 FROM private_sec.guardian_link_age_events e
                        WHERE e.child_user_id = m.child_user_id AND e.parent_user_id = m.managed_by
                          AND e.kind = 'managed_notice')
     ORDER BY m.created_at, m.child_user_id
     LIMIT _cap
  LOOP
    BEGIN
      INSERT INTO private_sec.guardian_link_age_events (child_user_id, parent_user_id, kind)
      VALUES (r.child_user_id, r.managed_by, 'managed_notice')
      ON CONFLICT DO NOTHING;
      GET DIAGNOSTICS _inserted = ROW_COUNT;
      IF _inserted = 1 THEN
        SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'Your family member') INTO _name
          FROM (SELECT 1) s LEFT JOIN public.profiles p ON p.id = r.child_user_id;
        INSERT INTO public.notifications (user_id, type, title, body, link)
        VALUES (r.managed_by, 'guardian_link', 'A managed account has turned 18',
                _name || ' is 18 or over. Their account has no sign-in of its own, so you still manage it until they complete a handover. You can start one from your Parent Center: open their page and choose "Start handover".',
                '/parent');
        _notices := _notices + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;
      RAISE WARNING 'end_adult_guardian_links: managed notice for % not sent: %', r.child_user_id, SQLERRM;
    END;
  END LOOP;

  SELECT count(*)::int INTO _remaining FROM public.guardian_links gl
   WHERE gl.status = 'active' AND private_sec.guardian_authority_ended(gl.child_user_id);
  SELECT count(*)::int INTO _managed FROM public.managed_accounts m WHERE private_sec.is_known_adult(m.child_user_id);

  RETURN jsonb_build_object('ended', _ended, 'notified', _notices, 'failed', _failed,
                            'remaining', _remaining, 'managed_waiting', _managed);
END $$;
REVOKE ALL ON FUNCTION private_sec.end_adult_guardian_links(integer) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION private_sec.end_adult_guardian_links(integer) IS
  'Records status revoked on active guardian links whose child is a known, unmanaged adult (already out of force in every reader), tells both sides once, reports managed accounts that reached 18 (never ends them). Idempotent, capped per run. Scheduler or by hand.';
RESET lock_timeout;
