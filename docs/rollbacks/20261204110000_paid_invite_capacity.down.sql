-- ROLLBACK for supabase/migrations/20261204110000_paid_invite_capacity.sql (on a paid game, an invitation's accept
-- counts the places approved players who have not paid yet already hold).
-- NOT a migration. It puts back, verbatim, the one definition the migration replaced:
--   - public.game_respond_invite(uuid, boolean) as 20261130110000 created it: on a paid game the accept counts roster
--     rows only again, so invitees accepting the last place are each approved.
-- Nothing else changes, because the migration changed nothing else (no grant, owner, table, policy, trigger or other
-- function).
--
-- WHAT IT CANNOT UNDO (and does not need to): invitations answered full while the migration was applied stay pending
-- (the invitee can accept again, and after the rollback is approved on a paid game whatever the approvals). No row was
-- written by the full answer, so there is nothing to clear. After the rollback, invitees on a paid game can again be
-- approved for more places than there are, and the last to pay can be paid but not placed (the gap the migration
-- closed). Say so in the release record. The app copes with either version: the accept's answers have the same shape.
-- It stops, changing nothing, unless game_respond_invite is exactly what 20261204110000 created (md5 below), owned by
-- postgres, SECURITY DEFINER with search_path '' and with the same API-role grants (EXECUTE for authenticated and
-- service_role; none for PUBLIC or anon): a later change needs a person to look first (CREATE OR REPLACE would keep a
-- changed owner on this SECURITY DEFINER function). After restoring, it checks the function is exactly what it was
-- before the migration (md5 79fa287fb3126c74dce0f902542d3e4e) with the same owner, settings and grants and, if not,
-- undoes itself.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_paid_invite_capacity_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_paid_invite_capacity_rollback=yes")
-- ORDER: run this before docs/rollbacks/20261130110000_guardian_cancel_keeps_declined_request.down.sql (that one's
-- guard expects game_respond_invite as 20261130110000 left it, which this file restores). It is independent of the
-- rollbacks of 20261202100000 and 20261204100000, which neither restore nor check game_respond_invite.
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger
-- row for 20261204110000 by hand (as the earlier release records do), or the ledger says applied while the definition is
-- the old one, and a later re-apply hits a primary-key conflict.
-- PRODUCTION CHECK: the md5 values here were computed on the local Postgres 16; production runs 17 and
-- pg_get_functiondef text may differ between versions. The guard fails closed (it refuses, changing nothing), but do not
-- find that out in an emergency: after applying the migration, run this read-only query in production and record the
-- result in the release record. It must equal 7372bcebab32979448f5327cd9f74413/postgres/true/{"search_path=\"\""} and
-- authenticated:EXECUTE,service_role:EXECUTE; if not, the guard values here need a person to look first.
--     SELECT md5(pg_get_functiondef(p.oid)) || '/' || p.proowner::regrole::text || '/' || p.prosecdef::text || '/'
--            || p.proconfig::text FROM pg_proc p WHERE p.oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure;
--     SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
--       FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
--       LEFT JOIN pg_roles r ON r.oid = x.grantee
--      WHERE p.oid = 'public.game_respond_invite(uuid,boolean)'::regprocedure
--        AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
-- Locks: CREATE OR REPLACE FUNCTION takes a brief lock on the function only, until the commit. The wait is limited to
-- 5 s.
BEGIN;
DO $guard$
DECLARE
  _gri CONSTANT regprocedure := to_regprocedure('public.game_respond_invite(uuid,boolean)');
  _got text;
BEGIN
  IF current_setting('app.confirm_paid_invite_capacity_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: on a paid game, invitees accepting the last place would each be approved again, so more players could be approved than there are places and the last to pay could be paid but not placed. Set app.confirm_paid_invite_capacity_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = _gri;
  IF _gri IS NULL OR _got IS DISTINCT FROM '7372bcebab32979448f5327cd9f74413' THEN
    RAISE EXCEPTION 'Refusing to run: public.game_respond_invite(uuid,boolean) is not the definition 20261204110000 created (md5 %, expected 7372bcebab32979448f5327cd9f74413). A later change needs a person to look first.', coalesce(_got, 'missing');
  END IF;
  SELECT p.proowner::regrole::text || '/' || p.prosecdef::text || '/' || p.proconfig::text INTO _got FROM pg_proc p WHERE p.oid = _gri;
  IF _got IS DISTINCT FROM 'postgres/true/{"search_path=\"\""}' THEN
    RAISE EXCEPTION 'Refusing to run: public.game_respond_invite(uuid,boolean) has owner/SECURITY DEFINER/settings %, not postgres/true/{"search_path=\"\""}. A later change needs a person to look first.', _got;
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
    INTO _got
    FROM pg_proc p
    CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE p.oid = _gri AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Refusing to run: the grants on public.game_respond_invite(uuid,boolean) are not the ones 20261204110000 left (%). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- 20261130110000_guardian_cancel_keeps_declined_request.sql:251-362, the definition as it was.
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
  _guarded boolean;
  _on   boolean;
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
  -- The roster trigger's guardian rule, for the request as it stands once approved. A declined request carries no
  -- guardian approval once approved: the update below reopens it, and trg_join_request_reopen_needs_guardian clears it.
  -- A guarded minor already on the roster under a declined request (a host's decline that did not remove them) keeps
  -- both as they are: the update below leaves that request declined, with its approval. Anyone else's is reopened.
  _guarded := COALESCE(public.is_minor(_me), false)
              AND EXISTS (SELECT 1 FROM public.guardian_links WHERE child_user_id = _me AND status = 'active');
  _on := _guarded AND private_sec.is_game_participant(_i.game_id, _me);
  _held := _guarded
           AND NOT COALESCE((_jr.status IS DISTINCT FROM 'rejected' OR _on)
                            AND _jr.guardian_approved_at IS NOT NULL
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
   WHERE id = _jrid AND status <> 'approved' AND NOT (status = 'rejected' AND _on);

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

DO $check$
DECLARE
  _gri CONSTANT regprocedure := 'public.game_respond_invite(uuid,boolean)'::regprocedure;
  _got text;
BEGIN
  SELECT md5(pg_get_functiondef(_gri)) INTO _got;
  IF _got IS DISTINCT FROM '79fa287fb3126c74dce0f902542d3e4e' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored public.game_respond_invite(uuid,boolean) has md5 %, not the 20261130110000 definition 79fa287fb3126c74dce0f902542d3e4e.', _got;
  END IF;
  SELECT p.proowner::regrole::text || '/' || p.prosecdef::text || '/' || p.proconfig::text INTO _got FROM pg_proc p WHERE p.oid = _gri;
  IF _got IS DISTINCT FROM 'postgres/true/{"search_path=\"\""}' THEN
    RAISE EXCEPTION 'Rolled back nothing: the restored game_respond_invite has owner/SECURITY DEFINER/settings %, not postgres/true/{"search_path=\"\""}.', _got;
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
END
$check$;
COMMIT;
