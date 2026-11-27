-- On a paid game, an invitation's accept counts the places approved players already hold. Owner decision 2026-11-27
-- ("Approve all as you'd recommend"): option A of the paid over-approval review. An approved player on a paid game holds
-- the place until they pay, leave, are removed or declined, or the payment window releases it.
--
-- WHY. public.game_respond_invite (20261130110000) approves the invitee's request on a paid game and writes no roster
-- row: the place is taken when the payment is confirmed (addPaidPlayerToRoster, through the join gate). Its capacity
-- check counted roster rows only. So on a paid game with one place left, every invitee who accepted was approved: each
-- counted the same rows. The first to pay took the place. The others kept an approved request with no place behind it;
-- the pay page and PayPal refuse them once the roster is full, but a manual claim filed earlier, or a payment the host
-- marked, is confirmed and then cannot be placed (GAME_FULL), and both sides get the "paid, not on the roster" notice
-- with a refund by hand. game_invite_player already treats an approved request as holding a place (ALREADY_IN_GAME,
-- 20261123100000), and payment_hold_minutes is described as the time an approved player's spot is held; only the count
-- disagreed.
--
-- WHAT. One function is replaced; no table, policy, grant, trigger or other function changes, and no stored row is
-- rewritten.
--   CREATE OR REPLACE public.game_respond_invite(uuid, boolean): the body 20261130110000 created, character for
--   character (no later migration redefines it; 20261202100000 only pins its md5), apart from the capacity check. On a
--   paid game (the fee the function already works out, the payee's newest game_payment_settings.entry_fee, else
--   hosted_games.price, above 0) the check adds to the roster rows every request for the game that is 'approved', is not
--   the accepting player's own, and has no roster row for its player. When that total reaches max_players the accept
--   answers {"status":"full","on_roster":...}, the answer it already gave for a full roster: nothing is written, the
--   invitation stays pending (it can be accepted once a place frees), the host is not told. The app already shows that
--   answer ("This game is full right now. Your invitation stays open."), so no app change is needed and no new code is
--   added.
--   What is counted, and why:
--     - an approved request with a roster row is counted once, as a row (a paid player who was placed);
--     - pending and declined requests are not counted: they hold nothing;
--     - the accepting player's own approved request is not counted (an accept again after a full answer, or after the
--       host approved them, must not be refused by their own place). The host has no request on their own game
--       (validate_join_request);
--     - an approved player who paid and could not be placed counts: they hold the place they paid for;
--     - free games are unchanged, the guardian-held place on a free game included (the roster count only): no money
--       moves for that place.
--   Signature, owner (postgres), SECURITY DEFINER, search_path '' and grants (EXECUTE for authenticated and
--   service_role, none for PUBLIC or anon) stay as they are: CREATE OR REPLACE keeps them, so no grant is written here.
-- supabase/tests/999_paid_invite_capacity.test.sql covers it and pins the definition; the race (two invitees accepting
-- the last paid place at once) is in scripts/db-test.mjs.
--
-- PREREQUISITE (enforced): game_respond_invite must be 20261130110000's (md5 79fa287fb3126c74dce0f902542d3e4e on
-- Postgres 16). The guard below stops otherwise, changing nothing. It pins nothing else, so the migration applies on top
-- of either state of 20261204100000 (which sorts before this one, adds triggers on public.join_requests and columns on
-- public.game_removals, and does not touch game_respond_invite): applied or not, the function this replaces is the same.
-- The new count reads only join_requests and game_participants, never game_removals. 20261204100000 checks
-- game_respond_invite only as SECURITY DEFINER owned by postgres (not by md5), which this migration keeps, so the two
-- apply in either order.
--
-- LOCKS. CREATE OR REPLACE FUNCTION takes a brief lock on the function only; no table is locked, altered or given a
-- trigger, so there is no lock_timeout to set. Apply as one transaction (Lovable's tool; by hand, psql -X -v
-- ON_ERROR_STOP=1 --single-transaction). When it runs, the function takes no new lock: the new count is a plain read.
-- The order is as before: the invitation FOR UPDATE, the game FOR NO KEY UPDATE, then the player's own request FOR
-- UPDATE. Two accepts for the same game still wait for each other on the game row, and in READ COMMITTED the count runs
-- in a fresh statement snapshot after that wait, so the second sees the first's approval and answers full. The join
-- gate takes the same game lock, so a placement and an accept do not cross either. The known residuals (the release
-- sweep and a guardian's cancel against a removal, 20261129130000) are unchanged.
--
-- WHAT IT DOES NOT DO (no one-off is part of this change):
--   - the host's own approval of a request (reviewJoinRequest, a direct UPDATE under "Hosts review join requests") has
--     no capacity check, as before, and takes no game lock, so it can still approve more players than there are
--     places, and can race an accept. That is the host's deliberate choice; the host frees a place with Remove,
--     Decline or a payment window;
--   - the game page's places count and game_invite_player's send-time GAME_FULL still count roster rows only: a host can
--     send an invitation that is then answered full, and the invitation banner can say full while the page shows a
--     place left;
--   - payment_claim_block, PayPal and the join gate still count roster rows only: among players already approved, the
--     first to pay takes the place, as before;
--   - stale approved requests with no roster row count against the place until someone clears them: requests left
--     approved by removals made before 20261129130000, a player's leave whose best-effort request delete failed, and a
--     deleted account's approved request (the account purge leaves join_requests; join_requests has no foreign key to
--     auth.users). The host clears the first two with Remove or Decline; a deleted account's request may not show in the
--     host's list. Whether to leave out requests whose account is gone is an owner item, not done here;
--   - nothing is backfilled and no existing approval is undone: a paid game already over-approved stays as it is, and
--     its invitees are answered full until places free;
--   - the payment window (payment_hold_minutes) is unchanged; an approval whose window ran out still counts until the
--     sweep (pg_cron every 5 minutes, or the game page's lazy call) releases it.
-- HASHES THAT CHANGE. game_respond_invite's md5 becomes 7372bcebab32979448f5327cd9f74413 (Postgres 16). These pin the
-- old one and are updated with it or refuse after this migration:
--   - supabase/tests/989_guardian_cancel_keeps_declined_request.test.sql (the exact pin and the normalized pin; both now
--     undo this block first and name 20261204110000);
--   - docs/rollbacks/20261130110000_guardian_cancel_keeps_declined_request.down.sql guards on 79fa287f... and refuses
--     while this migration is applied: roll this one back first;
--   - supabase/migrations/20261202100000_removal_sticks.sql guards on 79fa287f... (already applied everywhere; a fresh
--     replay applies it before this one).
--
-- Release order: apply this migration only; there is no app change. Before applying, record this read-only count in
-- production (approved requests with no roster row on upcoming paid games; expected 0, as there are no upcoming paid
-- games), and the function's md5 (expected 79fa287fb3126c74dce0f902542d3e4e; Postgres 17 text may differ, in which case
-- the guard refuses and a person looks first):
--     SELECT count(*) FROM public.join_requests jr JOIN public.hosted_games g ON g.id = jr.game_id
--      WHERE jr.status = 'approved' AND g.date > now() AND g.cancelled_at IS NULL
--        AND COALESCE((SELECT s.entry_fee FROM public.game_payment_settings s
--                       WHERE s.game_id = g.id AND s.host_id = private_sec.game_payee(s.game_id)
--                       ORDER BY s.created_at DESC LIMIT 1), g.price, 0) > 0
--        AND NOT EXISTS (SELECT 1 FROM public.game_participants p WHERE p.game_id = jr.game_id AND p.user_id = jr.player_id);
--     SELECT md5(pg_get_functiondef('public.game_respond_invite(uuid,boolean)'::regprocedure));
--
-- Rollback: docs/rollbacks/20261204110000_paid_invite_capacity.down.sql (guarded; puts the 20261130110000 body back
-- verbatim).

