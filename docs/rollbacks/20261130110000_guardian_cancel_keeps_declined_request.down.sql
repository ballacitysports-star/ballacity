-- ROLLBACK for supabase/migrations/20261130110000_guardian_cancel_keeps_declined_request.sql (a guardian's cancel for
-- their child no longer deletes a declined join request and takes back any guardian approval left on it; a declined
-- request reopened to 'approved' loses its guardian approval, and an accepted invitation that reopens one holds a guarded
-- minor for their guardian).
-- NOT a migration. It puts back, verbatim, the three definitions the migration replaced:
--   - public.guardian_cancel_child_game(uuid, text) as 20261008160000 created it: its request delete again takes the
--     child's request whatever its status (and so no longer needs to clear a guardian approval on a declined one);
--   - public.game_respond_invite(uuid, boolean) as 20261127120000 created it: a declined request it reopens counts its
--     old guardian approval again when it decides whether the place is held, and a guarded minor already on the roster
--     under a declined request has that request reopened to 'approved' again (with its old approval), as everyone else's
--     already is;
--   - trigger trg_join_request_reopen_needs_guardian on public.join_requests as 20261110120000 created it: it clears the
--     approval only when a declined request goes back to 'pending' (the child's resend).
-- Nothing else changes, because the migration changed nothing else (no grant, owner, table, policy or other trigger or
-- function; the trigger's function private_sec.join_request_reopen_needs_guardian was not touched).
--
-- WHAT IT CANNOT UNDO (and does not need to): declined requests a guardian's cancel left in place while the migration
-- was applied stay as they are (ordinary declined requests, with their cooldown), and the guardian approvals the cancel
-- or the widened trigger took back stay taken back (the guardian approves again if the child is let back in). Minors an
-- accept held for their guardian stay held until the guardian approves. After the rollback, a guardian's cancel deletes
-- a declined request again, and with it the resend cooldown and attempt count, and a host's decline or removal again
-- leaves the guardian's approval for a later accepted invitation to seat the minor on (the gaps the migration closed).
-- Say so in the release record. The app copes with either version (cancelChildGame ignores the return value; the
-- accept's answers have the same shape).
-- It stops, changing nothing, unless each of the three is exactly what 20261130110000 created (md5 below; the trigger
-- also enabled, tgenabled 'O', which pg_get_triggerdef does not show, as 20261129130000's rollback checks) and both
-- functions are owned by postgres with the same API-role grants (EXECUTE for authenticated and service_role; none for
-- PUBLIC or anon): a later change to any of them needs a person to look first (CREATE OR REPLACE would keep a changed
-- owner on these SECURITY DEFINER functions, and CREATE OR REPLACE TRIGGER would quietly enable a disabled trigger).
-- After restoring, it checks each is exactly what it was before the migration (guardian_cancel_child_game
-- db2a64a1cda58c6180ba3080a3b1ede0, game_respond_invite 9c24daeafcdd5dd4443c612a7cf040d3, the trigger's
-- pg_get_triggerdef 9fd20b7ed6dd5ef0a8ed38bc22e473f6 and enabled) with the same owner and grants and, if not, undoes
-- itself.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_guardian_cancel_keeps_declined_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_guardian_cancel_keeps_declined_rollback=yes")
-- ORDER: run this before docs/rollbacks/20261127120000_invite_accept_roster.down.sql (that one's guard expects
-- game_respond_invite as 20261127120000 left it, which this file restores) and before
-- docs/rollbacks/20261110120000_guardian_approval_validity.down.sql.
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger row
-- for 20261130110000 by hand (as the earlier release records do), or the ledger says applied while the definitions are the
-- old ones, and a later re-apply hits a primary-key conflict.
-- PRODUCTION CHECK: the md5 values here were computed on the local Postgres 16; production runs 17 and pg_get_functiondef
-- and pg_get_triggerdef text may differ between versions. The guard fails closed (it refuses, changing nothing), but do
-- not find that out in an emergency: after applying the migration, run these read-only queries in production and record
-- the results in the release record. They must equal 791f8fe8e4412acd7fe80b34a516809a, 79fa287fb3126c74dce0f902542d3e4e,
-- 5480c92ea0314eef6701e1b2d266ddce/O and postgres/postgres; if not, the guard values here need a person to look first.
--     SELECT md5(pg_get_functiondef('public.guardian_cancel_child_game(uuid,text)'::regprocedure));
--     SELECT md5(pg_get_functiondef('public.game_respond_invite(uuid,boolean)'::regprocedure));
--     SELECT md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text FROM pg_trigger t
--      WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_reopen_needs_guardian';
--     SELECT (SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'public.guardian_cancel_child_game(uuid,text)'::regprocedure)
--         || '/' || (SELECT proowner::regrole::text FROM pg_proc WHERE oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure);
-- Also record this read-only count, before and after applying the migration (it changes no row either way). It counts
-- approved requests, not on the roster, whose guardian approval is older than the request's last decline: requests a
-- live 20261127120000 accept reopened (a paid game's accept writes no roster row) with the old approval still on them.
-- The migration does not rewrite them, so the roster write after a payment still passes the guardian rule on that old
-- approval. Expected 0; anything else needs an owner decision (the migration's WHAT IT DOES NOT DO).
--     SELECT count(*) FROM public.join_requests jr
--      WHERE jr.status = 'approved' AND jr.guardian_approved_at < jr.last_rejected_at
--        AND NOT EXISTS (SELECT 1 FROM public.game_participants p WHERE p.game_id = jr.game_id AND p.user_id = jr.player_id);
-- Locks: CREATE OR REPLACE FUNCTION takes a brief lock on each function only; CREATE OR REPLACE TRIGGER takes SHARE ROW
-- EXCLUSIVE on public.join_requests (writers wait, readers do not) until the commit. The wait is limited to 5 s.
BEGIN;
DO $guard$
DECLARE
  _fn  CONSTANT regprocedure := to_regprocedure('public.guardian_cancel_child_game(uuid,text)');
  _gri CONSTANT regprocedure := to_regprocedure('public.game_respond_invite(uuid,boolean)');
  _got text;
BEGIN
  IF current_setting('app.confirm_guardian_cancel_keeps_declined_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: a guardian''s cancel for their child would delete a declined join request again, and with it the resend cooldown and attempt count; and an accepted invitation that reopens a declined request would again seat a minor on a guardian approval given before the host declined. Requests already kept and approvals already taken back stay as they are. Set app.confirm_guardian_cancel_keeps_declined_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _fn IS NULL OR _got IS DISTINCT FROM '791f8fe8e4412acd7fe80b34a516809a' THEN
    RAISE EXCEPTION 'Refusing to run: public.guardian_cancel_child_game(uuid,text) is not the definition 20261130110000 created (md5 %, expected 791f8fe8e4412acd7fe80b34a516809a). A later change needs a person to look first.', _got;
  END IF;
  SELECT p.proowner::regrole::text INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _got IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Refusing to run: public.guardian_cancel_child_game(uuid,text) is owned by %, not postgres. A later change needs a person to look first.', _got;
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Refusing to run: the grants on public.guardian_cancel_child_game(uuid,text) are not the ones 20261130110000 left (%). A later change needs a person to look first.', _got;
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _gri;
  IF _gri IS NULL OR _got IS DISTINCT FROM '79fa287fb3126c74dce0f902542d3e4e' THEN
    RAISE EXCEPTION 'Refusing to run: public.game_respond_invite(uuid,boolean) is not the definition 20261130110000 created (md5 %, expected 79fa287fb3126c74dce0f902542d3e4e). A later change needs a person to look first.', _got;
  END IF;
  SELECT p.proowner::regrole::text INTO _got FROM pg_proc p WHERE p.oid = _gri;
  IF _got IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Refusing to run: public.game_respond_invite(uuid,boolean) is owned by %, not postgres. A later change needs a person to look first.', _got;
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = _gri AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Refusing to run: the grants on public.game_respond_invite(uuid,boolean) are not the ones 20261130110000 left (%). A later change needs a person to look first.', _got;
  END IF;
  SELECT md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text INTO _got FROM pg_trigger t
   WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_reopen_needs_guardian';
  IF _got IS DISTINCT FROM '5480c92ea0314eef6701e1b2d266ddce/O' THEN
    RAISE EXCEPTION 'Refusing to run: trigger trg_join_request_reopen_needs_guardian on public.join_requests is not the one 20261130110000 created, enabled (md5/tgenabled %, expected 5480c92ea0314eef6701e1b2d266ddce/O). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.guardian_cancel_child_game(_child uuid, _game text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g record;
  _had_spot boolean;
  _had_request boolean;
  _was_late boolean;
  _who text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_guardian_of(auth.uid(), _child) THEN
    RAISE EXCEPTION 'You can only cancel for a child linked to your account.' USING ERRCODE = '42501';
  END IF;

  SELECT id, title, date, host_id, cancelled_at, completed_at INTO g
    FROM public.hosted_games WHERE id = _game;
  IF g.id IS NULL THEN RAISE EXCEPTION 'Game not found.' USING ERRCODE = 'P0001'; END IF;
  IF g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This game is no longer on.' USING ERRCODE = 'P0001';
  END IF;
  IF now() >= g.date THEN
    RAISE EXCEPTION 'This game has already started.' USING ERRCODE = 'P0001';
  END IF;

  _had_spot := EXISTS (SELECT 1 FROM public.game_participants WHERE game_id = _game AND user_id = _child)
            OR EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = _game AND player_id = _child AND status = 'approved');
  _had_request := EXISTS (SELECT 1 FROM public.join_requests WHERE game_id = _game AND player_id = _child);
  IF NOT _had_spot AND NOT _had_request THEN RETURN 'nothing'; END IF;

  DELETE FROM public.payment_submissions
   WHERE game_id = _game AND player_id = _child AND status = 'pending';
  DELETE FROM public.join_requests WHERE game_id = _game AND player_id = _child;
  DELETE FROM public.game_participants WHERE game_id = _game AND user_id = _child;

  IF _had_spot AND g.host_id IS NOT NULL AND g.host_id <> _child THEN
    _was_late := EXISTS (
      SELECT 1 FROM public.late_cancellations
       WHERE user_id = _child AND kind = 'game' AND ref_id = _game AND created_at >= now() - interval '1 minute');
    -- A late cancel already sent the host its own notice.
    IF NOT _was_late THEN
      SELECT display_name INTO _who FROM public.profiles WHERE id = _child;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        g.host_id, 'participant_left',
        left(COALESCE(_who, 'A player') || ' left ' || g.title, 200),
        'Their parent or guardian cancelled for them. Their spot is open again.',
        '/games/' || g.id
      );
    END IF;
  END IF;
  RETURN CASE WHEN _had_spot THEN 'cancelled' ELSE 'withdrawn' END;
END;
$$;

-- 20261127120000_invite_accept_roster.sql:53-156, verbatim.
CREATE OR REPLACE FUNCTION public.game_respond_invite(_invite uuid, _accept boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me   uuid := auth.uid();
  _i    record;
  _g    record;
  _jr   record;
  _jrid uuid;
  _name text;
  _fee  numeric;
  _held boolean;
  _seat boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _i FROM public.game_invites WHERE id = _invite AND invitee_id = _me FOR UPDATE;
  IF _i.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _i.status <> 'pending' THEN
    RETURN jsonb_build_object('status', _i.status, 'join_request_id', _i.join_request_id,
                              'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  IF NOT _accept THEN
    UPDATE public.game_invites SET status = 'declined', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'declined', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  SELECT id, host_id, title, max_players, price INTO _g FROM public.hosted_games WHERE id = _i.game_id FOR NO KEY UPDATE;
  IF NOT private_sec.game_open_for_invites(_i.game_id) OR _g.host_id IS DISTINCT FROM _i.host_id THEN
    UPDATE public.game_invites SET status = 'expired', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'expired', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  -- The player's place request for this game (one per game and player), held until the end.
  SELECT id, status, reviewed_at, last_rejected_at, reviewer_notes, guardian_approved_at, guardian_approved_by INTO _jr
    FROM public.join_requests WHERE game_id = _i.game_id AND player_id = _me FOR UPDATE;

  -- Taken back: declined at or after the invitation, whether still declined or sent again since. The decline's time is
  -- last_rejected_at (server clock); reviewed_at (the host's device clock) only on a declined row that has none. A
  -- decline the host did not make (the payment window ran out, a guardian said no) is not a take-back.
  IF _jr.id IS NOT NULL AND _jr.status IN ('rejected', 'pending')
     AND COALESCE(_jr.last_rejected_at, CASE WHEN _jr.status = 'rejected' THEN _jr.reviewed_at END) >= _i.created_at
     AND NOT (_jr.status = 'rejected'
              AND COALESCE(_jr.reviewer_notes, '') IN ('Payment window expired — your spot was released.',
                                                       'Declined by guardian')) THEN
    UPDATE public.game_invites SET status = 'expired', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'expired', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;

  -- The join gate's fee rule: the payee's newest settings row, else the game's price.
  SELECT s.entry_fee INTO _fee
    FROM public.game_payment_settings s
   WHERE s.game_id = _i.game_id AND s.host_id = private_sec.game_payee(s.game_id)
   ORDER BY s.created_at DESC
   LIMIT 1;
  IF NOT FOUND THEN _fee := _g.price; END IF;
  -- The roster trigger's guardian rule, for the request as it stands once approved.
  _held := COALESCE(public.is_minor(_me), false)
           AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = 'active')
           AND NOT COALESCE(_jr.guardian_approved_at IS NOT NULL
                            AND private_sec.guardian_approval_valid(_me, _jr.guardian_approved_by), false);
  _seat := COALESCE(_fee, 0) <= 0 AND NOT _held;

  -- Free with no guardian step: the other players' rows. Otherwise, as before: every row.
  IF (SELECT count(*) FROM public.game_participants p
       WHERE p.game_id = _i.game_id AND (NOT _seat OR p.user_id <> _me)) >= _g.max_players THEN
    RETURN jsonb_build_object('status', 'full', 'on_roster', private_sec.is_game_participant(_i.game_id, _me));
  END IF;
  IF NOT COALESCE(private_sec.game_age_fits(_i.game_id, _me), false) THEN
    RAISE EXCEPTION 'INVITE_NOT_AVAILABLE: this invitation can''t be accepted.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The place request: created as the player (every insert check applies), then approved, as the host would.
  IF _jr.id IS NULL THEN
    INSERT INTO public.join_requests (game_id, host_id, player_id, message, idempotency_key)
    VALUES (_i.game_id, _g.host_id, _me, 'Accepted the host''s invitation', 'invite:' || _invite)
    RETURNING id INTO _jrid;
  ELSE
    _jrid := _jr.id;
  END IF;
  UPDATE public.join_requests
     SET status = 'approved', reviewed_at = now(), reviewer_notes = 'Invited by the host'
   WHERE id = _jrid AND status <> 'approved';

  -- The place itself, as the player, through every roster trigger; a refusal ends the whole accept.
  IF _seat AND NOT private_sec.is_game_participant(_i.game_id, _me) THEN
    INSERT INTO public.game_participants (game_id, user_id) VALUES (_i.game_id, _me)
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.game_invites
     SET status = 'accepted', responded_at = now(), updated_at = now(), join_request_id = _jrid
   WHERE id = _invite;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'A player') INTO _name FROM public.profiles p WHERE p.id = _me;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_g.host_id, 'game_invite_accepted', left(COALESCE(_name, 'A player') || ' accepted your invitation', 200),
          left(_g.title, 300), '/games/' || _i.game_id);
  RETURN jsonb_build_object('status', 'accepted', 'join_request_id', _jrid,
                            'on_roster', private_sec.is_game_participant(_i.game_id, _me));
END $$;

-- 20261110120000_guardian_approval_validity.sql:501-506, the condition as it was.
CREATE OR REPLACE TRIGGER trg_join_request_reopen_needs_guardian
BEFORE UPDATE OF status ON public.join_requests
FOR EACH ROW
WHEN (OLD.status = 'rejected' AND NEW.status = 'pending'
      AND (NEW.guardian_approved_at IS NOT NULL OR NEW.guardian_approved_by IS NOT NULL))
EXECUTE FUNCTION private_sec.join_request_reopen_needs_guardian();

DO $check$
DECLARE
  _fn  CONSTANT regprocedure := 'public.guardian_cancel_child_game(uuid,text)'::regprocedure;
  _gri CONSTANT regprocedure := 'public.game_respond_invite(uuid,boolean)'::regprocedure;
  _got text;
BEGIN
  SELECT md5(pg_get_functiondef(_fn)) INTO _got;
  IF _got IS DISTINCT FROM 'db2a64a1cda58c6180ba3080a3b1ede0' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored public.guardian_cancel_child_game(uuid,text) has md5 %, not the 20261008160000 definition db2a64a1cda58c6180ba3080a3b1ede0.', _got;
  END IF;
  SELECT p.proowner::regrole::text INTO _got FROM pg_proc p WHERE p.oid = _fn;
  IF _got IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored guardian_cancel_child_game is owned by %, not postgres.', _got;
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = _fn AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored guardian_cancel_child_game''s grants are %, not authenticated:EXECUTE,service_role:EXECUTE.', _got;
  END IF;
  SELECT md5(pg_get_functiondef(_gri)) INTO _got;
  IF _got IS DISTINCT FROM '9c24daeafcdd5dd4443c612a7cf040d3' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored public.game_respond_invite(uuid,boolean) has md5 %, not the 20261127120000 definition 9c24daeafcdd5dd4443c612a7cf040d3.', _got;
  END IF;
  SELECT p.proowner::regrole::text INTO _got FROM pg_proc p WHERE p.oid = _gri;
  IF _got IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored game_respond_invite is owned by %, not postgres.', _got;
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = _gri AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored game_respond_invite''s grants are %, not authenticated:EXECUTE,service_role:EXECUTE.', _got;
  END IF;
  SELECT md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text INTO _got FROM pg_trigger t
   WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_reopen_needs_guardian';
  IF _got IS DISTINCT FROM '9fd20b7ed6dd5ef0a8ed38bc22e473f6/O' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored trigger trg_join_request_reopen_needs_guardian has md5/tgenabled %, not the 20261110120000 definition, enabled (9fd20b7ed6dd5ef0a8ed38bc22e473f6/O).', _got;
  END IF;
END
$check$;
COMMIT;
