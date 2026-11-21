# Blocks and suspensions hide a profile

Status: **tested on a scratch database only. Not applied to the sandbox or production, not merged.** Production apply is left to
the release orchestrator.
Migration `supabase/migrations/20261125100000_profile_blocks_suspension.sql` (md5 cf862120); test
`supabase/tests/960_profile_blocks_suspension.test.sql` (200 assertions); rollback
`docs/rollbacks/20261125100000_profile_blocks_suspension.down.sql`.

This closes the open item first recorded in batch 18 and still open in batch 20. The owner decided on 2026-11-20 to build it as an
additive, reversible migration with SQL tests and a guarded rollback.

## The problem

The two read rules on `public.profiles` asked only whether the profile is public, members-only or private. They didn't check
blocks or suspensions. So:

- A person someone had blocked, in either direction, still read that person's profile at `/players/:id`.
- A suspended account's profile was readable by everyone.

The player card and the player passport are built on the server, and they already hid suspended accounts. The passport also hid
blocks. Only the direct read through row-level security leaked.

## What changes

- **A block hides both people from each other.** When either person has blocked the other, neither reads the other's profile row.
  Nobody else is affected. Signed out, a public profile reads as before, because a block is between two accounts.
- **A suspension hides the profile.** While `suspended_at` is set, nobody reads the profile except the person themselves and staff
  (admin, moderator or superadmin). Lifting the suspension restores it straight away.
- **The person always reads their own row**, whether they are suspended or have blocked someone.
- **Staff** still see only public and members-only profiles through this rule, as before. They use the service role for moderation
  work. A block a staff member makes applies to them like anyone else.
- **Unchanged:**
  - public, members-only and private visibility;
  - the minors' defaults (13-17 members-only, under 13 and unknown age private);
  - the privacy floor;
  - `profile_visibility_of` and every rule that uses it (follows, reels, posts);
  - the column-level REVOKE on `suspended_at`. Members still can't read who is suspended. The new helper reads it as its owner.
- **The block list keeps its names.** The blocker can no longer read the blocked person's profile row. A new function,
  `public.my_blocked_profiles()`, returns the caller's own blocks with each person's name, username, initials and avatar. The
  app's block list (`useBlockedUsersList` in `src/lib/moderation.ts`, used by Account > Blocked accounts and the game
  editor's "Blocked accounts" section) reads it, so both still show who is blocked. It only returns:
  - names the profile rule would have shown without the block. A private, child or suspended account shows as "Blocked account".
  - an avatar that follows the usual avatar rules (`visible_avatars`).
  - rows for signed-in callers, about their own blocks. Visitors are refused, and the blocked person can't see who blocked them.

  While the function is missing (before this migration, and after the rollback) the app reads `user_blocks` and `profiles`
  instead, which the old rules allow. Any other failure shows the usual error, not a list of unnamed rows. **The app change
  ships before the migration, or with it.**

