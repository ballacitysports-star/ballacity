-- WP 5.4 (docs/product/phase-5-validation-plan.md): invites reach the phone.
--
-- The 5-minute sweep (src/lib/game-reminders.server.ts, pushInviteNotifications) pushes each 'game_invite' and
-- 'game_invite_accepted' notification of the last hour once, through deliverPush (which holds a minor's push during their
-- quiet hours and honours a guardian's off switch). This column is how it knows a row was already taken:
--
--   notifications.push_sent_at  NULL: the sweep has not taken the row yet. Set: when a sweep took it (one UPDATE ... WHERE
--                               push_sent_at IS NULL, so two runs at once never take the same row). Taking it means the
--                               push was handed to deliverPush, or was passed over because the member switched that push off
--                               or had already read the notification. What deliverPush then did (sent, held for quiet hours,
--                               skipped) is in notification_delivery_log, as before. Nothing else is recorded.
--
-- Server only. Members may still insert their own notifications and mark them read (the existing policies and grants are
-- unchanged), but no signed-in or anonymous caller may write push_sent_at, by any path: a member could otherwise stamp a row
-- to suppress its push or clear the stamp to have it pushed again. The trigger below refuses the write when the request
-- carries a member's identity (auth.uid() set, or the anon/authenticated API role), which includes a member's call into a
-- SECURITY DEFINER function; the sweep runs as the service role (no auth.uid()) and passes, as do migrations. This is the
-- rule hosted_games already uses for its server-owned columns (enforce_hosted_game_org_manager, sync_listing_hidden).
--
-- Only the database's own invite rows are swept. The sweep trusts a 'game_invite' or 'game_invite_accepted' row only as
-- far as the invitation behind it (it asks public.invite_pushes_allowed, below, and re-reads user_blocks), but rows written by anyone else would still
-- crowd its reads and could carry any text: a member may insert and update their own notifications (any type, any
-- created_at), and the service role writes rows a member asked for (createNotificationForUser, which pushes at once). So
-- the same trigger stamps such a row as it is stored, and the sweep never reads it. A row of these two types stays
-- unstamped only when it is written inside a member's request FOR ANOTHER MEMBER (game_invite_player writes the invitee's
-- row and notify_guardians the guardians'; game_respond_invite writes the host's); every other write is stamped: a member's
-- own row (including the copy notify_guardians writes when a host invites their own child: no push, the in-app row stays),
-- a service-role or migration insert, and a member's change to the type, title, body, link or created_at of one. Nothing is
-- refused: the member's in-app list is unchanged.
--
-- The sweep's read (type, push_sent_at IS NULL, created_at in the last hour) has an index of its own,
-- notifications_invite_push_due_idx: the table has only (user_id, created_at) otherwise, and grows without a prune job.
-- Every row has push_sent_at NULL when the column is added, so the index holds the past invite rows too (a few per invite).
--
-- No CHECK constraint exists on notifications.type (checked: none in the replayed schema), so no type list changes here.
-- Additive: one nullable column, one trigger function, one trigger, one partial index, one server-only function. Rollback: docs/rollbacks/
-- 20261129100000_notification_push_sent_at.down.sql, after the sweep code that writes the column is reverted.

-- Locks: ALTER TABLE ... ADD COLUMN and CREATE TRIGGER take a short exclusive lock on the table; the wait for it is limited
-- to 5 s so a long-running transaction cannot queue every reader behind this migration. On a timeout, retry.
SET lock_timeout = '5s';

ALTER TABLE public.notifications ADD COLUMN push_sent_at timestamptz;

COMMENT ON COLUMN public.notifications.push_sent_at IS
  'WP 5.4: when the 5-minute sweep took this row for a push (handed to deliverPush, or passed over: push switched off, already read, or the invitation no longer stands), or when an invite-type row the database did not write for another member was stored (never swept). NULL: not taken. Server only.';

