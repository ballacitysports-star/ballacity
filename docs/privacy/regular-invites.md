# WP 3.2a: re-inviting regulars

Status: **on branch `claude/lucid-franklin-bxb02r`, tested on scratch databases and applied to the sandbox. Not merged, not
published, not applied to production.** Migration `supabase/migrations/20261123100000_regular_invites.sql` (md5 b8e9d771);
test `supabase/tests/940_regular_invites.test.sql` (28 assertions); rollback
`docs/rollbacks/20261123100000_regular_invites.down.sql`.

Owner decision, 2026-11-19: a host may re-invite people who played in their games in the last 90 days, without an availability
post. Blocks, the player's invitation setting, the minor and guardian rules and the game's age range still apply, and players can
turn this off.

## What was wrong

Since WP 2.0 a host could invite a player only through one of the player's open availability posts. The people who had already
played in the host's games, the obvious first call for next week's run, could not be invited unless they had posted.

## What it changes

- **Who counts as a regular** (`private_sec.regular_invitable`): the player held a place in a game this host hosted that took
  place in the last 90 days and was not cancelled. They must also be:
  - an adult;
  - not suspended;
  - not blocked by the host, nor blocking them;
  - not opted out.

  Minors keep the post-based path and its guardian rules.

- **Inviting** (`game_invite_player`, and the bulk version that calls it):
  - When no post is named and none is visible, a regular may be invited.
  - Everything else applies as before: the host owns an open game with room, the player's "Who can invite you to games"
    setting, the minor messaging rules, the game's age range, the 7-day cool-down after a decline and the limits.
  - Every refusal is the same neutral "can't be invited", and the notification is written as before.
- **The player's choice:** a new privacy setting, "Hosts you've played with can invite you again" (`allow_regular_invites`, on
  by default). It is under Privacy settings next to "Who can invite you to games", and it is included in the data export.
- **The host's list** (`my_regular_players`, host of the game only): up to 50 regulars, most recent first. Each shows how many
  games they played together, when they last played, and where they stand for this game:
  - in the game;
  - invited;
  - accepted;
  - declined this week;
  - available.

  Blocked, suspended, opted-out and underage players are not listed.

- **Game page:** next to "Invite nearby", the host now has "Invite regulars". It opens a sheet with the same picker, note and
  limit of 30, so hosts can invite regulars even for a game without a mapped address. Both sheets now share one component.

## Release order

The migration must be applied **before** the publish. The privacy screen saves the whole settings row, and the data export reads
the new column, so the new app would fail to save privacy settings or export data until the column exists. The old app keeps
working with the migration applied: the column has a default, and the old app never names it.

## Checked

- **Test 940:** 28/28. It covers:
  - inviting a regular without a post, with no post recorded and the notification sent;
  - refusals for:
    - a stranger;
    - a player whose last game was 120 days ago;
    - a cancelled game only;
    - a 17-year-old;
    - opted out (and invitable again after opting back in);
    - blocked;
    - suspended;
    - invitations set to nobody;
    - outside the age range;
    - already in the game;
    - another host;
  - the post path still working;
  - nobody changing another member's setting;
  - the host's list and its statuses, and that only the host sees it;
  - bulk invitations following the same rule.
- **Negative control:** without the migration, a regular with no post is refused (`INVITE_NOT_AVAILABLE`); with it, they are
  invited.
- **Full suites:** SQL 2936 passed, 0 failed. Unit 4366 passed, 0 failed, including new tests for the regulars' states and labels.
  Typecheck, build, format, lint ratchet, policy gate and rules-of-hooks all pass.
- **Rollback:** it restores `game_invite_player` exactly as WP 2.0 wrote it and drops the new functions and the column. Rehearsed:
  it refuses without its confirmation, then returns the catalog to production's current state (89880df3).
- **Sandbox:** the wrong-md5 control was refused, then the migration was applied (ledger 60). The sandbox equals the branch replay
  (8b19c20e), apart from the unrelated `_schema_import_requests` table. At iPhone size:
  - e2e-host had a game last week with e2e-player in it. e2e-player had no availability post.
  - "Invite regulars" listed "E2E Player · 1 game with you · last Nov 13". axe found no WCAG 2.1 A/AA violation in the sheet.
  - Inviting gave "Invited 1 player.", and the panel read "1 waiting". The invitation names no post, and the player was notified.
  - The player turned "Hosts you've played with can invite you again" off in Privacy settings, and it was stored.
  - Test games, invitations and notifications were removed, and the setting was restored. No request reached production.