- **Hosts keep the names of the people in their live games.** A block or a suspension does not remove anyone from a game
  or a payment. The host still has to verify, refund or remove the player. A new function,
  `public.managed_profile_names(ids)`, returns the name, initials and avatar (never the profile row, and no username) of a
  person the caller hosts, and only while that relationship lasts:
  - on the roster of a game they host, or waiting on its waitlist, while the game is on (not cancelled, not completed, and
    started, or ended when an end time is set, less than 7 days ago);
  - with a pending or approved request for a spot in such a game;
  - with a payment submission addressed to them that has a refund still owed (not one already refunded or kept), is
    verified for such a game, or is pending or disputed while its game is on or for 30 days after it was sent.

  An end time counts for at most 7 days past the start, so a game is on until at most 14 days after it started, whatever end
  time the host gives it.

  Every one of these rows is one the person wrote themselves (a client can only insert them as itself), and nobody can point
  them at someone else afterwards: a trigger now refuses a client's change to who a waitlist entry or a payment submission
  is about (`user_id`, `player_id`, `game_id`, `host_id`, and the payment's `submitted_at`, which the 30 days count from), as
  `join_requests` already did. Before this, a host could waitlist themselves on their own game, or take one real payment
  submission, and repoint it at anyone.

  The host also can't bring an ended relationship back. Every column the function reads to decide whether a relationship
  lasts is one the host can write, so a second trigger now refuses a client's change that reopens one:
  - a game that is over or called off can't be made on again: clearing `cancelled_at` or `completed_at`, setting the status
    back (a game cancelled or completed only by its status, as a moderator's cancel leaves it, counts as over), or moving
    the date or end time back into range (`GAME_CLOSED`);
  - a declined request goes back to pending only when the player asks again (with the existing 15-minute wait and
    three-try cap); the host can't approve it or put it back to pending (`DECISION_FINAL`);
  - a reviewed waitlist entry, approved or declined, can't be put back to waiting (`DECISION_FINAL`);
  - a verified, declined or cancelled payment can't be moved to pending, disputed or verified by anyone but the player
    (`DECISION_FINAL`). A declined or cancelled payment comes back only when the player sends a new one or disputes the
    decision. One exception: the host can still mark a verified payment unpaid (back to pending) while its game is on. A
    verified payment for a game that is on is named anyway, and a pending one lasts no longer than if the host had never
    verified it.

  The service role and the server's own functions are not held to these. Three host buttons did one of them and are
  removed with this change: "Verify anyway" on a declined payment in the roster row (`RosterPlayerRow`), "Confirm received"
  on a declined payment in the payments panel (`GamePaymentsPanel`), and "Mark as paid" on a roster row whose latest
  claim was cancelled (by the player, or by the host's "Cancel claim"). The row now says the claim was cancelled and the
  player can send their payment again, as it does for a declined one, and `reviewPaymentAction` refuses to mark a
  cancelled or declined claim paid, in words, before the database would. The player sees either as unpaid and sends it
  again, as before. "Mark unpaid" on the roster row keeps working while the game is on; once it is over the host is told
  the decision is final. Without these limits, a host could undo the "only while it lasts" limit at any time, and get back
  the name of anyone who had ever touched one of their games, after that person blocked them or was suspended.

  The server's own placement after a verified payment (`addPaidPlayerToRoster`, `src/lib/roster-on-payment.server.ts`)
  runs with the service role, so the join gate's block check (`enforce_host_block`, which only looks at a player joining
  themselves) never saw it. It now makes the gate's check itself: it does not place a player the host has blocked. A
  player who blocked the host is placed, as before: the join gate and the payment claim gate let them request a spot and
  pay, so refusing them only after the host confirmed their money would leave them paid and off the roster. The "Paid,
  not on the roster" notice names the player to the host, as the host's screens do, except a suspended account ("A
  player"). It does not hide the name of someone who blocked the host: that alone would tell the host who did.

  The function names everyone in such a relationship, whatever their public, members-only or private setting, a private or
  child account included. Naming only public and members-only accounts would make "no profile row, but a name from this
  function" an exact test for "this person blocked me", the same bit `profile_visibility_of` and `profile_ages` now hide
  (below). For an account that is not suspended, the name and initials are what `visible_avatars` already gives any
  signed-in caller for any id. A suspended account is the one exception: `visible_avatars` has no entry for it, but the
  host still gets its name here while the relationship lasts, so they can tell the people in their own game apart (on
  `main`, `settle_paid_spot`'s refund notice already names such a player to the host). The username, which
  `visible_avatars` doesn't give out, is not returned. On the host's screens a private
  player in their game now shows by name instead of "Player". The avatar is `visible_avatars`' own: it follows the
  person's avatar setting, and a suspended account has none. Visitors are refused, and nobody gets their own id or more
  than 500 ids. Nobody else gets anything:
  not a team-mate in the same game, not the player about the host they blocked. The name goes when the relationship goes: a
  rejected request, a declined waitlist entry, a cancelled payment with nothing owed, a player who left, and a game that is
  over all stop it, and the host can't undo any of these. `/players/:id` and every other read of the row stay hidden from the
  host.

  The app fills names from it only where a host's read of `profiles` left an id out (`src/lib/managed-profile-names.ts`,
  which never passes on a username):
  the roster (`game-roster.ts`), the host's roster rows on the game page (`RosterPlayerRow`: Confirmed and Awaiting payment,
  with their payment history), the payment verification queue (Payments > Verify), the payments panel, the unpaid list, the
  waitlist and join requests. For anyone else the call returns
  nothing and the screen shows "Player" as it did. While the function is missing, nothing is filled, which is the old
  behaviour.

- **Facility admins and team managers are not covered.** Anyone signed in can create a facility, and its admin can add any
  adult as a member without asking them; a team manager's roster is similar. So a membership is no evidence that the person
  chose the relationship, and naming people through it would let anyone name the accounts that blocked them, and suspended
  accounts. A member hidden by a block or a suspension shows as "Member" in the facility member list (`listOrgMembers`) and
  as "Player" on a team roster (`team-roster.ts`), and the admin or manager can still remove the row. This is deliberate.

- **`profile_visibility_of` and `profile_ages` answer like the profile rule.** `public.profile_visibility_of` used to tell
  any client the real visibility of any account. With the row hidden, that made "this account blocked me" an exact, bulk
  test: a hidden row whose visibility is public or members-only, and that still has an avatar entry (so is not suspended),
  can only be a block. That is what `blocks_exist_between` was contained to hide (SEC-2). It is now contained the same way:
  a non-staff client asking about someone else gets `'private'`; the person, staff, the service role (the player card and
  passport) and SECURITY DEFINER code get the truth. Visitors can no longer call it, like the SEC-2 wrappers: the check it
  makes is not open to visitors, so their call would only have failed with a permission error from inside it. The
  visitor rule on `profiles` and the app don't use it as a visitor. `public.profile_ages` gave the same test (an adult's age comes back only
  for a public or members profile), so it no longer returns an age for a profile hidden from the caller by a block or a
  suspension.

