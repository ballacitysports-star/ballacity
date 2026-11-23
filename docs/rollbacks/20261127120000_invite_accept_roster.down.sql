-- ROLLBACK for supabase/migrations/20261127120000_invite_accept_roster.sql (WP 5.5, narrowed: an accepted invitation to a
-- free game puts the player on the roster; a taken-back invitation cannot be accepted).
-- NOT a migration. It puts public.game_respond_invite back exactly as 20261119100000 wrote it, with the same grants: accepting
-- approves the player's place request and writes no roster row (the game page's auto-join does that on a free game), and an
-- invitation can again be accepted after the host declined the request it was sent for. The answer no longer
-- carries on_roster; the app reads a missing on_roster as false and shows its earlier "open the game" message.
-- Nothing stored is changed: roster rows written by accepts, requests, invitations marked 'expired' and notifications stay.
-- It stops, changing nothing, unless game_respond_invite still has the definition and the grants 20261127120000 gave it (a
-- later change needs a person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_invite_accept_roster_rollback = 'yes';
-- Locks: CREATE OR REPLACE FUNCTION locks only the function's catalog row; no app table is locked.
-- After it, docs/rollbacks/20261119100000_game_invites.down.sql recognises the function again.
BEGIN;
DO $guard$
DECLARE
  _got text;
BEGIN
  IF current_setting('app.confirm_invite_accept_roster_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: accepting an invitation to a free game would stop putting the player on the roster, and invitations whose request was declined since could be accepted again. Set app.confirm_invite_accept_roster_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.game_respond_invite(uuid,boolean)');
  IF _got IS DISTINCT FROM '9c24daeafcdd5dd4443c612a7cf040d3' THEN
    RAISE EXCEPTION 'Refusing to run: public.game_respond_invite(uuid,boolean) is not the definition 20261127120000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
  -- only the API roles and PUBLIC: the owner's own entry is whatever the platform made it
  SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type || CASE WHEN a.is_grantable THEN '*' ELSE '' END,
                    ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
    INTO _got
    FROM pg_proc p
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    LEFT JOIN pg_roles r ON r.oid = a.grantee
   WHERE p.oid = to_regprocedure('public.game_respond_invite(uuid,boolean)')
     AND (a.grantee = 0 OR r.rolname IN ('anon', 'authenticated', 'service_role'));
  IF _got IS DISTINCT FROM 'authenticated:EXECUTE,service_role:EXECUTE' THEN
    RAISE EXCEPTION 'Refusing to run: the grants on public.game_respond_invite(uuid,boolean) are not the ones 20261127120000 left (%). A later change needs a person to look first.', _got;
  END IF;
END $guard$;

-- 20261119100000_game_invites.sql:253-313, verbatim.
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
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _i FROM public.game_invites WHERE id = _invite AND invitee_id = _me FOR UPDATE;
  IF _i.id IS NULL THEN RAISE EXCEPTION 'INVITE_NOT_FOUND'; END IF;
  IF _i.status <> 'pending' THEN RETURN jsonb_build_object('status', _i.status, 'join_request_id', _i.join_request_id); END IF;

  IF NOT _accept THEN
    UPDATE public.game_invites SET status = 'declined', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'declined');
  END IF;

  SELECT id, host_id, title, max_players INTO _g FROM public.hosted_games WHERE id = _i.game_id FOR NO KEY UPDATE;
  IF NOT private_sec.game_open_for_invites(_i.game_id) OR _g.host_id IS DISTINCT FROM _i.host_id THEN
    UPDATE public.game_invites SET status = 'expired', responded_at = now(), updated_at = now() WHERE id = _invite;
    RETURN jsonb_build_object('status', 'expired');
  END IF;
  IF (SELECT count(*) FROM public.game_participants p WHERE p.game_id = _i.game_id) >= _g.max_players THEN
    RETURN jsonb_build_object('status', 'full');
  END IF;
  IF NOT COALESCE(private_sec.game_age_fits(_i.game_id, _me), false) THEN
    RAISE EXCEPTION 'INVITE_NOT_AVAILABLE: this invitation can''t be accepted.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The place request: created as the player (every insert check applies), then approved, as the host would.
  SELECT id, status INTO _jr FROM public.join_requests WHERE game_id = _i.game_id AND player_id = _me FOR UPDATE;
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

  UPDATE public.game_invites
     SET status = 'accepted', responded_at = now(), updated_at = now(), join_request_id = _jrid
   WHERE id = _invite;

  SELECT COALESCE(NULLIF(btrim(p.display_name), ''), 'A player') INTO _name FROM public.profiles p WHERE p.id = _me;
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_g.host_id, 'game_invite_accepted', left(COALESCE(_name, 'A player') || ' accepted your invitation', 200),
          left(_g.title, 300), '/games/' || _i.game_id);
  RETURN jsonb_build_object('status', 'accepted', 'join_request_id', _jrid);
END $$;
REVOKE ALL ON FUNCTION public.game_respond_invite(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_respond_invite(uuid, boolean) TO authenticated;

COMMIT;
