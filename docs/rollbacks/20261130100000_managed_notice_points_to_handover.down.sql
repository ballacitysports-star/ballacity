-- ROLLBACK for supabase/migrations/20261130100000_managed_notice_points_to_handover.sql (the notice #452 sends a managing
-- guardian when a managed account's person turns 18 now points to the handover the guardian can start).
-- NOT a migration. It puts private_sec.end_adult_guardian_links(integer) back to the definition 20261125200000 gave it,
-- verbatim: the same function with the old notice text ("... so it stays linked to you for now. Contact support to plan
-- handing it over."). Nothing else changes, because the migration changed nothing else.
--
-- WHAT IT CANNOT UNDO: notices already sent. A managing guardian told while the migration was applied keeps the new text in
-- their notifications (nothing is rewritten either way), and is not told again (their 'managed_notice' row stays in
-- private_sec.guardian_link_age_events).
-- ORDER: this comes BEFORE docs/rollbacks/20261125200000_guardian_links_end_at_18.down.sql. That rollback checks this
-- function's definition and refuses while the new one is in place.
-- It stops, changing nothing, unless the function is exactly the definition 20261130100000 created (md5 below): a later
-- change to it needs a person to look first. After restoring, it checks the function is exactly the one 20261125200000
-- created (md5 70a31fe4cdd5914cd419528c9cfa4496, the value in that migration's rollback) and, if not, undoes itself.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_managed_notice_points_to_handover_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_managed_notice_points_to_handover_rollback=yes")
-- Locks: CREATE OR REPLACE FUNCTION takes a brief lock on the function only; the wait is limited to 5 s.
BEGIN;
DO $guard$
DECLARE
  _fn CONSTANT regprocedure := to_regprocedure('private_sec.end_adult_guardian_links(integer)');
  _got text;
BEGIN
  IF current_setting('app.confirm_managed_notice_points_to_handover_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this puts the old managed-account notice text back ("Contact support to plan handing it over"). Set app.confirm_managed_notice_points_to_handover_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _fn IS NULL OR _got IS DISTINCT FROM 'c3f95d699d9cb5e23c757eea4128f055' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.end_adult_guardian_links(integer) is not the definition 20261130100000 created (md5 %, expected c3f95d699d9cb5e23c757eea4128f055). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

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
                _name || ' is 18 or over. Their account has no sign-in of its own, so it stays linked to you for now. Contact support to plan handing it over.',
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

DO $check$
DECLARE
  _got text;
BEGIN
  SELECT md5(pg_get_functiondef('private_sec.end_adult_guardian_links(integer)'::regprocedure)) INTO _got;
  IF _got IS DISTINCT FROM '70a31fe4cdd5914cd419528c9cfa4496' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored private_sec.end_adult_guardian_links(integer) has md5 %, not the 20261125200000 definition 70a31fe4cdd5914cd419528c9cfa4496.', _got;
  END IF;
END
$check$;
COMMIT;