- **The rules stay fast.** Row security runs on every row a search scans, before an `ILIKE` filter. The block list, the
  signed-in id and the staff test are each worked out once per query, and the suspension test reads the row's own
  `suspended_at`. On 20,000 public profiles, an unanchored name search that matches nothing (the shape of the team-invite
  search) took about 580 ms, against about 620 ms before this migration and about 1,590 ms for the first version of these
  rules.

- **Wording.** Two game notifications now say "request a spot", as the app does since WP 4.3. Membership texts keep "request to
  join".
  - Guardian approval: "Your guardian approved your request for a spot in this game."
  - Unpaid hold released: "Your payment window ran out, so your spot was released. You can request a spot again if any are open."

  Notifications already sent keep their old text.

## What a person can infer

A blocked person who opens the blocker's public profile while signed in sees the neutral "private or unavailable" screen. Signed
out, they'd see the profile. That gap is also true of the passport today, and it's inherent to hiding a profile from one account
only.

Signed in, the API answers the same for a block as for a private profile: no profile row, `'private'` from
`profile_visibility_of`, no age from `profile_ages`, and an entry from `visible_avatars` (which a suspended account doesn't
have). That holds for a host too: for a person in one of their live games, `managed_profile_names` gives a name whether the
person is private or blocked the host, and the "Paid, not on the roster" notice names both (test 960 compares the two
answer for answer). Some content still follows only the person's visibility setting and not blocks, so comparing it can hint at a block:
for example the follow rows of a public or members-only account who follows someone. That is a weaker, indirect signal, not
the exact bulk test above, and it is left for a later change.

## Readers checked

- **Not affected:** no view, policy or SECURITY INVOKER function in the database reads `public.profiles`, so only direct app reads
  go through the changed rules. For anyone with no block and no suspension involved, the rules give exactly the old answer
  (test 960, first two sections).
- **App reads of another person's profile** (rosters, requests, payments panels, waitlists, messages, follows, reviews, team
  rosters) all use list or `maybeSingle` reads. None uses `.single()`, so a hidden row comes back missing instead of raising an
  error.
- **Hosts:** the screens where they must tell who someone is (roster and roster rows, payment verification queue, payments
  panel, unpaid list, waitlist, requests) fill a hidden
  row's name from `managed_profile_names`, as above. Without that, a player who blocked the host, or a suspended player, would
  show as "Player" while still holding a spot or a payment the host must verify or refund.