CREATE FUNCTION private_sec.guard_notification_push_sent_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  -- 1. No member or visitor writes the stamp.
  IF _uid IS NOT NULL OR COALESCE(auth.role(), '') IN ('anon', 'authenticated') THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.push_sent_at IS NOT NULL THEN
        RAISE EXCEPTION 'PUSH_SENT_AT_SERVER_ONLY: only the server records that a notification was pushed.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF NEW.push_sent_at IS DISTINCT FROM OLD.push_sent_at THEN
      RAISE EXCEPTION 'PUSH_SENT_AT_SERVER_ONLY: only the server records that a notification was pushed.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  -- 2. Only an invite row written inside a member's request for another member is left for the sweep.
  IF NEW.push_sent_at IS NULL AND NEW.type IN ('game_invite', 'game_invite_accepted') THEN
    IF TG_OP = 'INSERT' THEN
      IF _uid IS NULL OR NEW.user_id = _uid THEN
        NEW.push_sent_at := now();
      END IF;
    ELSIF NEW.type IS DISTINCT FROM OLD.type OR NEW.created_at IS DISTINCT FROM OLD.created_at
       OR NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body
       OR NEW.link IS DISTINCT FROM OLD.link OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      NEW.push_sent_at := now();
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.guard_notification_push_sent_at() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notifications_push_sent_at_server_only
BEFORE INSERT OR UPDATE OF push_sent_at, type, created_at, title, body, link, user_id ON public.notifications
FOR EACH ROW EXECUTE FUNCTION private_sec.guard_notification_push_sent_at();

CREATE INDEX notifications_invite_push_due_idx ON public.notifications (created_at)
  WHERE push_sent_at IS NULL AND type IN ('game_invite', 'game_invite_accepted');

-- Which invitations an invite push may still go out for. An invitation stays 'pending' when its game is cancelled or hidden,
-- when its host is suspended or banned, or when a guardian changes the child's messaging or game switches: only
-- game_respond_invite and game_cancel_invite change its status. So before it pushes a 'game_invite' row, the sweep asks again
-- the questions game_invite_player asked when it wrote the row: the invitation is still pending, its game is still open for
-- invitations (private_sec.game_open_for_invites: not cancelled, completed, under way, hidden by its host, a moderator or its
-- organization, closed to joins, or past its start or sign-up cutoff), the host is not suspended or banned, there is no block
-- either way, the messaging rules for minors let the host reach the player (public.minor_messaging_block), a minor's guardian
-- still lets them join games (private_sec.child_game_participation_allowed), and the game's age range still fits the player
-- (private_sec.game_age_fits). An invitation that fails any of these is left out, and the sweep takes its row without a push.
-- Server code only: the service role calls it; no member or visitor may (it would answer questions about other people).
CREATE FUNCTION public.invite_pushes_allowed(_invites uuid[])
RETURNS TABLE (id uuid, host_id uuid, invitee_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
  SELECT i.id, i.host_id, i.invitee_id
    FROM public.game_invites i
   WHERE i.id = ANY (_invites)
     AND i.status = 'pending'
     AND private_sec.game_open_for_invites(i.game_id)
     AND NOT EXISTS (SELECT 1 FROM public.profiles h
                      WHERE h.id = i.host_id
                        AND (h.suspended_at IS NOT NULL OR h.moderation_state IN ('suspended', 'banned')))
     AND NOT private_sec.blocks_exist_between(i.host_id, i.invitee_id)
     AND public.minor_messaging_block(i.host_id, i.invitee_id) IS NULL
     AND (NOT private_sec.is_minor(i.invitee_id) OR private_sec.child_game_participation_allowed(i.invitee_id))
     AND COALESCE(private_sec.game_age_fits(i.game_id, i.invitee_id), false);
$$;
REVOKE ALL ON FUNCTION public.invite_pushes_allowed(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.invite_pushes_allowed(uuid[]) TO service_role;
COMMENT ON FUNCTION public.invite_pushes_allowed(uuid[]) IS
  'Server code only (WP 5.4): of these invitations, the ones an invite push may still go out for: pending, the game still open for invitations, the host not suspended or banned, no block either way, the minor messaging rules and a guardian''s game permission still allowing it, and the game''s age range still fitting the player.';

RESET lock_timeout;
