-- A host's removal sticks, on open games too. Owner decisions 2026-11-24: "Removal sticks on open games", and for the
-- way back, "Ask the host, or an invite": a removed player can ask the host to let them back in (a join request the
-- host approves or not; the request's resend cooldown and attempt cap apply to a resend of it, see WHAT IT DOES NOT
-- DO), and an accepted invitation also lets them back.
--
-- WHY. host_remove_player (20261129130000) takes the roster row, declines the player's request and cancels their
-- pending invitation. On a game that needs the host's approval that holds: the join gate refuses a player without an
-- approved request. On an open game (requires_approval false) the gate never reads the request, so a removed player
-- joined again with one tap (988's "NOT CLOSED" line; the open item in docs/product/phase-5-validation-plan.md). The
-- same held for a paid open game with a verified payment (the gate's payment check passes), for the server's roster
-- write after a payment, and for the waitlist notice, which could go to the removed player. A request row cannot hold
-- the removal: the player may delete their own request ("Players withdraw own join requests"), and validate_join_request
-- stops anyone writing a request for another player.
--
-- WHAT. One table, three triggers and two trigger functions are added; six functions are replaced, each with the live
-- body character for character plus one block. No existing table, policy, grant, trigger or function other than those
-- six changes (the roster's identity lock reuses private_sec.lock_row_identity as it is), and no stored row is
-- rewritten (nothing is backfilled: removals made before this migration have no record; WHAT IT DOES NOT DO).
-- 1. public.game_removals (game_id, user_id, removed_at); primary key (game_id, user_id); game_id references
--    hosted_games and user_id auth.users, both ON DELETE CASCADE (deleting the game or the account deletes the record).
--    No removed_by column: only the game's host can write a row, so the game says who. Row level security on, SELECT
--    only: the player sees their own records ("Players see their own removals"), the host sees those for their games
--    ("Hosts see removals from their games"), and a guardian in force sees their child's ("Guardians see their
--    children's removals", the expression of join_requests' "Guardians view their children's join requests"; the
--    guardian could already read the child's request noted 'Removed by host', and the Parent Center needs it to tell a
--    removed child's ask, which the host must also approve, from a request only the guardian answers); nobody else sees
--    any. No insert, update or delete rule and no such grant
--    for any API role: only the SECURITY DEFINER code below writes it. Grants: SELECT for authenticated and service_role;
--    nothing for PUBLIC or anon.
-- 2. public.enforce_game_join_gate() (20261103140000) refuses REMOVED_BY_HOST (P0001, "the host removed you from this
--    game.") when the player has a record for the game, just before the seat count: after the clock, closed-joining,
--    approval and payment checks (so a removed player on a game that needs approval still reads GAME_APPROVAL_REQUIRED
--    first, as 988 asserts), before GAME_FULL. Only for the player's own insert and for a write with no signed-in user
--    (the service role's place after a verified payment, addPaidPlayerToRoster), as enforce_host_block scopes its check:
--    anyone else's insert for the player is refused by the roster's row-level rule ("Users can join for themselves")
--    after this BEFORE trigger, and so learns nothing about whether the player was removed. The host's own writes and a
--    moderator's return earlier, as before; a host cannot insert another player's row anyway.
-- 3. public.host_remove_player(text, uuid) (20261129130000) writes the record last, after the request: only when the
--    player had something in the game (a roster row it deleted, a request of any status, or a pending invitation it
--    cancelled), never for the host's own seat. A user with nothing in the game, or no such user at all, writes nothing
--    and gets the same answer as before ({removed:false, request_declined:false, invites_cancelled:0}), so the call
--    cannot pre-ban a stranger or tell whether an account exists. A deleted account's leftover request (join_requests
--    has no foreign key to auth.users and the account purge leaves requests) is declined as before and writes nothing:
--    the insert's foreign_key_violation is caught (also for an account deleted while the call runs), so the answer is
--    the old one and no error names a missing account. A repeated removal stamps removed_at again. Its answer keeps its
--    shape (988 and 989 compare the JSON).
-- 4. private_sec.payment_claim_block(text, uuid) (20261119200000) answers REMOVED_BY_HOST for a removed player not on
--    the roster, after the "already on the roster" return and before the age, clock, closed and seat checks. That one
--    answer covers PayPal (paypal_payment_block asks it, so no order is made), the manual claim trigger, the payment
--    terms (get_game_payment_terms answers nothing) and the host's payment handles (get_game_host_payment_methods).
--    public.enforce_payment_claim_preconditions() (20261119200000) words it: "the host removed you from this game, so a
--    payment for it cannot be recorded." ("payment" is what src/lib/user-error.ts matches on). A verified payment stays
--    verified; PayPal answers ALREADY_PAID to its payer before this code, so nobody is charged twice.
-- 5. The waitlist notice skips a removed player, in both places that pick one: public.notify_waitlist_on_spot_open()
--    (20261027150000; a roster row deleted) and public.release_expired_payment_holds(text) (20261125100000; its own
--    pick, made while ballacity.system_release keeps the trigger quiet). Each pick gains AND NOT EXISTS (a record for
--    that player and game). A removed player can still join the waitlist; they are just not told a spot opened.
-- 6. private_sec.join_request_approval_lifts_removal() and trigger trg_join_request_approval_lifts_removal, AFTER UPDATE
--    OF status ON public.join_requests, FOR EACH ROW, WHEN (OLD.status IS DISTINCT FROM 'approved' AND NEW.status =
--    'approved'): deletes the player's record for that game. That is the only way back:
--      - an accepted invitation: game_respond_invite moves (or inserts as pending and then moves) the request to
--        'approved' before its roster insert, so the gate no longer sees the record, also when the accept does not
--        seat the player (a paid game; a guarded minor held for the guardian under 20261130110000);
--      - the host approving the player's request: on an open game the removed player's game page now sends one ("Ask
--        the host to let you back in"), through the ordinary request path (a resend of a declined request meets its
--        15-minute cooldown and 3-attempt cap; see WHAT IT DOES NOT DO for a deleted request).
--    Nothing else sets a request to 'approved': inserts are forced to 'pending' (validate_join_request), the player may
--    only move rejected -> pending ("Players resubmit rejected requests"; lock_closed_relationship refuses the rest), a
--    guardian's approval fills only the guardian fields, and no server code writes 'approved'. So these do not lift it:
--    the player's resend, a guardian's approval, an accept answered full / expired / cancelled or that errors (nothing of
--    it is kept), the player leaving or withdrawing. A lift deletes the record, so a later voluntary leave does not bring
--    it back. SECURITY DEFINER, empty search_path, no EXECUTE for any API role (a trigger does not need it).
-- 7. Trigger a0_game_participants_identity_locked, BEFORE UPDATE ON public.game_participants, FOR EACH ROW, EXECUTE
--    FUNCTION private_sec.lock_row_identity('user_id', 'game_id') (20261125100000's lock on game_position_waitlist and
--    payment_submissions, reused unchanged; the guard pins its md5): a roster place keeps its game and its player for
--    the API roles (anon, authenticated), ROW_IDENTITY_FIXED (42501). It closes an older hole: a player who hosts any
--    game could UPDATE their own seat in it ("Users can update their own position" checks only user_id;
--    guard_participant_self_update returns early for the host of the row's game) and set game_id to another game,
--    including one they were removed from, a full one or one that needs approval: the join gate, capacity, approval,
--    age, guardian and block checks and the joined count run on INSERT and DELETE only, so the moved seat skipped all of
--    them (and left both games' joined counts wrong). Named a0_ so it fires before the roster's other BEFORE UPDATE
--    triggers; a non-host player's attempt now reads ROW_IDENTITY_FIXED where it read PARTICIPANT_FIELD_FORBIDDEN. No
--    code changes game_id or user_id: the only UPDATE of the roster in the database is host_mark_attendance (attendance
--    columns, SECURITY DEFINER), and no app, server or admin code updates the table (removal, leave, purge and the
--    managed-account handover delete rows or keep the user id). Position updates (the player's own, the host's own
--    seat) and attendance go on as before.
-- 8. private_sec.removed_player_claim_reopen_block() and trigger zz_payment_claim_reopen_removed, BEFORE UPDATE ON
--    public.payment_submissions, FOR EACH ROW, WHEN (OLD.status IS DISTINCT FROM 'pending' AND NEW.status = 'pending'):
--    the player's own move of their claim back to pending (from cancelled, rejected, disputed or any other status) is
--    refused while they have a removal record for the game, REMOVED_BY_HOST (P0001) in the insert path's words ("the
--    host removed you from this game, so a payment for it cannot be recorded."). It closes an older hole: the claim
--    check (zz_payment_claim_preconditions) runs on INSERT only, and the player may reopen their own settled claim
--    (lock_closed_relationship lets the player; "Players update own pending submissions" accepts the new row), so a
--    removed player could put a cancelled or declined claim back in front of the host. Only that: a dispute or cancel,
--    any change by the host (Mark unpaid, verified -> pending, included), the service role and every player not removed
--    (adult or minor) go on as before, and after a lift the player may reopen again. Named zz_ so the existing checks
--    answer first. SECURITY DEFINER, empty search_path, no EXECUTE for any API role.
-- supabase/tests/996_removal_sticks.test.sql covers each of these and pins the definitions.
--
-- PREREQUISITE (enforced): 20261130110000 must be applied first. Under the earlier game_respond_invite (20261127120000)
-- a removed guarded minor whose declined request still carries an old guardian approval is seated at once by an
-- accepted re-invitation; 20261130110000 holds them for the guardian. The guard below stops unless game_respond_invite
-- is 20261130110000's (md5 79fa287fb3126c74dce0f902542d3e4e), each function replaced here is its live definition, and
-- private_sec.lock_row_identity() is 20261125100000's (md5 9204d58bcb421322580ad4fb20c3029c; 7 relies on it).
--
-- LOCKS. CREATE TABLE with its two foreign keys takes SHARE ROW EXCLUSIVE on public.hosted_games and auth.users, and
-- the three CREATE TRIGGERs take SHARE ROW EXCLUSIVE on public.join_requests, public.game_participants and
-- public.payment_submissions, each held to the commit: writers to those tables (a game created or edited, a sign-up, a
-- request sent or decided, a join or leave, a payment claim or review) wait for the rest of this transaction, readers
-- do not. lock_timeout is 5 s around each, so a busy table makes the apply fail instead of queueing every writer behind
-- it. The file is applied as one transaction (Lovable's tool; by hand, psql -X -v ON_ERROR_STOP=1 --single-transaction),
-- so a failed apply leaves nothing behind and the guard lets it run again. CREATE OR REPLACE FUNCTION takes a brief lock on each function only. When they run: host_remove_player
-- takes the invitation, the game, the request (as before) and then the removal row, last; the lift trigger runs inside
-- the request's update (the request is held) and then deletes the removal row; game_respond_invite therefore takes the
-- invitation, the game, the request, then the removal row, the same order. The join gate locks the game (as before) and
-- only reads the table. So no new lock cycle; the known residuals (the release sweep and a guardian's cancel against a
-- removal, 20261129130000) are unchanged and the app retries a removal ended by a deadlock once. A join waiting on the
-- game lock behind a removal reads the committed record afterwards (the gate is VOLATILE: a fresh snapshot per query).
--
-- WHAT IT DOES NOT DO (no one-off is part of this change):
--   - no backfill: removals made before this migration (and the old app's roster Remove, which declined the request and
--     deleted the row itself) left no record, so those players can still rejoin an open game. Declined requests noted
--     'Removed by host' on upcoming games could be backfilled; an open-game removal with no request left no trace, so
--     it would be partial. Owner call; not done;
--   - Remove and block (RosterPlayerRow's removeAndBlock) writes no record: the block keeps the player out of every game
--     of the host's; after an unblock they can rejoin an open game;
--   - a removed player who paid keeps the verified payment and has no place: a host's removal never refunds (as
--     before); the host refunds by hand, or invites the player back or approves their request. A claim the host
--     confirms for a removed player is placed nowhere (the gate refuses the server's write) and both get the "paid, not
--     on the roster" notice, which for this code tells the host to invite them back or refund them;
--   - game_invite_player is unchanged: a removed adult with no open availability post and no past game with this host,
--     or a removed minor, cannot be invited (INVITE_NOT_AVAILABLE). Their way back is the request the host approves;
--   - paypal_payment_block is unchanged: for a guarded minor it can answer GUARDIAN_APPROVAL_REQUIRED before
--     REMOVED_BY_HOST; the game and pay pages refuse first;
--   - nothing tells the host a removed player asked to come back beyond the app's ordinary join-request notice;
--   - the ask is not rate limited beyond the request row: the cooldown and the attempt cap live on the player's request
--     (attempt_count, last_rejected_at) and hold only for a resend of it. The player may delete their own request in any
--     status ("Players withdraw own join requests"; the app's cancel of a pending one does this) and send a new one,
--     which starts at attempt 1 with no cooldown, and each ask sends the host the app's notice. That gap is older
--     (20261129130000 and 20261130110000 record it, "not closed here") and holds on every game that needs approval; the
--     removal record itself stays until the host approves or an invitation is accepted. Limiting asks on the removal
--     record is an owner decision; 996 pins the gap as NOT CLOSED;
--   - the roster identity lock binds the API roles only, as lock_row_identity does for the waitlist and payments: the
--     service role, the table owner and SECURITY DEFINER code pass (none of them changes game_id or user_id; see 7). A
--     seat moved before this migration is not looked for or moved back;
--   - a claim still pending when the player was removed stays pending: the player may still edit or cancel it (once
--     cancelled it cannot be reopened while the removal stands), and the host confirms or declines it as before.
-- HASHES THAT CHANGE. docs/release/p0-1-verify.sql pins enforce_game_join_gate at 9d4924a2... and stops passing after
-- this migration (a historical one-off check). The rollbacks of 20261119200000 (payment_claim_block,
-- enforce_payment_claim_preconditions), 20261125100000 (release_expired_payment_holds) and 20261129130000
-- (host_remove_player) pin the definitions replaced here, so they refuse to run until this migration is rolled back;
-- the 20261125100000 rollback also lists the triggers that run lock_row_identity and refuses on the new roster lock.
-- The rollback of 20261103140000 (docs/rollbacks/20261103140000_payment_settings_host_guard.down.sql) has NO definition
-- guard (only its confirmation setting): run while this migration is applied, it would silently overwrite
-- enforce_game_join_gate and release_expired_payment_holds, dropping the REMOVED_BY_HOST check and the sweep's
-- waitlist exclusion while game_removals and the lift trigger stay (removals recorded, not enforced), and this
-- migration's rollback would then refuse on the gate's md5. Do not run it until this migration is rolled back.
--
-- Release order: apply 20261130110000 first (the guard stops otherwise), then this migration, then publish the app.
-- Publishing the app first is safe: it reads a missing table as "not removed" (the new screens never show), and the
-- roster's Remove calls host_remove_player, live since 20261129130000.
--
-- Rollback: docs/rollbacks/20261202100000_removal_sticks.down.sql (guarded; drops the roster identity lock and the claim
-- reopen block with its function first, puts the six definitions back verbatim and drops the lift trigger, its function
-- and the table, with every record in it).

DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    ['public.enforce_game_join_gate()',               '9d4924a2d53915fca8fa245e15281a25'],
    ['public.host_remove_player(text,uuid)',          'ebdc548c85bd4abf4545f48ced07fddd'],
    ['private_sec.payment_claim_block(text,uuid)',    '46a3cc02d2146f73270e679d2284a1b9'],
    ['public.enforce_payment_claim_preconditions()',  '8773e6a6822cd83426eb9d206e884b25'],
    ['public.notify_waitlist_on_spot_open()',         '0133bf0cb2c54557e05d56de2926daf1'],
    ['public.release_expired_payment_holds(text)',    '856c6a3999e1dfaf216e12a2ad998004'],
    ['public.game_respond_invite(uuid,boolean)',      '79fa287fb3126c74dce0f902542d3e4e'],
    -- not replaced: the roster's new identity lock (7) runs it, as 20261125100000 created it.
    ['private_sec.lock_row_identity()',               '9204d58bcb421322580ad4fb20c3029c']];
  _got text;
BEGIN
  -- A second run is the ledger's to stop; a hand replay over a database that has it stops here, changing nothing.
  IF to_regclass('public.game_removals') IS NOT NULL
     OR to_regprocedure('private_sec.join_request_approval_lifts_removal()') IS NOT NULL
     OR to_regprocedure('private_sec.removed_player_claim_reopen_block()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE (t.tgrelid, t.tgname) IN (('public.game_participants'::regclass, 'a0_game_participants_identity_locked'),
                                                 ('public.payment_submissions'::regclass, 'zz_payment_claim_reopen_removed'))) THEN
    RAISE EXCEPTION '20261202100000: already applied (public.game_removals, its lift trigger, the roster identity lock or the claim reopen block exists); nothing changed';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION '20261202100000: % is not the definition this migration was written against (md5 %, expected %). %',
        _want[i][1], coalesce(_got, 'missing'), _want[i][2],
        CASE WHEN _want[i][1] = 'public.game_respond_invite(uuid,boolean)'
             THEN 'Apply 20261130110000 first.' ELSE 'A later change needs a person to look first.' END;
    END IF;
  END LOOP;
END
$guard$;

-- ============================================================ 1. the record
SET lock_timeout = '5s';
CREATE TABLE public.game_removals (
  game_id    text        NOT NULL REFERENCES public.hosted_games(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (game_id, user_id)
);
RESET lock_timeout;
CREATE INDEX game_removals_user_id_idx ON public.game_removals (user_id);
COMMENT ON TABLE public.game_removals IS
  'A player the game''s host removed (host_remove_player). The join gate and payment_claim_block refuse them (REMOVED_BY_HOST) until their request for the game is approved (an accepted invitation or the host''s approval), which deletes the row. Written only by SECURITY DEFINER code (20261202100000).';

ALTER TABLE public.game_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_removals FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.game_removals TO authenticated, service_role;
CREATE POLICY "Players see their own removals" ON public.game_removals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Hosts see removals from their games" ON public.game_removals
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = game_removals.game_id AND g.host_id = auth.uid()));
CREATE POLICY "Guardians see their children's removals" ON public.game_removals
  FOR SELECT TO authenticated
  USING (private_sec.is_guardian_of(auth.uid(), user_id));

-- ============================================================ 2. the join gate refuses a removed player

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

  -- A player the host removed from this game (public.game_removals, written by host_remove_player; 20261202100000) is
  -- refused until the host lets them back: an approved request for the game (an accepted invitation, or the host's
  -- approval) deletes the record. Asked for the player's own join and for a write with no signed-in user (the server's
  -- place after a payment), as enforce_host_block scopes its check: anyone else's insert for that player is refused by
  -- the roster's row-level rule after this trigger, so it cannot tell whether the player was removed. The host's and
  -- a moderator's own writes returned above.
  IF (auth.uid() IS NULL OR _self)
     AND EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = NEW.game_id AND rm.user_id = NEW.user_id) THEN
    RAISE EXCEPTION 'REMOVED_BY_HOST: the host removed you from this game.'
      USING ERRCODE = 'P0001';
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

-- ============================================================ 3. host_remove_player records the removal

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

  -- The removal itself (20261202100000), so the join gate keeps the player out until the host lets them back in. Only
  -- for a player who had something in this game: a roster place, a request (any status) or a pending invitation; a user
  -- with none of those, or no such user, writes nothing and gets the answer as before. Never the host's own seat. Taken
  -- last, after the request, as game_respond_invite's lift (through the request's approval) takes it. A repeated
  -- removal stamps the latest time.
  -- A deleted account's leftover request (join_requests has no foreign key to auth.users) writes nothing: the old
  -- answer, and no error that says the account is gone.
  IF _player IS DISTINCT FROM _me AND (_removed > 0 OR _jr.id IS NOT NULL OR _cancelled > 0) THEN
    BEGIN
      INSERT INTO public.game_removals AS rm (game_id, user_id)
      VALUES (_game, _player)
      ON CONFLICT (game_id, user_id) DO UPDATE SET removed_at = now();
    EXCEPTION WHEN foreign_key_violation THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('removed', _removed > 0, 'request_declined', _declined > 0,
                            'invites_cancelled', _cancelled);
END $function$
;

-- ============================================================ 4. no payment for a place the gate would refuse

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
  -- The join gate: a player the host removed from this game, until the host lets them back (20261202100000).
  IF EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = _game_id AND rm.user_id = _player) THEN
    RETURN 'REMOVED_BY_HOST';
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
      WHEN 'REMOVED_BY_HOST' THEN 'the host removed you from this game, so a payment for it cannot be recorded.'
      ELSE 'a payment for this game cannot be recorded.'
    END
    USING ERRCODE = 'P0001';
END
$function$
;

-- ============================================================ 5. the waitlist notice skips a removed player

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
     AND NOT EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = w.game_id AND rm.user_id = w.user_id)
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
       AND NOT EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = w.game_id AND rm.user_id = w.user_id)
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