- **Facility admins and team managers:** a hidden member shows as "Member" (facility) or "Player" (team roster), as above.
- **SECURITY DEFINER functions don't see row-level security**, so they're unchanged:
  - The search and invite paths already check blocks and suspension themselves: `availability_post_visible` (players near you),
    `regular_invitable` (regulars and host groups), and `request_follow` with its follow triggers.
  - **`visible_avatars`** hides suspended accounts but not blocks. It gives a name and avatar for any id, for example in a shared
    game roster, so it's left as it is. Whether two people who blocked each other should still see each other's name inside a
    game they both joined is a product question.
  - **`getPlayerCard`** is a public, signed-out card that shows public profiles only, and hides suspended ones. It can't apply a
    block because it doesn't know the viewer.

## Rollback

`docs/rollbacks/20261125100000_profile_blocks_suspension.down.sql` puts back:

- the two rules exactly as `20260907234853` wrote them;
- `profile_visibility_of` as `20260907234853` wrote it, with visitors' EXECUTE granted back, and `profile_ages` as
  `20261106150000` wrote it;
- both notification functions as `20261110120000` and `20261103140000` wrote them.

It also drops the six lock triggers (two identity locks, four closed-relationship locks), `lock_row_identity`,
`lock_closed_relationship`, `hosted_game_on`, `hosted_game_id_on`, `viewer_block_peers`, `profile_hidden_from_viewer`,
`my_blocked_profiles` and `managed_profile_names`. The app keeps working after it. The block list reads `profiles` again
(the old rules allow it), and the host's screens fill no names, and need none, because the old rules show those rows again.

It refuses to run without `SET app.confirm_profile_blocks_suspension_rollback = 'yes'`. It also stops, changing nothing, if any of
the twelve functions, two rules or six triggers no longer has the definition this migration gave it (for the rules: their
USING text, roles, command and permissive flag, since `ALTER POLICY` puts back only the USING text), if the grants to
visitors, members or the service role on any of the four functions it keeps have changed, or if anything else calls a
function it drops. That covers callers `pg_depend` records (a rule or a view) and callers it doesn't: any other function,
rule, view or trigger whose text names one of them, which is how SQL and plpgsql functions call each other.

**Lock order.** The migration locks the four trigger tables first, in one statement, in a mode readers pass (SHARE ROW
EXCLUSIVE), and changes the two profiles rules last. The lock on `public.profiles`, which nearly every request reads, is
then held only for the final statements, and never while waiting for another table. The first version changed the rules
first; rehearsed against a transaction shaped like `mark_refund_sent` (write a payment, then read `profiles`), one of the two
was killed as a deadlock.

The rollback can't copy that order. Dropping a trigger and changing a rule need ACCESS EXCLUSIVE, which stops reads too,
on all five tables. Holding one while queued for another stalled every read of the first, and deadlocked with a request
that read `profiles` and then `hosted_games`. So the rollback takes all five before any change, one table at a time,
within one budget for the whole try: 200 ms, or half the server's `deadlock_timeout` if that is less. Each table's wait
is limited to what is left of the budget. (`lock_timeout` limits each lock on its own, so the earlier version, one 200 ms
`lock_timeout` for one five-table `LOCK`, could hold the first table for about 800 ms in a single try.) A try that can't
get all five gives back what it got and tries again a moment later, up to 50 times, then stops with nothing changed. A
request queued behind a try waits at most the budget, under half the deadlock check, so the check never fires and no
request is killed as a deadlock victim. Once it holds all five, the rest takes milliseconds. Each try can still hold up
reads of the tables it has for up to 200 ms, so run it in a quiet moment.

## Checked locally

