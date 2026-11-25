-- ROLLBACK for supabase/migrations/20261202100000_removal_sticks.sql (a host's removal is recorded in
-- public.game_removals and keeps the player out of that game, open games included, until an accepted invitation or the
-- host's approval of their request lets them back).
-- NOT a migration. First it drops what the migration added to close two older holes: the roster identity lock (trigger
-- a0_game_participants_identity_locked on public.game_participants; the function it runs, private_sec.lock_row_identity,
-- is 20261125100000's and stays) and the claim reopen block (trigger zz_payment_claim_reopen_removed on
-- public.payment_submissions and its function private_sec.removed_player_claim_reopen_block()). Then it puts back,
-- verbatim, the six definitions the migration replaced:
--   - public.enforce_game_join_gate() as 20261103140000 created it (no REMOVED_BY_HOST check);
--   - public.host_remove_player(text, uuid) as 20261129130000 created it (writes no record);
--   - private_sec.payment_claim_block(text, uuid) and public.enforce_payment_claim_preconditions() as 20261119200000
--     created them (no REMOVED_BY_HOST answer or wording);
--   - public.notify_waitlist_on_spot_open() as 20261027150000 created it and public.release_expired_payment_holds(text)
--     as 20261125100000 created it (their waitlist picks no longer skip a removed player);
-- and drops what it added: trigger trg_join_request_approval_lifts_removal on public.join_requests, its function
-- private_sec.join_request_approval_lifts_removal(), and table public.game_removals with its index, its three read
-- rules (player, host, guardian) and grants.
--
-- WHAT IT CANNOT UNDO: the records are deleted with the table and are not kept anywhere. After the rollback every
-- player removed while the migration was applied can join an open game again with one tap, and can pay for a paid open
-- game again (the gaps the migration closed). Requests a removed player sent to ask back stay as they are (ordinary
-- requests the host answers). The two older holes open again: a player who hosts a game can again move her own seat in
-- it into another game past every join check (UPDATE of game_id; the joined counts go wrong), and a player's cancelled
-- or declined claim can be reopened whatever happened in the game. Say so in the release record. The app copes with either version: it reads a missing
-- table as "not removed", and the roster's Remove calls host_remove_player, whose answer keeps its shape.
--
-- It stops, changing nothing, unless each of the six functions, the lift function and the claim reopen function is
-- exactly what 20261202100000 created (md5 below), owned by postgres with the API-role grants it left; the three
-- triggers (the lift, the roster identity lock, the claim reopen block) are the ones it created and enabled (tgenabled
-- 'O', which pg_get_triggerdef does not show); the table exists, owned by postgres, with exactly the
-- three read rules it created (names, commands, roles and expressions, md5 below) and its API grants; and no other
-- function's source names game_removals (a later change that reads it would break when the table goes). A later change
-- to any of them needs a person to look first (CREATE OR REPLACE would keep a changed owner on these SECURITY DEFINER
-- functions). After restoring, it checks each function is exactly what it was before the migration (md5, owner, grants),
-- that the three triggers, the two functions and the table are gone and that private_sec.lock_row_identity() is still
-- 20261125100000's, and if not, undoes itself.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_removal_sticks_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_removal_sticks_rollback=yes")
-- ORDER: run this before the rollbacks of the migrations whose definitions it replaced. These pin them and refuse to
-- run until this one has: docs/rollbacks/20261129130000_host_removal_and_decline_end_invites.down.sql
-- (host_remove_player), docs/rollbacks/20261125100000_profile_blocks_suspension.down.sql
-- (release_expired_payment_holds) and docs/rollbacks/20261119200000_payment_claim_preconditions.down.sql
-- (payment_claim_block, enforce_payment_claim_preconditions). docs/rollbacks/20261103140000_payment_settings_host_guard.down.sql
-- (enforce_game_join_gate, release_expired_payment_holds) has NO definition guard, only its confirmation setting: run
-- while 20261202100000 is applied it silently overwrites the join gate and the release sweep, dropping the
-- REMOVED_BY_HOST check and the sweep's waitlist exclusion while game_removals and the lift trigger stay (removals
-- recorded, not enforced), and this rollback then refuses on the gate's md5. Do not run it before this one. The
-- 20261125100000 rollback also lists the triggers that run lock_row_identity and refuses while the roster lock exists.
-- The rollback of 20261130110000 is independent of this one.
-- docs/release/p0-1-verify.sql pins enforce_game_join_gate's earlier md5 9d4924a2... and passes again after this.
-- LEDGER: this file does not touch supabase_migrations.schema_migrations. After a successful rollback, delete the ledger
-- row for 20261202100000 by hand (as the earlier release records do), or the ledger says applied while the definitions
-- are the old ones, and a later re-apply hits a primary-key conflict.
-- PRODUCTION CHECK: the md5 values here were computed on the local Postgres 16; production runs 17 and
-- pg_get_functiondef and pg_get_triggerdef text may differ between versions. The guard fails closed (it refuses,
-- changing nothing), but do not find that out in an emergency: after applying the migration, run this read-only query
-- in production and record the result in the release record. It must list exactly the md5 values in the guard below
-- (and the triggers' md5/tgenabled values, and the rules and grants below); if not, the guard values here need a person
-- to look first.
--     SELECT p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid)), p.proowner::regrole::text FROM pg_proc p
--      WHERE p.oid IN ('public.enforce_game_join_gate()'::regprocedure, 'public.host_remove_player(text,uuid)'::regprocedure,
--                      'private_sec.payment_claim_block(text,uuid)'::regprocedure,
--                      'public.enforce_payment_claim_preconditions()'::regprocedure,
--                      'public.notify_waitlist_on_spot_open()'::regprocedure,
--                      'public.release_expired_payment_holds(text)'::regprocedure,
--                      'private_sec.join_request_approval_lifts_removal()'::regprocedure,
--                      'private_sec.removed_player_claim_reopen_block()'::regprocedure) ORDER BY 1;
--     SELECT t.tgname, md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text FROM pg_trigger t
--      WHERE t.tgname IN ('trg_join_request_approval_lifts_removal', 'a0_game_participants_identity_locked',
--                         'zz_payment_claim_reopen_removed') ORDER BY 1;
--   (expected a0_game_participants_identity_locked f59806a68e385137054282f471530f39/O,
--    trg_join_request_approval_lifts_removal 5717e06a7d4c0e7a04b5a348282c3d05/O,
--    zz_payment_claim_reopen_removed 38f2c4f9c52cc6f91209cfc07803d33a/O)
--   and the table's read rules (expected ab255a506544f1008e1f8364422aadee; pg_get_expr text may differ on 17) and grants
--   (expected authenticated:SELECT,service_role:SELECT):
--     SELECT md5(string_agg(pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
--                           || array_to_string(ARRAY(SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY (pol.polroles) ORDER BY 1), ',')
--                           || '|' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|'
--                           || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), E'\n' ORDER BY pol.polname))
--       FROM pg_policy pol WHERE pol.polrelid = 'public.game_removals'::regclass;
--     SELECT string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type)
--       FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
--       LEFT JOIN pg_roles r ON r.oid = x.grantee
--      WHERE c.oid = 'public.game_removals'::regclass AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
-- Locks: CREATE OR REPLACE FUNCTION takes a brief lock on each function only; DROP TRIGGER takes ACCESS EXCLUSIVE on
-- public.payment_submissions, public.game_participants and public.join_requests (readers of those wait too, briefly)
-- and DROP TABLE takes it on public.game_removals and, through the foreign keys, SHARE ROW
-- EXCLUSIVE on public.hosted_games and auth.users, all until the commit (readers of join_requests wait too, briefly).
-- The wait for each is limited to 5 s.
BEGIN;
DO $guard$
DECLARE
  -- function, md5 20261202100000 created, API-role grants it left (EXECUTE).
  _want CONSTANT text[][] := ARRAY[
    ['public.enforce_game_join_gate()',                       '2bdfe7df2e0abbedc2dd5045e8099165', 'service_role:EXECUTE'],
    ['public.host_remove_player(text,uuid)',                  '58686b8ca8759ead2bfb2b4b4bfe5d22', 'authenticated:EXECUTE,service_role:EXECUTE'],
    ['private_sec.payment_claim_block(text,uuid)',            'd2e6c529f15a03003261b677ff68d8fb', ''],
    ['public.enforce_payment_claim_preconditions()',          'a48c3474f7c9921a8796e66cdcb2cf84', 'service_role:EXECUTE'],
    ['public.notify_waitlist_on_spot_open()',                 'b036830532749c978470516b36ce40c5', 'service_role:EXECUTE'],
    ['public.release_expired_payment_holds(text)',            '84331f438d4dde5a3a0b312e8007a7e6', 'authenticated:EXECUTE,service_role:EXECUTE'],
    ['private_sec.join_request_approval_lifts_removal()',     'b755c4e40e0ca5d6ef8ae90de73d4b5e', ''],
    ['private_sec.removed_player_claim_reopen_block()',       '1e6dfeb3273b0ef6e7fb9d58ac7f0cfd', '']];
  _got text;
