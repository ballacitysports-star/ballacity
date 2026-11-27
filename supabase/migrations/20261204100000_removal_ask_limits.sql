-- A removed player's asks to come back are limited on the removal record, and a player the host blocked cannot send a
-- declined request again. Owner decision 2026-11-27: "Approve all as you'd recommend" (the ask limits and the block on
-- resend, both recommended in the batch 30 follow-ups).
--
-- WHY. 20261202100000 lets a removed player ask the host to let them back in (a join request the host approves). The
-- resend cooldown (15 minutes) and the attempt cap (3) live on the request row (attempt_count, last_rejected_at) and hold
-- only for a resend of it. The player may delete their own request in any status ("Players withdraw own join requests";
-- the app's cancel of a pending ask does this) and send a new one, which starts at attempt 1 with no cooldown, and every
-- ask puts a notice in front of the host. 996 pinned that as NOT CLOSED. The record (public.game_removals) is the one
-- thing the player cannot delete, so the limits are kept there.
-- Separately, a host's block (public.user_blocks) is checked by enforce_host_block on INSERT only. A blocked player whose
-- request was declined could move it back to pending (an UPDATE, allowed by "Players resubmit rejected requests"), so a
-- player the host blocked could still put an ask in front of them.
--
-- WHAT. Two columns, one function and three triggers are added. No existing function, policy, grant or trigger changes,
-- and no stored row is rewritten (the new columns take their defaults).
-- 1. public.game_removals gains asks integer NOT NULL DEFAULT 0 and last_ask_at timestamptz: how many times the player
--    asked while this record stood, and when they last did. Read under the table's three existing SELECT rules (the
--    player, the host, a guardian in force); no API role can write them (the table stays SELECT only for the API roles).
-- 2. private_sec.removed_player_ask_limits(), SECURITY DEFINER, empty search_path, no EXECUTE for any API role (a trigger
--    does not need it). Run by two triggers on public.join_requests:
--      trg_join_request_removed_ask_insert, AFTER INSERT, FOR EACH ROW;
--      trg_join_request_removed_ask_resend, AFTER UPDATE OF status, FOR EACH ROW, on rejected -> pending;
--    both WHEN (CURRENT_USER = ANY (ARRAY['anon', 'authenticated'])), so only a write made through the API roles reaches
--    the function. Inside SECURITY DEFINER code CURRENT_USER is the function's owner, so game_respond_invite's insert of
--    the request (an accepted invitation) is never counted or refused, nor is the service role or the table owner. This
--    was checked on the local Postgres 16 replay: the WHEN is accepted, it fires for a direct insert as authenticated,
--    and it does not fire for an insert made inside a SECURITY DEFINER function called by authenticated.
--    The function then acts only for the player's own request (auth.uid() = player_id; a host's or a guardian's write
--    is refused earlier, by validate_join_request or lock_closed_relationship, and would pass here) and only while a
--    removal record exists for that game and player. It locks the record, and:
--      - refuses when asks >= 3: 'You have reached the maximum of 3 resubmit attempts for this game.' (P0001);
--      - refuses when the previous ask was less than 15 minutes ago: 'Please wait N seconds before resubmitting this
--        request.' (P0001), N rounded up, at least 1;
--      - otherwise adds one to asks and stamps last_ask_at.
--    These are the sentences, the numbers and the error code of enforce_join_request_resubmit_rules (copied, so
--    src/lib/payments.ts shows them as they are on both the insert and the resend path; the app needs no change). A
--    refusal undoes the whole write. A refused ask is not counted, and an ask the request's own checks refuse never
--    reaches the record (those run BEFORE, these AFTER).
--    The way back resets the budget: the lift (trg_join_request_approval_lifts_removal) deletes the record when the
--    request is approved, so the counters go with it, and a later removal writes a fresh record (asks 0). A repeated
--    removal while the record stands only stamps removed_at again (host_remove_player's upsert), so asks is kept.
-- 3. Trigger enforce_host_block_resend, BEFORE UPDATE OF status ON public.join_requests, FOR EACH ROW, WHEN
--    (OLD.status = 'rejected' AND NEW.status = 'pending'), EXECUTE FUNCTION public.enforce_host_block(), the function
--    enforce_host_block_requests already runs on INSERT (20261028150000; unchanged, the guard pins its md5). It refuses
--    the player's own resend with the insert path's code and words, 'BLOCKED_BY_HOST: you can''t join this host''s
--    games.' (P0001). Only for the player acting for themselves, as on insert: the service role and everyone else pass
--    it (nobody else may move a declined request to pending anyway, DECISION_FINAL). Named so that it sorts after
--    a1_join_requests_closed_locked and before trg_enforce_join_request_resubmit_rules: a blocked player reads
--    BLOCKED_BY_HOST, not a cooldown or cap sentence. The insert path is unchanged.
-- supabase/tests/998_removal_ask_limits.test.sql covers each of these and pins the definitions; 996's NOT CLOSED line
-- now asserts the gap is closed.
--
-- PREREQUISITE (enforced): 20261202100000 must be applied (the table, its lift trigger and host_remove_player's record).
-- The guard below stops, changing nothing, unless each function this relies on has the md5 recorded here, the lift
-- trigger is the one 20261202100000 created and is enabled, and game_respond_invite is SECURITY DEFINER and owned by
-- postgres. game_respond_invite is checked by those two properties and not by md5: 20261204110000 replaces it, and the
-- exemption needs only that it runs as its owner.
--
-- LOCKS. LOCK TABLE takes SHARE ROW EXCLUSIVE on public.join_requests first, then the ALTER TABLE takes ACCESS EXCLUSIVE
-- on public.game_removals, then the three CREATE TRIGGERs run on public.join_requests, all held to the commit. That is
-- the order an ask and an invitation accept take them in (the request, then the removal row). A host's removal running
-- at the same moment can still meet the apply the other way round (its roster delete reads game_removals through the
-- waitlist trigger before it declines the request), so one of the two can end in a deadlock or the 5 s lock_timeout:
-- the apply then leaves nothing behind and can be run again, and the app repeats a removal ended by a deadlock once.
-- While the locks are held, writers to join_requests (a request sent, decided or withdrawn) wait, and so does everything
-- that reads game_removals: the join gate on every roster insert, the payment checks and the waitlist picks. The file is
-- short and adds the columns with constant defaults, so no table is rewritten. lock_timeout is 5 s around the locks, so
-- a busy table makes the apply fail instead of queueing every writer behind it. The file is applied as one transaction
-- (Lovable's tool; by hand, psql -X -v ON_ERROR_STOP=1 --single-transaction), so a failed apply leaves nothing behind
-- and the guard lets it run again.
-- When they run: the new triggers lock the removal row after the request row (AFTER the request's insert or update),
-- the order host_remove_player and game_respond_invite's lift already use. Two asks by the same player queue on the
-- removal row (or on the request's unique index, and the second gets 23505 and counts nothing), so the count cannot be
-- raced past 3.
--
-- WHAT IT DOES NOT DO (no one-off is part of this change):
--   - after the third ask the only way back is an invitation: the host cannot approve a declined request
--     (DECISION_FINAL), and some removed players cannot be invited (INVITE_NOT_AVAILABLE). This is today's row cap;
--   - the cooldown runs from the previous ask, not from the host's no. A player who deletes the declined request may ask
--     again about 15 minutes after their previous ask, and the first ask after a removal is immediate. All of it is
--     bounded by the cap;
--   - asks made before this migration are not counted (every record starts at 0; production has no removal records);
--   - the host's notice of an ask is written by the app after a successful ask, so a refused ask sends none; nothing
--     here changes notifications;
--   - for a player who was not removed, the limits stay on the request row as before, with the older gap that a deleted
--     request starts over, and that a player may INSERT their own request with any attempt_count (validate_join_request
--     does not reset it). Owner item; not closed here;
--   - a block does not decline or cancel anything: a blocked player's pending request stays pending for the host to
--     answer, and only the move from declined back to pending is refused. Remove and block still writes no record;
--   - scripts/db-test.mjs has no race for a removed player's ask against an invitation accept; the lock order above is
--     argued, not raced.
-- HASHES THAT CHANGE. None of the existing functions or triggers change, so no pinned md5 elsewhere moves. The rollback
-- of 20261202100000 (docs/rollbacks/20261202100000_removal_sticks.down.sql) refuses while this migration is applied,
-- because another function's source (this one's) names game_removals; roll this one back first.
--
-- Release order: apply 20261202100000 first (the guard stops otherwise), then this migration. No app change is needed:
-- the refusals are the sentences the app already shows, and the app names the columns it reads from game_removals.
--
-- Rollback: docs/rollbacks/20261204100000_removal_ask_limits.down.sql (guarded; drops the three triggers, the function
-- and the two columns, with the counts in them).

DO $guard$
DECLARE
  _want CONSTANT text[][] := ARRAY[
    -- not replaced. Its sentences, numbers and error code are copied; its row checks answer first.
    ['public.enforce_join_request_resubmit_rules()',         'fdb952aee7902dcfc719ff3728914839'],
    -- not replaced. The new resend trigger runs it as it is.
    ['public.enforce_host_block()',                          '6b1d17279ccbb3238ceecd2bde49ba2d'],
    -- not replaced. It deletes the record, which resets the budget.
    ['private_sec.join_request_approval_lifts_removal()',    'b755c4e40e0ca5d6ef8ae90de73d4b5e'],
    -- not replaced. It writes the record, and a repeated removal keeps asks (the upsert sets removed_at only).
    ['public.host_remove_player(text,uuid)',                 '58686b8ca8759ead2bfb2b4b4bfe5d22']];
  _got text;
BEGIN
  -- A second run is the ledger's to stop; a hand replay over a database that has it stops here, changing nothing.
  IF to_regclass('public.game_removals') IS NULL THEN
    RAISE EXCEPTION '20261204100000: public.game_removals does not exist. Apply 20261202100000 first; nothing changed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = 'public.game_removals'::regclass
                AND a.attname IN ('asks', 'last_ask_at') AND NOT a.attisdropped)
     OR to_regprocedure('private_sec.removed_player_ask_limits()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger t
                 WHERE t.tgrelid = 'public.join_requests'::regclass
                   AND t.tgname IN ('trg_join_request_removed_ask_insert', 'trg_join_request_removed_ask_resend',
                                    'enforce_host_block_resend')) THEN
    RAISE EXCEPTION '20261204100000: already applied (the ask columns, private_sec.removed_player_ask_limits() or one of its triggers exists); nothing changed';
  END IF;
  FOR i IN 1 .. array_length(_want, 1) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_want[i][1]);
    IF _got IS DISTINCT FROM _want[i][2] THEN
      RAISE EXCEPTION '20261204100000: % is not the definition this migration was written against (md5 %, expected %). A later change needs a person to look first.',
        _want[i][1], coalesce(_got, 'missing'), _want[i][2];
    END IF;
  END LOOP;
  SELECT md5(pg_get_triggerdef(t.oid)) || '/' || t.tgenabled::text INTO _got FROM pg_trigger t
   WHERE t.tgrelid = 'public.join_requests'::regclass AND t.tgname = 'trg_join_request_approval_lifts_removal';
  IF _got IS DISTINCT FROM '5717e06a7d4c0e7a04b5a348282c3d05/O' THEN
    RAISE EXCEPTION '20261204100000: trg_join_request_approval_lifts_removal is missing, changed or disabled (%, expected 5717e06a7d4c0e7a04b5a348282c3d05/O). A later change needs a person to look first.',
      coalesce(_got, 'missing');
  END IF;
  -- The invitation's insert is exempt only because it runs as its owner.
  SELECT p.proowner::regrole::text || '/' || p.prosecdef::text INTO _got FROM pg_proc p
   WHERE p.oid = to_regprocedure('public.game_respond_invite(uuid,boolean)');
  IF _got IS DISTINCT FROM 'postgres/true' THEN
    RAISE EXCEPTION '20261204100000: public.game_respond_invite(uuid,boolean) is not SECURITY DEFINER owned by postgres (%). An accepted invitation would be counted; a person needs to look first.',
      coalesce(_got, 'missing');
  END IF;
END
$guard$;

-- ============================================================ the limits, on the removal record (WHAT 2)
-- Runs AFTER the request's own write, so the request row is held first and the removal row second, the order
-- host_remove_player and the lift take them in. Only the API roles reach it (the triggers' WHEN), and only for the
-- player's own request while their removal record stands.
CREATE FUNCTION private_sec.removed_player_ask_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  -- enforce_join_request_resubmit_rules' numbers, so the app's sentences and pre-checks still match.
  _cooldown constant interval := interval '15 minutes';
  _cap constant int := 3;
  _rm record;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM NEW.player_id THEN
    RETURN NULL;
  END IF;
  SELECT rm.asks, rm.last_ask_at INTO _rm
    FROM public.game_removals rm
   WHERE rm.game_id = NEW.game_id AND rm.user_id = NEW.player_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF _rm.asks >= _cap THEN
    RAISE EXCEPTION 'You have reached the maximum of % resubmit attempts for this game.', _cap
      USING ERRCODE = 'P0001';
  END IF;
  IF _rm.last_ask_at IS NOT NULL AND _rm.last_ask_at + _cooldown > now() THEN
    RAISE EXCEPTION 'Please wait % seconds before resubmitting this request.',
      GREATEST(1, CEIL(EXTRACT(EPOCH FROM ((_rm.last_ask_at + _cooldown) - now())))::int)
      USING ERRCODE = 'P0001';
  END IF;
  UPDATE public.game_removals rm
     SET asks = rm.asks + 1, last_ask_at = now()
   WHERE rm.game_id = NEW.game_id AND rm.user_id = NEW.player_id;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.removed_player_ask_limits() FROM PUBLIC, anon, authenticated, service_role;

-- ============================================================ the columns and the triggers (WHAT 1, 2 and 3)
-- join_requests first, then game_removals: the order an ask and an invitation accept take them in (LOCKS).
SET lock_timeout = '5s';
LOCK TABLE public.join_requests IN SHARE ROW EXCLUSIVE MODE;
ALTER TABLE public.game_removals
  ADD COLUMN asks integer NOT NULL DEFAULT 0,
  ADD COLUMN last_ask_at timestamptz;

CREATE TRIGGER trg_join_request_removed_ask_insert
  AFTER INSERT ON public.join_requests
  FOR EACH ROW
  WHEN (CURRENT_USER = ANY (ARRAY['anon'::name, 'authenticated'::name]))
  EXECUTE FUNCTION private_sec.removed_player_ask_limits();

CREATE TRIGGER trg_join_request_removed_ask_resend
  AFTER UPDATE OF status ON public.join_requests
  FOR EACH ROW
  WHEN (OLD.status = 'rejected' AND NEW.status = 'pending'
        AND CURRENT_USER = ANY (ARRAY['anon'::name, 'authenticated'::name]))
  EXECUTE FUNCTION private_sec.removed_player_ask_limits();

-- A player the host blocked cannot send their declined request again, in the insert path's words.
CREATE TRIGGER enforce_host_block_resend
  BEFORE UPDATE OF status ON public.join_requests
  FOR EACH ROW
  WHEN (OLD.status = 'rejected' AND NEW.status = 'pending')
  EXECUTE FUNCTION public.enforce_host_block();
RESET lock_timeout;

COMMENT ON COLUMN public.game_removals.asks IS
  'How many times the removed player asked the host to let them back in while this record stood (their own request sent or sent again). Three at most; written only by private_sec.removed_player_ask_limits (20261204100000).';
COMMENT ON COLUMN public.game_removals.last_ask_at IS
  'When the removed player last asked; the next ask waits 15 minutes from it. Written only by private_sec.removed_player_ask_limits (20261204100000).';
