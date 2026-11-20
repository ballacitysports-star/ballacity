# Profiles respect blocks and suspension

Status: **tested on scratch databases and applied to the sandbox (`qkukefvzwlyusvspablz`). Not merged, not published,
not applied to production.** Production needs the
owner's explicit approval and goes through the ledger-apply route with a wrong-md5 negative control first.

- Migration: `supabase/migrations/20261126100000_profiles_respect_blocks_and_suspension.sql`
- Test: `supabase/tests/960_profiles_respect_blocks_and_suspension.test.sql`
- Rollback: `docs/rollbacks/20261126100000_profiles_respect_blocks_and_suspension.down.sql`
- App: `src/lib/viewer-blocks.server.ts`, `src/lib/player-card.functions.ts`, `src/lib/moderation.ts`, plus unit tests
  `src/lib/player-card-blocks.test.ts` and `src/lib/blocked-users-list.test.ts`

Found during the WP 4.0 review (`docs/release/records/2026-11-20-batch-18.md`, "Open").

## The gap

- The rule that lets one member read another's profile row was
  `id = auth.uid() OR private_sec.profile_visibility_of(id) IN ('public','members')`. `profile_visibility_of` reads
  only `privacy_preferences`, the age default and the guardian's public-profile switch. Nothing checked `user_blocks`.
- So if A (an adult, visibility `members`) blocked B, B could open `/players/A` and see A's name, bio, city, availability
  and reels.
- `/players/:id` read `profiles` with no suspension filter, but `getPlayerCard` hid suspended accounts. Comparing the
  two pages showed that an account was suspended.

## The rule now

A profile row is returned when any of these holds:

1. **It is the viewer's own row.** A suspended person, a person who blocked someone and a person who was blocked all
   still read their own profile, and can still update it.
2. **The viewer is staff** (`private_sec.is_moderator`: admin, moderator or superadmin), **and the visibility allows
   it.** Staff are exempt from the two new conditions only. They gain nothing else: a private profile stays hidden
   from staff through this rule, as before. Admin pages read with the service role, unchanged.
3. **The visibility allows it, the account is not suspended, and there is no block either way** between the viewer and
   the owner.

Anonymous visitors see a profile only when it is `public` and not suspended.

Every hidden case returns no row. That is the same answer as for a private or deleted account, so `/players/:id` shows
the existing "This profile is private or unavailable" screen (`ProfileUnavailable`) without saying which case it is.

**Blocks.** The policy checks the viewer's block partners in both directions with `private_sec.my_block_partners()`. It
reads the same `user_blocks` rows as `private_sec.blocks_exist_between`, the helper the message, follow-request,
availability and invite rules use. The difference is that it fetches the list once per statement, not once per row.
Test 960 checks that the two helpers agree for every pair of fixture accounts. The helper takes no argument, so it only
ever answers about the caller. `anon` cannot execute it, and `private_sec` is not exposed by the API.

**Unchanged:**

- `private_sec.profile_visibility_of` and `default_profile_visibility_for`, so the minors' defaults are unchanged:
  - 13 to 17: `members`;
  - under 13 and unknown age: `private`;
  - a child whose guardian switched the profile on: `public`.
- The function has many other callers, including the service role with no viewer, SECURITY DEFINER RPCs acting for
  someone else, and the reel and avatar rules. Making it depend on the viewer would have changed all of them at once.
- No other policy, view or SECURITY INVOKER function reads `profiles`. This was checked against the catalog of a full
  replay: all 61 functions that read it are SECURITY DEFINER. So the change reaches direct API reads of `profiles` and
  nothing else.

## The player card (`/player-card/:id`)

`getPlayerCard` reads with the service role, so the database has no viewer to check. The app checks instead:

- `optionalViewerId` reads the bearer token. The browser attaches it to every server-function call when signed in.
  The token is verified with `auth.getClaims`. With no token, or one that does not verify, the viewer is treated as
  anonymous.