BEGIN
  IF current_setting('app.confirm_removal_sticks_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: every recorded removal would be deleted, and every player a host removed would be able to join an open game again with one tap (and pay for a paid open game). Set app.confirm_removal_sticks_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261202100000 created (md5 %, expected %). A later change needs a person to look first.',
        _want[i][1], coalesce(_got, 'missing'), _want[i][2];
    END IF;
    SELECT p.proowner::regrole::text INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'Refusing to run: % is owned by %, not postgres. A later change needs a person to look first.', _want[i][1], _got;
    END IF;
    SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = to_regprocedure(_want[i][1]) AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF _got IS DISTINCT FROM _want[i][3] THEN
      RAISE EXCEPTION 'Refusing to run: the grants on % are not the ones 20261202100000 left (%, expected %). A later change needs a person to look first.',
        _want[i][1], _got, _want[i][3];
    END IF;
  END LOOP;
  -- The three triggers it created, on their tables, enabled.
  SELECT string_agg(n.nspname || '.' || c.relname || '.' || t.tgname || '=' || md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text,
                    ', ' ORDER BY t.tgname)
    INTO _got FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE t.tgname IN ('trg_join_request_approval_lifts_removal', 'a0_game_participants_identity_locked',
                      'zz_payment_claim_reopen_removed') AND NOT t.tgisinternal;
  IF _got IS DISTINCT FROM 'public.game_participants.a0_game_participants_identity_locked=f59806a68e385137054282f471530f39/O, '
                           'public.join_requests.trg_join_request_approval_lifts_removal=5717e06a7d4c0e7a04b5a348282c3d05/O, '
                           'public.payment_submissions.zz_payment_claim_reopen_removed=38f2c4f9c52cc6f91209cfc07803d33a/O' THEN
    RAISE EXCEPTION 'Refusing to run: the triggers 20261202100000 created are not as it left them, enabled (%). A later change needs a person to look first.', coalesce(_got, 'none');
  END IF;
  -- The function the roster lock runs stays (20261125100000's); it must still be the one the migration checked.
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.lock_row_identity()');
  IF _got IS DISTINCT FROM '9204d58bcb421322580ad4fb20c3029c' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.lock_row_identity() has md5 %, not 20261125100000''s 9204d58bcb421322580ad4fb20c3029c. A later change needs a person to look first.', coalesce(_got, 'missing');
  END IF;
  SELECT c.relowner::regrole::text INTO _got FROM pg_class c WHERE c.oid = to_regclass('public.game_removals');
  IF _got IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'Refusing to run: table public.game_removals is missing or owned by % (not postgres). A later change needs a person to look first.', _got;
  END IF;
  -- Its rules and API grants, as 20261202100000 left them (a rule or grant added since would go with the table).
  SELECT md5(string_agg(pol.polname || '|' || pol.polcmd::text || '|' || pol.polpermissive::text || '|'
                        || array_to_string(ARRAY(SELECT r.rolname FROM pg_roles r WHERE r.oid = ANY (pol.polroles) ORDER BY 1), ',')
                        || '|' || coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || '|'
                        || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), E'\n' ORDER BY pol.polname))
    INTO _got FROM pg_policy pol WHERE pol.polrelid = 'public.game_removals'::regclass;
  IF _got IS DISTINCT FROM 'ab255a506544f1008e1f8364422aadee' THEN
    RAISE EXCEPTION 'Refusing to run: the rules on public.game_removals are not the three 20261202100000 created (md5 %, expected ab255a506544f1008e1f8364422aadee). A later change needs a person to look first.', coalesce(_got, 'none');
  END IF;
  SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC'), x.privilege_type), '')
    INTO _got
    FROM pg_class c
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
    LEFT JOIN pg_roles r ON r.oid = x.grantee
   WHERE c.oid = 'public.game_removals'::regclass AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
  IF _got IS DISTINCT FROM 'authenticated:SELECT,service_role:SELECT' THEN
    RAISE EXCEPTION 'Refusing to run: the API grants on public.game_removals are not the ones 20261202100000 left (%, expected authenticated:SELECT,service_role:SELECT). A later change needs a person to look first.', _got;
  END IF;
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY 1) INTO _got FROM pg_proc p
   WHERE p.prosrc LIKE '%game_removals%'
     AND p.oid <> ALL (ARRAY(SELECT to_regprocedure(_want[s.n][1]) FROM generate_subscripts(_want, 1) AS s(n)));
  IF _got IS NOT NULL THEN
    RAISE EXCEPTION 'Refusing to run: other functions read public.game_removals (%), which this rollback drops. A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- What 20261202100000 added beside the six definitions, first: the claim reopen block and the roster identity lock