-- ============================================================ 6. the way back: an approved request lifts the removal
-- An accepted invitation (game_respond_invite) or the host's approval of the player's request. Deleted, not flagged, so
-- a later voluntary leave does not bring the removal back.
CREATE FUNCTION private_sec.join_request_approval_lifts_removal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  DELETE FROM public.game_removals rm WHERE rm.game_id = NEW.game_id AND rm.user_id = NEW.player_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.join_request_approval_lifts_removal() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
CREATE TRIGGER trg_join_request_approval_lifts_removal
AFTER UPDATE OF status ON public.join_requests
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved')
EXECUTE FUNCTION private_sec.join_request_approval_lifts_removal();
RESET lock_timeout;

-- ============================================================ 7. a roster place stays in its game and with its player
-- A player who hosts a game could UPDATE their own seat in it ("Users can update their own position" checks only
-- user_id, and guard_participant_self_update returns early for the game's host) and set game_id to another game: a seat
-- moved in that way skips the join gate, capacity, approval and the joined count, which run on INSERT and DELETE only,
-- and so seated a removed player again. game_id and user_id are now fixed for the API roles, with the lock 20261125100000
-- put on game_position_waitlist and payment_submissions (private_sec.lock_row_identity, unchanged; named a0_ so it fires
-- before the roster's other BEFORE UPDATE triggers). Position and attendance updates are untouched.
SET lock_timeout = '5s';
CREATE TRIGGER a0_game_participants_identity_locked
  BEFORE UPDATE ON public.game_participants
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_row_identity('user_id', 'game_id');
RESET lock_timeout;

-- ============================================================ 8. a removed player cannot reopen a payment claim
-- The claim check (zz_payment_claim_preconditions) runs on INSERT only; a player may move their own cancelled, declined
-- or disputed claim back to pending. For a player the host removed from the game that is a claim the insert path would
-- refuse, so the move is refused in the same words. Only the player's own move to pending while their removal record
-- stands; disputes, cancels, the host's changes (Mark unpaid included), the service role and every player not removed
-- go on as before.
CREATE FUNCTION private_sec.removed_player_claim_reopen_block()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND auth.uid() = OLD.player_id AND auth.uid() IS DISTINCT FROM OLD.host_id
     AND EXISTS (SELECT 1 FROM public.game_removals rm WHERE rm.game_id = OLD.game_id AND rm.user_id = OLD.player_id) THEN
    RAISE EXCEPTION 'REMOVED_BY_HOST: the host removed you from this game, so a payment for it cannot be recorded.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.removed_player_claim_reopen_block() FROM PUBLIC, anon, authenticated, service_role;

SET lock_timeout = '5s';
CREATE TRIGGER zz_payment_claim_reopen_removed
  BEFORE UPDATE ON public.payment_submissions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM 'pending' AND NEW.status = 'pending')
  EXECUTE FUNCTION private_sec.removed_player_claim_reopen_block();
RESET lock_timeout;
