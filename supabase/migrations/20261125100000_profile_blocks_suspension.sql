-- Open item (batch 18, still open in batch 20): a block and a suspension now hide a profile, as the owner decided (2026-11-20:
-- "build it as an additive, reversible migration with SQL tests and a guarded rollback").
--
-- WHY. The two read rules on public.profiles asked only private_sec.profile_visibility_of(id) (the person's public / members /
-- private choice and the age defaults). They checked neither public.user_blocks nor profiles.suspended_at, so a person someone
-- had blocked, in either direction, still read that person's profile at /players/:id with the signed-in client, and a suspended
-- account's profile was read by everyone. The server-built player card and passport already hide suspended accounts (and the
-- passport hides blocks); only the row-level security path leaked.
--
-- WHAT.
-- 1. Three helpers. private_sec.viewer_block_peers(): the ids the signed-in viewer has blocked or been blocked by, as one array
--    (empty when signed out). private_sec.profile_hidden_from_viewer(_id): true when the profile is suspended and the viewer is
--    not staff (private_sec.is_moderator: admin, moderator or superadmin), or when a block exists between the viewer and the
--    profile's owner in either direction; never for the person's own row (used by profile_ages, 7.). Both read user_blocks and
--    suspended_at as their owner, so the column REVOKE on profiles.suspended_at and the user_blocks rules stay as they are.
--    Signed-in callers and the service role only; private_sec is not exposed by the API. private_sec.hosted_game_on(...): whether
--    a game is still on (5.): not cancelled, not completed, and started less than 7 days ago, or ended less than 7 days ago when
--    ends_at is set, counting at most 7 days of ends_at past the start (so a game is on until at most 14 days after it started).
--    private_sec.hosted_game_id_on(_game_id): the same for a game by its id, read as the owner, for the trigger in 4b. (the
--    payee of a payment may be a minor host's payment manager, who need not be able to read a private game).
-- 2. The two profiles SELECT rules keep their names, roles and visibility expressions and add the block and suspension terms.
--    They are written for speed, because row security runs on every row a search scans (ILIKE is not leakproof): auth.uid(),
--    the staff test and the block list are each evaluated once per query as an initplan ((SELECT ...)), the suspension test
--    reads the row's own suspended_at (columns named only in a rule are not subject to the column REVOKE), and the block test
--    is an array comparison. The visitor rule (TO anon) needs no block term: a visitor has no account to block or be blocked.
--    The person's own row stays readable to them, suspended or not. Staff still see only public and members profiles through
--    this path (they use the service role for moderation). profile_visibility_of's answer, the minors' defaults and the
--    privacy floor are unchanged.
-- 3. public.my_blocked_profiles(): the signed-in person's own block list with each blocked account's name, username, initials
--    and avatar, so Settings > Blocked users keeps showing names now that the blocked person's row is hidden from the blocker.
--    Names and the avatar are returned only where the profile rule would have shown them without the block (public or members,
--    not suspended); the avatar also follows private_sec.visible_avatars. Signed-in callers only, and only about their own
--    blocks. The app's block list (useBlockedUsersList) reads it, and reads profiles instead only while the function is missing
--    (before this migration, and after the rollback, when the old rules let the blocker read the row again), so the app
--    change ships before or with this migration.
-- 4. A relationship row keeps who it is about, and a closed one stays closed. Both apply to the API roles (anon,
--    authenticated) only; the service role and SECURITY DEFINER code (the refund engine, the payment and join functions, the
--    guardian approval, the series and expiry jobs) are not affected.
--    a. Who a waitlist entry or a payment submission is about cannot be changed. The host's UPDATE rules on
--       game_position_waitlist and payment_submissions check only that the game or the submission is the host's, and neither
--       table had a trigger guarding user_id / player_id, so a host could point their own row at anyone. A BEFORE UPDATE
--       trigger (private_sec.lock_row_identity) now refuses a change to game_position_waitlist.user_id / game_id and to
--       payment_submissions.player_id / game_id / host_id / submitted_at (5. counts 30 days from submitted_at; no app path
--       writes it after the insert). join_requests (validate_join_request), org_members (lock_member_row_identity) and
--       org_member_requests already lock theirs; a game_participants row can only ever name the person who inserted it.
--    b. A host cannot reopen what has ended (private_sec.lock_closed_relationship, BEFORE UPDATE): a game that is over or
--       called off cannot be made on again (clearing cancelled_at, completed_at or a cancelled / completed status, or moving
--       date or ends_at back into range): GAME_CLOSED. A declined join request goes back to pending only by the player's own
--       resubmission (enforce_join_request_resubmit_rules keeps its cooldown and cap); the host cannot re-approve it or put it
--       back to pending. A reviewed (approved or declined) waitlist entry cannot be put back to waiting. A settled payment
--       (verified, rejected or cancelled) cannot be moved to pending, disputed or verified by anyone but the player:
--       DECISION_FINAL. A declined or cancelled payment comes back only when the player sends a new one or disputes the
--       decision; the host's "Verify anyway" and "Confirm received" on a declined payment are removed from the app with this
--       migration. One exception: the host may move a verified payment back to pending ("Mark unpaid" on the roster row)
--       while its game is on (1.); a verified payment for a game that is on is named by 5. anyway, and a pending one counts
--       for no longer than if the host had never verified it. Without the lock each of the others handed 5. back a
--       relationship that had ended.
-- 5. public.managed_profile_names(_ids): names for the people in a host's live games, so a block or a suspension does not take
--    a name off the host's own management screens while the person still holds a spot, waits for one, asks for one, or owes
--    or is owed money. Only relationships the person entered themselves count, and only while they last:
--      * the roster of a game the caller hosts, and the waitlist (status 'waiting') of one, while the game is on (1.);
--      * a join request addressed to the caller, pending or approved, for such a game;
--      * a payment submission addressed to the caller that has a refund owed (not one refunded or kept), is verified for
--        such a game, or is pending or disputed, while its game is on or for 30 days after it was sent.
--    Every row it trusts names a person who wrote it themselves (a client can insert these rows only as itself) and, after
--    4a., cannot be repointed; after 4b., the host cannot bring an ended one back. The refund state is set only by the refund
--    engine. Facility admins are deliberately not covered: any signed-in person can create a facility and an admin
--    can add any adult as a member without their consent, so a membership is no evidence of a relationship; a hidden member
--    shows as "Member". Team managers likewise (a hidden team member shows as "Player"). It returns the name, initials and
--    avatar only, never the profile row or the username: /players/:id and every other read stay hidden. It names everyone in
--    such a relationship whatever their public / members / private choice (a private or child account included): naming
--    only public and members accounts would make "no profile row, but a managed name" an exact test for "this person blocked
--    me" (6. and 7. hide that same bit). For an account that is not suspended, the name and initials are what
--    private_sec.visible_avatars already gives any signed-in caller for any id. A suspended account is the exception:
--    visible_avatars has no entry for it, and the host still gets its name here while the relationship lasts, so the
--    people in their own game stay told apart (main already names such a player to the host in settle_paid_spot's refund
--    notice). The username, which visible_avatars does not give, is not returned. The avatar is visible_avatars' own (it follows the avatar setting; none for a suspended account).
--    Signed-in callers only, at most 500 ids, never the caller's own id. Where a host reads names from profiles, the app fills
--    the names that read left out from this function (src/lib/managed-profile-names.ts); while the function is missing it
--    fills nothing, which is the old behaviour.
-- 6. public.profile_visibility_of(_user) is contained like the SEC-2 helpers (20261112150000): a direct, non-staff client call
--    about someone else gets 'private'. Visitors (anon) can no longer call it at all, like the SEC-2 wrappers (the check it
--    calls is not granted to anon, so the grant would only have turned into a permission error); the visitor rule on
--    profiles calls private_sec.profile_visibility_of, and the app calls this one only with the service role. It used to answer the truth to any client, and with the profile row hidden that made
--    "this account blocked me" an exact, bulk test (a hidden row whose visibility is 'public' or 'members' and that is not
--    suspended can only be a block), which is what blocks_exist_between was contained to hide. The person themselves, staff,
--    the service role (the player card and passport) and SECURITY DEFINER callers still get the truth; policies call
--    private_sec.profile_visibility_of and are unaffected.
-- 7. public.profile_ages(_ids) follows the profile rule: an age is not returned for a profile hidden from the caller by a
--    block or a suspension (the server, with no auth.uid(), is unaffected). Otherwise it gave the same exact block test (an
--    adult's age comes back only for a public or members profile). Copied verbatim from 20261106150000 with that one condition
--    added; signature, owner and grants are unchanged.
-- 8. Wording (WP 4.3: games say "request a spot"; memberships keep "request to join"): the notification bodies written by
--    guardian_approve_join_request and release_expired_payment_holds. Both functions are copied verbatim from their latest
--    definitions (20261110120000 and 20261103140000) with only that string changed; signatures, owner and grants are unchanged
--    (CREATE OR REPLACE keeps them). Notifications already sent keep their text.
--
-- LOCK ORDER. The four tables that get triggers are locked first, in one statement and before any other change, in the mode
-- CREATE TRIGGER needs (SHARE ROW EXCLUSIVE: writers wait, readers do not). The two profiles rules (2.) are changed last, so
-- the ACCESS EXCLUSIVE lock on public.profiles, which nearly every request reads, is held only for the final statements and
-- never while the apply waits for another table. Changing the rules first deadlocked with live code that writes
-- payment_submissions and then reads profiles (mark_refund_sent): each waited for the lock the other held.
--
-- Rollback: docs/rollbacks/20261125100000_profile_blocks_suspension.down.sql.

SET lock_timeout = '5s';

-- ============================================================ 0. the table locks, all at once, before any change
LOCK TABLE public.hosted_games, public.join_requests, public.game_position_waitlist, public.payment_submissions
  IN SHARE ROW EXCLUSIVE MODE;

-- ============================================================ 1. the helpers
CREATE OR REPLACE FUNCTION private_sec.viewer_block_peers()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(array_agg(x.peer), '{}'::uuid[])
    FROM (SELECT b.blocked_id AS peer FROM public.user_blocks b WHERE b.blocker_id = auth.uid()
          UNION
          SELECT b.blocker_id FROM public.user_blocks b WHERE b.blocked_id = auth.uid()) x;
$$;
REVOKE ALL ON FUNCTION private_sec.viewer_block_peers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.viewer_block_peers() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private_sec.profile_hidden_from_viewer(_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN _id IS NULL THEN false
    WHEN _id = auth.uid() THEN false
    WHEN EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = _id AND p.suspended_at IS NOT NULL)
         AND NOT (auth.uid() IS NOT NULL AND private_sec.is_moderator(auth.uid())) THEN true
    WHEN auth.uid() IS NOT NULL AND private_sec.blocks_exist_between(auth.uid(), _id) THEN true
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION private_sec.profile_hidden_from_viewer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.profile_hidden_from_viewer(uuid) TO authenticated, service_role;

-- A game is on: not cancelled, not completed, and started (or ended, when ends_at is set, counting at most 7 days of ends_at
-- past the start) less than 7 days ago. Pure: it reads only its arguments and the clock. The trigger in 4b. runs it as the
-- signed-in host, so authenticated may execute it.
CREATE OR REPLACE FUNCTION private_sec.hosted_game_on(_cancelled_at timestamptz, _completed_at timestamptz, _status text,
                                                      _date timestamptz, _ends_at timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT _cancelled_at IS NULL
     AND _completed_at IS NULL
     AND COALESCE(_status, '') NOT IN ('cancelled', 'completed')
     AND COALESCE(LEAST(COALESCE(_ends_at, _date), _date + interval '7 days') > now() - interval '7 days', false);
$$;
REVOKE ALL ON FUNCTION private_sec.hosted_game_on(timestamptz, timestamptz, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.hosted_game_on(timestamptz, timestamptz, text, timestamptz, timestamptz)
  TO authenticated, service_role;

-- The same for a game by its id, read as the owner; false for a game that does not exist.
CREATE OR REPLACE FUNCTION private_sec.hosted_game_id_on(_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT private_sec.hosted_game_on(g.cancelled_at, g.completed_at, g.status, g.date, g.ends_at)
                     FROM public.hosted_games g
                    WHERE g.id = _game_id), false);
$$;
REVOKE ALL ON FUNCTION private_sec.hosted_game_id_on(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.hosted_game_id_on(text) TO authenticated, service_role;

-- ============================================================ 3. the blocker's own list, with names
CREATE OR REPLACE FUNCTION public.my_blocked_profiles()
RETURNS TABLE (blocked_id uuid, blocked_at timestamptz, display_name text, username text, avatar_initials text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT b.blocked_id,
         b.created_at,
         CASE WHEN s.shown THEN p.display_name END,
         CASE WHEN s.shown THEN p.username END,
         CASE WHEN s.shown THEN p.avatar_initials END,
         CASE WHEN s.shown THEN a.avatar_url END
    FROM public.user_blocks b
    LEFT JOIN public.profiles p ON p.id = b.blocked_id
    CROSS JOIN LATERAL (
      SELECT p.id IS NOT NULL
             AND p.suspended_at IS NULL
             AND private_sec.profile_visibility_of(p.id) IN ('public', 'members') AS shown
    ) s
    LEFT JOIN LATERAL private_sec.visible_avatars(ARRAY[b.blocked_id]) a ON true
   WHERE auth.uid() IS NOT NULL
     AND b.blocker_id = auth.uid()
   ORDER BY b.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.my_blocked_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_blocked_profiles() TO authenticated, service_role;

-- ============================================================ 4a. a waitlist entry or payment cannot be repointed by a client
-- Trigger arguments name the columns that must not change. Only the API roles are held to it.
CREATE OR REPLACE FUNCTION private_sec.lock_row_identity()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  _i int;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  FOR _i IN 0 .. TG_NARGS - 1 LOOP
    IF (to_jsonb(NEW) -> TG_ARGV[_i]) IS DISTINCT FROM (to_jsonb(OLD) -> TG_ARGV[_i]) THEN
      RAISE EXCEPTION 'ROW_IDENTITY_FIXED: % cannot be changed on this row.', TG_ARGV[_i]
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.lock_row_identity() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a0_game_position_waitlist_identity_locked
  BEFORE UPDATE ON public.game_position_waitlist
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_row_identity('user_id', 'game_id');

CREATE TRIGGER a0_payment_submissions_identity_locked
  BEFORE UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_row_identity('player_id', 'game_id', 'host_id', 'submitted_at');

-- ============================================================ 4b. what has ended stays ended
-- Runs as the caller (current_user tells the API roles apart); one function, one branch per table.
CREATE OR REPLACE FUNCTION private_sec.lock_closed_relationship()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'hosted_games' THEN
    IF NOT private_sec.hosted_game_on(OLD.cancelled_at, OLD.completed_at, OLD.status, OLD.date, OLD.ends_at)
       AND private_sec.hosted_game_on(NEW.cancelled_at, NEW.completed_at, NEW.status, NEW.date, NEW.ends_at) THEN
      RAISE EXCEPTION 'GAME_CLOSED: a game that is over or called off cannot be reopened.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'join_requests' THEN
    IF OLD.status = 'rejected' AND NEW.status IS DISTINCT FROM 'rejected'
       AND auth.uid() IS DISTINCT FROM OLD.player_id THEN
      RAISE EXCEPTION 'DECISION_FINAL: a declined request can only be sent again by the player.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'game_position_waitlist' THEN
    IF OLD.status IS DISTINCT FROM 'waiting' AND NEW.status = 'waiting' THEN
      RAISE EXCEPTION 'DECISION_FINAL: a reviewed waitlist entry cannot be put back to waiting.'
        USING ERRCODE = '42501';
    END IF;
  ELSIF TG_TABLE_NAME = 'payment_submissions' THEN
    -- settled (verified, rejected, cancelled) and moved to pending, disputed or verified, by anyone but the player;
    -- except the host's "Mark unpaid": verified back to pending while the game is on
    IF COALESCE(OLD.status, '') NOT IN ('pending', 'disputed')
       AND NEW.status IN ('pending', 'disputed', 'verified') AND NEW.status IS DISTINCT FROM OLD.status
       AND auth.uid() IS DISTINCT FROM OLD.player_id
       AND NOT (OLD.status = 'verified' AND NEW.status = 'pending' AND private_sec.hosted_game_id_on(OLD.game_id)) THEN
      RAISE EXCEPTION 'DECISION_FINAL: a settled payment can only be reopened by the player.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.lock_closed_relationship() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER a1_hosted_games_closed_locked
  BEFORE UPDATE ON public.hosted_games
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_closed_relationship();

CREATE TRIGGER a1_join_requests_closed_locked
  BEFORE UPDATE ON public.join_requests
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_closed_relationship();

CREATE TRIGGER a1_game_position_waitlist_closed_locked
  BEFORE UPDATE ON public.game_position_waitlist
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_closed_relationship();

CREATE TRIGGER a1_payment_submissions_closed_locked
  BEFORE UPDATE ON public.payment_submissions
  FOR EACH ROW EXECUTE FUNCTION private_sec.lock_closed_relationship();

-- ============================================================ 5. names for the people in a host's live games
CREATE OR REPLACE FUNCTION public.managed_profile_names(_ids uuid[])
RETURNS TABLE (id uuid, display_name text, avatar_initials text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH me AS (
    SELECT auth.uid() AS uid
  ), live AS (
    -- the caller's games that are still on
    SELECT g.id
      FROM public.hosted_games g, me
     WHERE g.host_id = me.uid
       AND private_sec.hosted_game_on(g.cancelled_at, g.completed_at, g.status, g.date, g.ends_at)
  )
  -- No visibility term and no username, on purpose: the answer must not depend on the person's public / members / private
  -- choice, or "no profile row, but a name here" would tell "blocked me" from "private" (the bit 6. and 7. hide). The name
  -- and initials are the ones private_sec.visible_avatars gives any caller for any id; the avatar is visible_avatars' own.
  SELECT p.id, p.display_name, p.avatar_initials, a.avatar_url
    FROM me
    JOIN public.profiles p ON p.id = ANY (_ids)
    LEFT JOIN LATERAL private_sec.visible_avatars(ARRAY[p.id]) a ON true
   WHERE me.uid IS NOT NULL
     AND cardinality(_ids) <= 500
     AND p.id <> me.uid
     AND (EXISTS (SELECT 1 FROM public.game_participants gp JOIN live ON live.id = gp.game_id
                   WHERE gp.user_id = p.id)
          OR EXISTS (SELECT 1 FROM public.game_position_waitlist w JOIN live ON live.id = w.game_id
                      WHERE w.user_id = p.id AND w.status = 'waiting')
          OR EXISTS (SELECT 1 FROM public.join_requests jr JOIN live ON live.id = jr.game_id
                      WHERE jr.host_id = me.uid AND jr.player_id = p.id AND jr.status IN ('pending', 'approved'))
          OR EXISTS (SELECT 1 FROM public.payment_submissions ps
                      WHERE ps.host_id = me.uid AND ps.player_id = p.id
                        AND (ps.refund_status = 'owed'
                             OR (ps.status = 'verified' AND EXISTS (SELECT 1 FROM live WHERE live.id = ps.game_id))
                             OR (ps.status IN ('pending', 'disputed')
                                 AND (ps.submitted_at > now() - interval '30 days'
                                      OR EXISTS (SELECT 1 FROM live WHERE live.id = ps.game_id))))));
$$;
REVOKE ALL ON FUNCTION public.managed_profile_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.managed_profile_names(uuid[]) TO authenticated, service_role;

-- ============================================================ 6. profile_visibility_of answers a client only about itself
-- 20260907234853's wrapper, contained the SEC-2 way (party exemption: the person themselves). Visitors lose EXECUTE, as for
-- the SEC-2 wrappers; the other grants are unchanged.
CREATE OR REPLACE FUNCTION public.profile_visibility_of(_user uuid)
RETURNS text LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT CASE WHEN private_sec.rpc_probe_denied('profile_visibility_of', ARRAY[_user], current_user) THEN 'private'::text
              ELSE private_sec.profile_visibility_of(_user) END;
$$;
REVOKE EXECUTE ON FUNCTION public.profile_visibility_of(uuid) FROM anon;

-- ============================================================ 7. profile_ages follows the profile rule
-- 20261106150000 verbatim, plus the one condition marked below.
CREATE OR REPLACE FUNCTION public.profile_ages(_ids uuid[])
RETURNS TABLE(id uuid, age integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.user_id,
         date_part('year', age(b.birthday))::int
  FROM public.profile_birthdays b
  WHERE b.user_id = ANY(_ids)
    AND b.birthday IS NOT NULL
    AND public.profile_visibility_of(b.user_id) IN ('public','members')
    -- 20261125100000: not for a profile a block or a suspension hides from the caller
    AND (auth.uid() IS NULL OR NOT private_sec.profile_hidden_from_viewer(b.user_id))
    AND (
      -- an adult's age follows their visibility setting, as before
      public.age_cohort_of(b.user_id) = 'adult'
      -- the server (service role, workers, migrations) has no auth.uid()
      OR auth.uid() IS NULL
      -- a minor's age: the minor, a verified guardian, or a moderator
      OR b.user_id = auth.uid()
      OR public.is_guardian_of(auth.uid(), b.user_id)
      OR public.is_moderator(auth.uid())
    );
$$;

-- ============================================================ 8. "request a spot" in two game notifications
-- guardian_approve_join_request: 20261110120000 verbatim, only the pending-approval body reworded
CREATE OR REPLACE FUNCTION public.guardian_approve_join_request(_request uuid, _approve boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _row public.join_requests;
  _keep boolean;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED'; END IF;
  SELECT * INTO _row FROM public.join_requests WHERE id = _request FOR UPDATE;
  IF _row.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF NOT public.is_guardian_of(_me, _row.player_id) THEN RAISE EXCEPTION 'NOT_GUARDIAN'; END IF;
  -- Approving needs an eligible guardian. Declining, the protective answer, needs only the link.
  IF _approve AND NOT private_sec.guardian_approver_eligible(_me) THEN RAISE EXCEPTION 'GUARDIAN_NOT_ELIGIBLE'; END IF;
  IF _row.status NOT IN ('pending', 'approved') THEN RAISE EXCEPTION 'REQUEST_NOT_PENDING'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_participants gp
              WHERE gp.game_id = _row.game_id AND gp.user_id = _row.player_id) THEN
    RAISE EXCEPTION 'ALREADY_ON_ROSTER: this child is already in the game; cancel their spot from the game page.';
  END IF;

  IF _approve THEN
    -- Keep an existing approval only while the guardian who gave it still has
    -- authority; a stale one (link ended, guardian no longer eligible) is replaced.
    _keep := _row.guardian_approved_at IS NOT NULL
             AND private_sec.guardian_approval_valid(_row.player_id, _row.guardian_approved_by);
    UPDATE public.join_requests
       SET guardian_approved_at = CASE WHEN _keep THEN guardian_approved_at ELSE now() END,
           guardian_approved_by = CASE WHEN _keep THEN guardian_approved_by ELSE _me END
     WHERE id = _request AND status IN ('pending', 'approved');

    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (_row.player_id, 'join_request_guardian_approved', 'Your guardian approved this request',
            CASE WHEN _row.status = 'approved'
                 THEN 'Your guardian and the host both said yes. You can take your place now.'
                 ELSE 'Your guardian approved your request for a spot in this game.' END,
            '/games/' || _row.game_id);
  ELSE
    -- join_requests has no 'withdrawn-by-guardian' concept distinct from the
    -- player's own withdrawal; reuse the existing 'rejected' status rather
    -- than widening join_requests_status_chk for a guardian-specific value.
    -- A guardian's no also takes back any approval on the request (another guardian's or their own earlier yes).
    UPDATE public.join_requests
       SET status = 'rejected', reviewed_at = now(), reviewer_notes = 'Declined by guardian',
           guardian_approved_at = NULL, guardian_approved_by = NULL
     WHERE id = _request AND status IN ('pending', 'approved');
  END IF;
END;
$function$;

-- release_expired_payment_holds: 20261103140000 verbatim, only the player's body reworded
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
$function$;

-- ============================================================ 2. the two read rules (same names, roles and visibility terms)
-- Last on purpose (see LOCK ORDER): ALTER POLICY takes ACCESS EXCLUSIVE on public.profiles until commit.
ALTER POLICY "Public profiles viewable by anon" ON public.profiles
  USING (private_sec.profile_visibility_of(id) = 'public'
         AND suspended_at IS NULL);

ALTER POLICY "Profiles viewable by members" ON public.profiles
  USING (id = (SELECT auth.uid())
         OR (private_sec.profile_visibility_of(id) IN ('public', 'members')
             AND (suspended_at IS NULL OR (SELECT private_sec.is_moderator(auth.uid())))
             AND id <> ALL ((SELECT private_sec.viewer_block_peers())::uuid[])));