DO $guard$
DECLARE
  _got text;
BEGIN
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.game_respond_invite(uuid,boolean)');
  -- A second run is the ledger's to stop; a hand replay over a database that has it stops here, changing nothing.
  IF _got = '7372bcebab32979448f5327cd9f74413' THEN
    RAISE EXCEPTION '20261204110000: already applied (public.game_respond_invite(uuid,boolean) is this migration''s definition); nothing changed';
  END IF;
  IF _got IS DISTINCT FROM '79fa287fb3126c74dce0f902542d3e4e' THEN
    RAISE EXCEPTION '20261204110000: public.game_respond_invite(uuid,boolean) is not the definition this migration was written against (md5 %, expected 79fa287fb3126c74dce0f902542d3e4e, 20261130110000''s). A later change needs a person to look first.',
      coalesce(_got, 'missing');
  END IF;
END
$guard$;

-- Accepting an invitation: on a paid game, an approved player who has not paid yet holds their place, so the capacity
-- check counts them too.
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
  -- On a paid game also every other player whose request is approved and who has no row yet (approved, not yet paid;
  -- 20261204110000): an approval holds the place until the player pays, leaves, is removed or declined, or the payment
  -- window releases it. Counting rows alone let more players be approved than there are places, and the last to pay
  -- were then paid but not placed.
  IF (SELECT count(*) FROM public.game_participants p
       WHERE p.game_id = _i.game_id AND (NOT _seat OR p.user_id <> _me))
     + (SELECT count(*) FROM public.join_requests r
         WHERE COALESCE(_fee, 0) > 0
           AND r.game_id = _i.game_id AND r.status = 'approved' AND r.player_id <> _me
           AND NOT EXISTS (SELECT 1 FROM public.game_participants p2
                            WHERE p2.game_id = r.game_id AND p2.user_id = r.player_id)) >= _g.max_players THEN
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