- **Rehearsed on a full local replay of main `23760091`** (catalog of every function with its grants, policy with its roles
  and kind, and trigger in `public` and `private_sec`; main md5 9a644ac4, with this migration 76fd01da, the same as a full
  replay of this branch):
  1. Without the confirmation, the rollback was refused and nothing changed.
  2. With "Profiles viewable by members" widened to `TO authenticated, anon` it was refused and named the rule's roles.
     With `EXECUTE` on `profile_ages` granted to `anon` it was refused and named the grants. With a new SQL function calling
     `hosted_game_id_on` it was refused and named the caller; with `hosted_game_id_on` changed by hand it was refused and
     named the function. (Earlier rounds: `managed_profile_names` changed, one trigger dropped, and callers of
     `viewer_block_peers` and `hosted_game_on` in a SQL function, a plpgsql function and a policy were all refused the same
     way.) Each time the catalog was unchanged.
  3. With the confirmation, the catalog matched main's replay exactly (md5 9a644ac4), grants included.
  4. A second run was refused.
  5. Re-applying the migration gave back the same catalog (md5 76fd01da).
- **Rollback lock budget rehearsed:** four sessions held `join_requests`, `game_position_waitlist`, `payment_submissions`
  and `profiles` and let go 150, 300, 450 and 600 ms after the lock step started, while a fifth read `hosted_games` every
  10 ms. The previous version's single try waited for each table in turn and held `hosted_games` for about 600 ms (the
  longest read waited 594 ms). This version gave up its first try at 200 ms (longest read 192 ms) and got all five on the
  next one.
- **Rollback locks rehearsed:** while one session read `profiles`, waited 2 s and then read `hosted_games`, and another read
  `hosted_games`, waited 2.5 s and then read `profiles`, the rollback retried until both had committed and then finished.
  Neither session was killed, no deadlock was reported, and the catalog matched main. The previous version of the rollback
  deadlocked with the first session.
- **Migration lock order rehearsed (earlier round):** the migration, applied in one transaction while another session wrote
  `payment_submissions`, slept and then read `profiles` (the `mark_refund_sent` shape, with and without `FOR UPDATE`), waited
  for that session and then committed; both succeeded.
- **Test 960** (200 assertions). Against the previous round's `managed_profile_names` it fails 5: a private player in the
  host's game is not named, so the host's view of a player who blocked them (no row, a name, an avatar entry) differs from
  a private player's, and the function returns a username. It also fails when `managed_profile_names` takes the avatar
  from the raw columns instead of `visible_avatars` (a suspended player's public avatar, a game-members avatar of a
  waitlisted player who shares no game with the host), when `my_blocked_profiles` names only public accounts (a blocked
  members-only account), and when its order is reversed (newest block first). Against the round before, it fails 6: a visitor calling
  `profile_visibility_of`, the host verifying a declined or cancelled payment, the host's "Mark unpaid" on a live game, and
  the names those flips brought back. It also fails when any of these is changed (each tried on its own): the join
  request lock narrowed to re-approval only, the payment lock narrowed to cancelled or verified payments, the waitlist lock
  narrowed to declined entries, the status term removed from `hosted_game_on`, `GAME_CLOSED` narrowed to the date and
  timestamp columns, the waitlist branch counting games that are over, a refund that is settled still counting, a verified
  payment for a live game not counting, the player's own exemption removed from the payment lock, and either payment lock
  holding the service role. Earlier rounds showed it failing 19 when the two rules are put back to their old form, and when
  either identity lock is disabled or loses a column, when `profile_visibility_of` or `profile_ages` is put back, when
  `profile_hidden_from_viewer` loses its self or staff exemption, when `my_blocked_profiles` stops hiding a private
  account's avatar, when the facility branch is added back to `managed_profile_names`, when any of its status, live-game,
  30-day, end-time or caller filters is removed, and when its 500-id limit is off by one.
- **App tests:** `src/lib/managed-profile-names.test.ts` checks that the four list screens (roster, payments panel,
  waitlist, unpaid list) build their names from `withManagedProfileNames`, and that no username is passed on.
  `src/lib/roster-on-payment.server.test.ts` checks that a player the host blocked is not placed, that a player who blocked
  the host is placed, and that the host's notice names a player who blocked them but not a suspended one.
  `src/lib/payment-states.test.ts` checks that a cancelled or declined claim cannot be marked paid
  (`reviewPaymentAction` says so before updating) and that the roster row shows a cancelled claim without "Mark as paid".
  Each of these new cases fails against the previous round's code.
- **Full SQL suite:** 3221 passed, 0 failed. **App:** 4875 vitest tests passed.