- `hiddenByBlock` asks `blocks_exist_between` with the service role, then `is_moderator` only when there is a block. The
  same staff exemption applies.
- A blocked viewer gets the same empty answer as for a private or suspended player, before any profile or game is read.
- A failed block lookup hides the card from that viewer (fail closed).
- The card already hid suspended accounts from everyone, staff included. That is unchanged.

**Limit, true of any public page:** a `public` profile is readable by anyone signed out. A block hides it from the
blocked account while signed in, not from a person who signs out.

## Blocked-accounts list

Rule 3 hides the blocked person from the person who blocked them. Before this change, Settings → Blocked accounts (and
the blocked-players section of the game editor) read their profile rows to show names. `public.my_blocked_profiles()`
now returns the caller's own blocks with the names the list could show before:

- a name only for a `public` or `members` profile;
- "Blocked account" for a private one, as always;
- and now also "Blocked account" for a suspended one, so suspension looks like a private account there too.

It never shows who blocked the caller. If the function is missing (the app ahead of the migration, or after the
rollback), `fetchBlockedUsers` reads `user_blocks` and `profiles` directly, the old behaviour. So the app and the
migration can ship in either order. App first is preferred, so the list never shows "Blocked account" for everyone.

## Other screens that read profiles

All 108 `from("profiles")` call sites in `src/` were reviewed. For an unblocked viewer looking at an account that is
not suspended, every read returns exactly what it did before, because the rule only adds conditions for blocks and
suspension.

For blocked or suspended accounts, nothing throws: there is no `.single()` on profiles, and every lookup uses `?.` or a
fallback. These are the visible effects:

- **Rosters, waitlists, join requests, payments, invites, reviews, team roster, team chat, org members, comments, inbox
  and conversation header.** The hidden person appears under the screen's existing fallback label ("Player", "Member",
  "Someone", "BallaCity member"). Counts come from the underlying tables, so they do not change.
- **Followers / following and follow requests** (`src/lib/follows.ts`). Hidden people are filtered out of the list:
  - the header counts come from `follows`, so a list can be shorter than its count;
  - "Follow requests (N)" counts the filtered list;
  - blocking already removes follows and follow requests between the two people
    (`20261106170000_follow_requests_respect_blocks`), so in practice this affects suspended accounts.
- **Search** (`searchPlayersForTeam`, `searchProfilesForInvite`): blocked and suspended people no longer appear. This
  is intended.
- **The profile page:** someone who blocked a person can no longer unblock them from that person's page, because the
  page now shows "unavailable". Unblocking stays in Settings → Blocked accounts and in a conversation's safety menu.
- **Staff screens** (`audit-log`, admin and superadmin) are exempt or use the service role. No change.

## Follow-ups (not in this change)

- `public.visible_avatars` (the avatar and display-name lookup behind `UserAvatar`) hides suspended accounts but does
  not check blocks. A blocked person can still see the other's avatar and display name where a screen uses it. It does
  not show the profile (bio, city, availability, reels). Closing this needs its own decision, because rosters and chats
  use it to label people.
- The conversation header and safety dialog label a blocked person "Player" ("Unblock Player"). A narrow
  conversation-scoped name lookup would restore the name there, if wanted.
- Follow requests from a suspended requester cannot be seen or declined while the suspension lasts.

## Performance

Measured on a scratch replay with 20,000 profiles:

- mix: 60% `members`, 25% `public`, 15% `private`, 1% suspended;
- the viewer has 50 blocks each way, plus 5,000 unrelated blocks;
- each query was run 3 times and the average taken.