-- (private_sec.lock_row_identity stays: 20261125100000's, also run by the waitlist and payment locks).
DROP TRIGGER zz_payment_claim_reopen_removed ON public.payment_submissions;
DROP FUNCTION private_sec.removed_player_claim_reopen_block();
DROP TRIGGER a0_game_participants_identity_locked ON public.game_participants;

-- public.enforce_game_join_gate() as 20261103140000 created it
CREATE OR REPLACE FUNCTION public.enforce_game_join_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  _count int;
  _is_host boolean;
  _self boolean;
  _approved boolean;
  _requires_approval boolean;
  _fee numeric;
  _ends timestamptz;
BEGIN
  -- Lock the game while its roster is checked, so two joins for the last spot
  -- queue up instead of both counting an empty seat. NO KEY UPDATE does not
  -- conflict with the key-share lock the roster row's foreign key takes, so it
  -- cannot deadlock against other writes that reference the game.
  SELECT id, host_id, status, cancelled_at, completed_at, joins_closed,
         signup_cutoff_min, max_players, date, ends_at, duration, price
    INTO g
  FROM public.hosted_games WHERE id = NEW.game_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  _is_host := (g.host_id = auth.uid()) OR (g.host_id = NEW.user_id);
  _self := auth.uid() IS NOT NULL AND auth.uid() = NEW.user_id;

  IF g.cancelled_at IS NOT NULL OR g.status = 'cancelled' THEN
    RAISE EXCEPTION 'GAME_CANCELLED: this game was cancelled by the host.'
      USING ERRCODE = 'P0001';
  END IF;

  IF g.completed_at IS NOT NULL OR g.status = 'completed' THEN
    RAISE EXCEPTION 'GAME_COMPLETED: this game has already ended.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Host roster management bypasses the soft gates below.
  IF _is_host OR public.is_moderator(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- Over by the clock, whether or not anyone marked it completed.
  IF _self THEN
    _ends := CASE
      WHEN g.ends_at IS NOT NULL AND g.ends_at > g.date THEN g.ends_at
      ELSE g.date + make_interval(mins => public.game_duration_minutes(g.duration))
    END;
    IF now() >= _ends THEN
      RAISE EXCEPTION 'GAME_COMPLETED: this game has already ended.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.join_requests jr
     WHERE jr.game_id = NEW.game_id
       AND jr.player_id = NEW.user_id
       AND jr.status = 'approved'
  ) INTO _approved;

  -- Closing joining, or the signup cutoff, stops new players. A player the host
  -- has already approved keeps their place in line to pay and be rostered.
  IF NOT _approved THEN
    IF g.joins_closed THEN
      RAISE EXCEPTION 'GAME_JOINS_CLOSED: the host has closed joining for this game.'
        USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(g.signup_cutoff_min, 0) > 0
       AND now() >= g.date - make_interval(mins => g.signup_cutoff_min) THEN
      RAISE EXCEPTION 'GAME_SIGNUP_CLOSED: signups closed before start time.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  -- What the join screen requires of a player joining for themselves. With no
  -- settings row the screen treats the game as request-to-join, so this does.
  IF _self THEN
    SELECT s.requires_approval, s.entry_fee
      INTO _requires_approval, _fee
    FROM public.game_payment_settings s
    WHERE s.game_id = NEW.game_id
      AND s.host_id = private_sec.game_payee(s.game_id)
    ORDER BY s.created_at DESC
    LIMIT 1;
    IF NOT FOUND THEN
      _requires_approval := true;
      _fee := g.price;
    END IF;

    IF COALESCE(_requires_approval, true) AND NOT _approved THEN
      RAISE EXCEPTION 'GAME_APPROVAL_REQUIRED: the host has to approve your request to join first.'
        USING ERRCODE = 'P0001';
    END IF;

    IF COALESCE(_fee, 0) > 0 AND NOT EXISTS (
      SELECT 1 FROM public.payment_submissions ps
       WHERE ps.game_id = NEW.game_id
         AND ps.player_id = NEW.user_id
         AND ps.status = 'verified'
    ) THEN
      RAISE EXCEPTION 'GAME_PAYMENT_REQUIRED: the entry fee has to be confirmed by the host first.'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT COUNT(*) INTO _count FROM public.game_participants WHERE game_id = NEW.game_id;
  IF _count >= GREATEST(g.max_players, 1) THEN
    RAISE EXCEPTION 'GAME_FULL: the roster is full.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$
;

-- public.host_remove_player(text, uuid) as 20261129130000 created it
CREATE OR REPLACE FUNCTION public.host_remove_player(_game text, _player uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _me        uuid := auth.uid();
  _host      uuid;
  _jr        record;
  _removed   integer := 0;
  _cancelled integer := 0;
  _declined  integer := 0;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  -- The roster DELETE rule's test, before anything is locked.
  SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = _game;
  IF _host IS NULL OR _host IS DISTINCT FROM _me OR _player IS NULL THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can remove players from it.' USING ERRCODE = '42501';
  END IF;

  -- game_respond_invite's order: the invitation, the game, the request.
  PERFORM 1 FROM public.game_invites i
   WHERE i.game_id = _game AND i.invitee_id = _player AND i.status = 'pending'
     FOR UPDATE;
  SELECT g.host_id INTO _host FROM public.hosted_games g WHERE g.id = _game FOR NO KEY UPDATE;
  IF _host IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can remove players from it.' USING ERRCODE = '42501';
  END IF;
  SELECT jr.id, jr.status INTO _jr
    FROM public.join_requests jr
   WHERE jr.game_id = _game AND jr.player_id = _player
     FOR UPDATE;

  DELETE FROM public.game_participants p WHERE p.game_id = _game AND p.user_id = _player;
  GET DIAGNOSTICS _removed = ROW_COUNT;

  -- What game_cancel_invite writes.
  UPDATE public.game_invites i
     SET status = 'cancelled', updated_at = now()
   WHERE i.game_id = _game AND i.invitee_id = _player AND i.status = 'pending';
  GET DIAGNOSTICS _cancelled = ROW_COUNT;

  -- What a host's decline writes; the resubmit trigger stamps last_rejected_at.
  IF _jr.id IS NOT NULL AND _jr.status IS DISTINCT FROM 'rejected' THEN
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Removed by host'
     WHERE id = _jr.id AND status <> 'rejected';
    GET DIAGNOSTICS _declined = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('removed', _removed > 0, 'request_declined', _declined > 0,
                            'invites_cancelled', _cancelled);
END $function$
;

-- private_sec.payment_claim_block(text, uuid) as 20261119200000 created it
CREATE OR REPLACE FUNCTION private_sec.payment_claim_block(_game_id text, _player uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  g record;
  _approved boolean;
  _age int;
  _ends timestamptz;
BEGIN
  SELECT id, host_id, status, cancelled_at, completed_at, joins_closed, signup_cutoff_min, max_players, date, ends_at,
         duration, min_age, max_age
    INTO g
    FROM public.hosted_games WHERE id = _game_id;
  -- No such game: nothing to say here (the caller, or the row's foreign key, answers that).
  IF NOT FOUND OR _player IS NULL THEN
    RETURN NULL;
  END IF;

  -- The join gate refuses any roster place in a cancelled or completed game, the server's included.
  IF g.cancelled_at IS NOT NULL OR g.status = 'cancelled' THEN
    RETURN 'GAME_CANCELLED';
  END IF;
  IF g.completed_at IS NOT NULL OR g.status = 'completed' THEN
    RETURN 'GAME_COMPLETED';
  END IF;
  -- enforce_child_game_participation: the paid place could not be given.
  IF NOT public.child_game_participation_allowed(_player) THEN
    RETURN 'GAME_PARTICIPATION_BLOCKED';
  END IF;
  -- enforce_host_block (one direction: the host blocked the player).
  IF EXISTS (SELECT 1 FROM public.user_blocks b WHERE b.blocker_id = g.host_id AND b.blocked_id = _player) THEN
    RETURN 'BLOCKED_BY_HOST';
  END IF;

  -- The rest decide whether the paid place can be given. A player already on the roster keeps it.
  IF public.is_game_participant(_game_id, _player) THEN
    RETURN NULL;
  END IF;
  _approved := EXISTS (SELECT 1 FROM public.join_requests jr
                        WHERE jr.game_id = _game_id AND jr.player_id = _player AND jr.status = 'approved');
  -- enforce_game_age_requirement: an age range needs a known age inside it, or the host's approval.
  IF (g.min_age IS NOT NULL OR g.max_age IS NOT NULL) AND NOT _approved THEN
    SELECT date_part('year', age(pb.birthday))::int INTO _age
      FROM public.profile_birthdays pb WHERE pb.user_id = _player AND pb.birthday IS NOT NULL;
    IF _age IS NULL OR (g.min_age IS NOT NULL AND _age < g.min_age) OR (g.max_age IS NOT NULL AND _age > g.max_age) THEN
      RETURN 'AGE_REQUIREMENT_NOT_MET';
    END IF;
  END IF;
  -- The join gate's own check for a player joining themselves: over by the clock.
  _ends := CASE
             WHEN g.ends_at IS NOT NULL AND g.ends_at > g.date THEN g.ends_at
             ELSE g.date + make_interval(mins => public.game_duration_minutes(g.duration))
           END;
  IF now() >= _ends THEN
    RETURN 'GAME_COMPLETED';
  END IF;
  -- The join gate: closed joining or the signup cutoff stops a player the host has not approved.
  IF NOT _approved AND (g.joins_closed OR (COALESCE(g.signup_cutoff_min, 0) > 0
                                           AND now() >= g.date - make_interval(mins => g.signup_cutoff_min))) THEN
    RETURN 'GAME_JOINS_CLOSED';
  END IF;
  -- The join gate: a free seat.
  IF (SELECT count(*) FROM public.game_participants gp WHERE gp.game_id = _game_id) >= GREATEST(g.max_players, 1) THEN
    RETURN 'GAME_FULL';
  END IF;

  RETURN NULL;
END
$function$
;

-- public.enforce_payment_claim_preconditions() as 20261119200000 created it
CREATE OR REPLACE FUNCTION public.enforce_payment_claim_preconditions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _code text;
BEGIN
  -- Only the player's own claim. A host's "Marked paid by host" row (the host is the writer) and the service role's
  -- record of a PayPal capture (no signed-in writer; PayPal asked paypal_payment_block before the money moved) pass.
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.player_id THEN
    RETURN NEW;
  END IF;
  _code := private_sec.payment_claim_block(NEW.game_id, NEW.player_id);
  IF _code IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '%: %', _code, CASE _code
      WHEN 'GAME_CANCELLED' THEN 'this game was cancelled, so a payment for it cannot be recorded.'
      WHEN 'GAME_COMPLETED' THEN 'this game has already ended, so a payment for it cannot be recorded.'
      WHEN 'GAME_PARTICIPATION_BLOCKED' THEN 'a parent or guardian has to allow game participation before a payment can be recorded.'
      WHEN 'BLOCKED_BY_HOST' THEN 'you can''t join this host''s games, so a payment cannot be recorded.'
      WHEN 'AGE_REQUIREMENT_NOT_MET' THEN 'this game has an age requirement, so the host has to approve your request first.'
      WHEN 'GAME_JOINS_CLOSED' THEN 'joining is closed for this game, so a payment cannot be recorded.'
      WHEN 'GAME_FULL' THEN 'this game is full, so a payment for a place in it cannot be recorded.'
      ELSE 'a payment for this game cannot be recorded.'
    END
    USING ERRCODE = 'P0001';
END
$function$
;

-- public.notify_waitlist_on_spot_open() as 20261027150000 created it
CREATE OR REPLACE FUNCTION public.notify_waitlist_on_spot_open()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  g record;
  _taken int;
  _next uuid;
BEGIN
  -- An unpaid spot hold being released tells the waitlist itself.
  IF COALESCE(current_setting('ballacity.system_release', true), '') = 'on' THEN
    RETURN OLD;
  END IF;

  SELECT id, title, date, max_players, joins_closed, signup_cutoff_min,
         cancelled_at, completed_at, status
    INTO g
  FROM public.hosted_games WHERE id = OLD.game_id;

  -- The game itself is going away, or is not taking players any more.
  IF NOT FOUND THEN RETURN OLD; END IF;
  IF g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL
     OR COALESCE(g.status, '') IN ('cancelled', 'completed') THEN
    RETURN OLD;
  END IF;
  IF g.joins_closed OR now() >= g.date THEN RETURN OLD; END IF;
  IF COALESCE(g.signup_cutoff_min, 0) > 0
     AND now() >= g.date - make_interval(mins => g.signup_cutoff_min) THEN
    RETURN OLD;
  END IF;

  SELECT COUNT(*) INTO _taken FROM public.game_participants WHERE game_id = OLD.game_id;
  IF _taken >= GREATEST(g.max_players, 1) THEN RETURN OLD; END IF;

  SELECT w.user_id INTO _next
    FROM public.game_position_waitlist w
   WHERE w.game_id = OLD.game_id
     AND w.status = 'waiting'
     AND w.user_id <> OLD.user_id
     AND NOT EXISTS (SELECT 1 FROM public.game_participants gp
                      WHERE gp.game_id = w.game_id AND gp.user_id = w.user_id)
     AND NOT EXISTS (SELECT 1 FROM public.notifications n
                      WHERE n.user_id = w.user_id
                        AND n.type = 'waitlist_spot_open'
                        AND n.link = '/games/' || OLD.game_id
                        AND n.created_at > now() - interval '30 minutes')
   ORDER BY (w.position IS NOT DISTINCT FROM OLD.position) DESC, w.created_at ASC
   LIMIT 1;
  IF _next IS NULL THEN RETURN OLD; END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (
    _next,
    'waitlist_spot_open',
    left('A spot opened up · ' || g.title, 200),
    'You''re next on the waitlist. Grab it before someone else does.',
    '/games/' || OLD.game_id
  );
  RETURN OLD;
END;
$function$
;

-- public.release_expired_payment_holds(text) as 20261125100000 created it
CREATE OR REPLACE FUNCTION public.release_expired_payment_holds(_game_id text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record;
  _next uuid;
  _offered uuid[] := '{}';
  _released integer := 0;
BEGIN
  IF _game_id IS NULL AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'A game id is required.' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('ballacity.system_release', 'on', true);

  FOR r IN
    SELECT jr.id, jr.game_id, jr.player_id, jr.host_id, g.title
      FROM public.join_requests jr
      JOIN public.game_payment_settings s ON s.game_id = jr.game_id
                                         AND s.host_id = private_sec.game_payee(s.game_id)
      JOIN public.hosted_games g ON g.id = jr.game_id
     WHERE jr.status = 'approved'
       AND (_game_id IS NULL OR jr.game_id = _game_id)
       AND jr.reviewed_at IS NOT NULL
       AND s.entry_fee > 0
       AND s.payment_hold_minutes IS NOT NULL
       AND jr.reviewed_at + make_interval(mins => s.payment_hold_minutes) <= now()
       AND now() < g.date
       AND g.cancelled_at IS NULL
       AND g.completed_at IS NULL
       AND COALESCE(g.status, '') NOT IN ('cancelled', 'completed', 'in_progress')
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_submissions ps
          WHERE ps.game_id = jr.game_id
            AND ps.player_id = jr.player_id
            AND ps.status IN ('pending', 'verified')
       )
     FOR UPDATE OF jr SKIP LOCKED
  LOOP
    UPDATE public.join_requests
       SET status = 'rejected',
           reviewer_notes = 'Payment window expired — your spot was released.',
           reviewed_at = now()
     WHERE id = r.id
       AND status = 'approved';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    DELETE FROM public.game_participants
     WHERE game_id = r.game_id
       AND user_id = r.player_id;

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.player_id,
      'payment_hold_expired',
      left('Spot released · ' || r.title, 200),
      'Your payment window ran out, so your spot was released. You can request a spot again if any are open.',
      '/games/' || r.game_id
    );

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (
      r.host_id,
      'payment_hold_expired',
      left('Unpaid spot released · ' || r.title, 200),
      'A player didn''t pay within the hold window, so their spot is open again.',
      '/games/' || r.game_id
    );

    _next := NULL;
    SELECT w.user_id INTO _next
      FROM public.game_position_waitlist w
     WHERE w.game_id = r.game_id
       AND w.status = 'waiting'
       AND w.user_id <> r.player_id
       AND NOT (w.user_id = ANY (_offered))
     ORDER BY w.created_at ASC
     LIMIT 1;
    IF _next IS NOT NULL THEN
      _offered := _offered || _next;
      INSERT INTO public.notifications (user_id, type, title, body, link)
      VALUES (
        _next,
        'waitlist_spot_open',
        left('A spot opened up · ' || r.title, 200),
        'You''re next on the waitlist. Grab it before someone else does.',
        '/games/' || r.game_id
      );
    END IF;

    _released := _released + 1;
  END LOOP;

  RETURN _released;
END;
$function$
;

DROP TRIGGER trg_join_request_approval_lifts_removal ON public.join_requests;
DROP FUNCTION private_sec.join_request_approval_lifts_removal();
DROP TABLE public.game_removals;

DO $check$
DECLARE
  -- function, md5 before 20261202100000, API-role grants (EXECUTE).
  _want CONSTANT text[][] := ARRAY[
    ['public.enforce_game_join_gate()',              '9d4924a2d53915fca8fa245e15281a25', 'service_role:EXECUTE'],
    ['public.host_remove_player(text,uuid)',         'ebdc548c85bd4abf4545f48ced07fddd', 'authenticated:EXECUTE,service_role:EXECUTE'],
    ['private_sec.payment_claim_block(text,uuid)',   '46a3cc02d2146f73270e679d2284a1b9', ''],
    ['public.enforce_payment_claim_preconditions()', '8773e6a6822cd83426eb9d206e884b25', 'service_role:EXECUTE'],
    ['public.notify_waitlist_on_spot_open()',        '0133bf0cb2c54557e05d56de2926daf1', 'service_role:EXECUTE'],
    ['public.release_expired_payment_holds(text)',   '856c6a3999e1dfaf216e12a2ad998004', 'authenticated:EXECUTE,service_role:EXECUTE']];
  _got text;
BEGIN
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION 'Rolled back nothing: the restored % has md5 %, not the earlier definition %.', _want[i][1], _got, _want[i][2];
    END IF;
    SELECT p.proowner::regrole::text INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM 'postgres' THEN
      RAISE EXCEPTION 'Rolled back nothing: the restored % is owned by %, not postgres.', _want[i][1], _got;
    END IF;
    SELECT coalesce(string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || x.privilege_type, ',' ORDER BY coalesce(r.rolname, 'PUBLIC')), '')
      INTO _got
      FROM pg_proc p
      CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
      LEFT JOIN pg_roles r ON r.oid = x.grantee
     WHERE p.oid = to_regprocedure(_want[i][1]) AND coalesce(r.rolname, 'PUBLIC') IN ('PUBLIC', 'anon', 'authenticated', 'service_role');
    IF _got IS DISTINCT FROM _want[i][3] THEN
      RAISE EXCEPTION 'Rolled back nothing: the restored %''s grants are %, not %.', _want[i][1], _got, _want[i][3];
    END IF;
  END LOOP;
  IF to_regclass('public.game_removals') IS NOT NULL
     OR to_regprocedure('private_sec.join_request_approval_lifts_removal()') IS NOT NULL
     OR to_regprocedure('private_sec.removed_player_claim_reopen_block()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgname IN ('trg_join_request_approval_lifts_removal', 'a0_game_participants_identity_locked',
                                    'zz_payment_claim_reopen_removed')) THEN
    RAISE EXCEPTION 'Rolled back nothing: the table, a trigger 20261202100000 created or one of its functions is still there.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.lock_row_identity()');
  IF _got IS DISTINCT FROM '9204d58bcb421322580ad4fb20c3029c' THEN
    RAISE EXCEPTION 'Rolled back nothing: private_sec.lock_row_identity() (20261125100000''s, kept) has md5 %, not 9204d58bcb421322580ad4fb20c3029c.', coalesce(_got, 'missing');
  END IF;
END
$check$;
COMMIT;
