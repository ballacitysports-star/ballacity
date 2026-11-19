# WP 3.2b: a host's groups of regulars

Status: **tested on scratch databases and applied to the sandbox. Not merged, not published, not applied to production.**
Migration `supabase/migrations/20261124100000_host_groups.sql` (md5 243c453a); test `supabase/tests/950_host_groups.test.sql`
(27 assertions); rollback `docs/rollbacks/20261124100000_host_groups.down.sql`. It needs WP 3.2a (`20261123100000`) first.

The owner was asked whether a pickup group should be a host's private named list or a group players can see and ask to join.
They replied "finish all open items and continue" without choosing, so this builds the recommended option: a private list kept
by the host. A joinable group is not built.

## What it does

- **Groups:** a host can keep named lists of their regulars, for example "Tuesday crew".
  - At most 20 lists, with names unique per host, 1 to 60 characters.
  - At most 50 people per list.
- **Who can be added:** only someone who is one of the host's regulars at that moment (WP 3.2a): an adult who played in this
  host's games in the last 90 days, with no block either way, not suspended, and not opted out. So a list can't be used to
  collect strangers or minors.
- **Who can see a list:** only the host who owns it can read, add to, remove from, rename or delete it. The people on a list
  aren't told and can't see it. A narrow helper (`private_sec.is_my_regular`) answers only about the caller's own regulars, so it
  reveals nothing about anyone else's games.
- **Inviting a group** goes through `game_invite_players`, so every invitation rule applies at that moment. Someone who has since
  blocked the host, opted out or stopped being a regular is refused with the neutral answer. The sheet shows how many people in
  the group can't be invited right now.
- **Data export:** a host's export includes their list names (not who is on them, since that is other people's data). Deleted
  accounts take their rows with them.
- **App:** in "Invite regulars":
  - Chips switch between "All regulars" and each group.
  - With people picked under "All regulars", "Save these N as a group (only you see it)" stores them under a name.
  - A selected group can be deleted.
  - The picker only counts and sends people visible in the current view.

## Checked

- **Test 950:** 27/27. It covers:
  - privileges, including that the owner of a list can't be changed;
  - creating a list, with the name tidied;
  - adding regulars, and refusing a stranger, a minor and someone who blocked the host;
  - unique names, and no creating a list for someone else;
  - people on a list and other members seeing nothing and changing nothing; visitors refused;
  - inviting a whole list, where someone who opted out since is not invited;
  - removing, deleting with members going with it, and the 20-list limit.
- **Full suites:** SQL 2963 passed, 0 failed. Unit 4368 passed, 0 failed, including `host-groups.test.ts`. Typecheck passes.
- **Rollback:** it refuses without its confirmation, then returns the catalog to the WP 3.2a state (8b19c20e).
- **Sandbox:**
  - The wrong-md5 control was refused, then the migration was applied (ledger 61). The sandbox equals the branch replay
    (9cebac33), apart from the unrelated `_schema_import_requests` table.
  - At iPhone size, e2e-host saved both test players as "WP33 crew" ("Saved “WP33 crew” with 2 players."), and the group chip
    was selected.
  - Inviting the group gave "Invited 2 players.", and the panel read "2 waiting".
  - Signed in as a listed player, the API returned 0 groups and 0 memberships.
  - "Delete group" removed the list. axe found no WCAG 2.1 A/AA violation in the sheet with groups.
  - Test games, invitations and notifications were removed. No request reached production.