| Query (as the viewer)                   | Old rule | Per-row `blocks_exist_between` | This migration (`my_block_partners`) |
| --------------------------------------- | -------- | ------------------------------ | ------------------------------------ |
| Name search, `ILIKE '%ab%'`, `LIMIT 20` | 36 ms    | 53 to 65 ms                    | 31 ms                                |
| 100 ids, `id IN (...)` (a roster)       | 3.1 ms   | 4.5 to 6.2 ms                  | 2.8 ms                               |
| Every visible row (16,500 rows)         | 484 ms   | 681 to 730 ms                  | 552 ms                               |
| One id                                  | 0.1 ms   | 0.1 ms                         | 0.1 ms                               |

`auth.uid()`, the staff check and the block list each run once per statement (InitPlans). The new per-row work is a
`suspended_at` test and an array check, both before the existing visibility lookup. A viewer with thousands of blocks
would pay a linear array check per row. That is acceptable at the block counts the app sees.

## Checked

- **Test 960:** 65 assertions. It covers:
  - blocked either way, including when the viewer cannot read the other's block row;
  - unblocking giving the row back;
  - minors blocked in both directions;
  - suspended accounts for members, anonymous visitors and minors, and that suspended looks the same as private;
  - self (suspended, blocker, blocked, private, under 13), including a suspended person updating their row;
  - staff (moderator and superadmin): suspended and blocked accounts still visible, private ones still not, and the
    exemption ending with the role;
  - public, members-only and private for anonymous visitors and members;
  - minors' defaults and the guardian-public child;
  - list and search reads dropping exactly the hidden rows;
  - `my_blocked_profiles`;
  - `my_block_partners` agreeing with `blocks_exist_between` for every pair;
  - grants.
- **Without the protection:** against the old rule (after the rollback), test 960 fails on 17 assertions: every block
  and suspension check, and the role-ending checks. Every assertion about unchanged behaviour still passes. Removing
  the player card's check fails 3 of the 14 card tests.
- **Rollback:**
  - it refuses without its confirmation;
  - it then restores both rules to the exact text of the previous migration and drops both functions;
  - a second run refuses, because the rules no longer match.
- **Full suites:** SQL 3300 passed, 0 failed (a fresh replay of 442 migrations). Unit 4832 passed, 0 failed. Typecheck
  passes; the lint ratchet, format check and policy-test gate pass.
- **Ledger route, rehearsed locally** on a replay of `main` `6dfd17e` (fingerprint `3b00338f`, 3446 objects, batch 8's
  C-collation method over `docs/migration-evidence/catalog-fingerprint-cte.sql`):
  - the file's md5 is `9c7917bd`;
  - a copy requiring a wrong md5 raised and rolled back, leaving no ledger row and no function;
  - the real apply gave `c21cdab4` (3448 objects), equal to a fresh full replay of this branch.
- **Sandbox `qkukefvzwlyusvspablz`** (Postgres 17.11), 2026-11-20 about 23:15 UTC, through the Management API:
  - **Pre:** ledger 63, latest `20261125200000`; old rules in place. The catalog equals the local pre-state `3b00338f`
    (3446), leaving out the sandbox-only `_schema_import_requests` table as earlier records do.
  - **Negative control:** the wrong-md5 copy was refused ("md5 mismatch"); the ledger and catalog were unchanged.
  - **Apply:** ledger 64, ledger text md5 `9c7917bd`. The catalog is `c21cdab4` (3448), equal to the branch replay.
  - **Fingerprints:** the rules and both functions have the md5s the rollback guard expects, so the guard holds on
    Postgres 17. `anon` cannot execute either function; `authenticated` can execute `my_blocked_profiles`.
  - **Smoke test,** in a transaction that always rolls back:
    - the blocked person sees the blocker: 0 rows;
    - an unblocked account: 1;
    - a suspended account: 0;
    - self: 1;
    - the blocker sees the blocked person: 0;
    - the blocker's list: 1.

    No test users were left behind (0 rows).
- **Not done:** a browser pass of `/players/:id` and `/player-card/:id` against the sandbox. The CI E2E suite runs
  against the sandbox, which now has the migration.
