# WP 3.0: who a game is hosted as

Status: **on branch `claude/lucid-franklin-bxb02r`, tested on scratch databases and applied to the sandbox. Not merged, not
published, not applied to production.** Migration `supabase/migrations/20261121100000_game_host_affiliation.sql` (md5 05468a00);
test `supabase/tests/920_game_host_affiliation.test.sql` (25 assertions); rollback
`docs/rollbacks/20261121100000_game_host_affiliation.down.sql`.

First work package of Phase 3. Owner decision, 2026-11-19: adults may host as themselves, without a team; 16-17-year-olds keep
hosting under a team; under-16s still cannot host.

## What was wrong

- A game is written by the host's app. The server checked only that the host was the caller and old enough to host. It did not
  check the team a game is published under: any member could put any team's id on their game, and with it that team's name,
  avatar and verified badge on the game page.
- The create page said games are always published under a team the account owns, but the server accepted a game with no team
  from anyone allowed to host, 16-17-year-olds included.
- An adult without a team had to create a team profile before hosting a pickup game.

## What it changes

| Who                                    | Before (server)        | After (server)                                                       |
| -------------------------------------- | ---------------------- | -------------------------------------------------------------------- |
| Adult, no team                         | accepted (app refused) | accepted; the app offers "Host as: You"                              |
| 16-17, no team                         | accepted (app refused) | refused: "Only adults can host a game without a team profile."       |
| Owner, manager or coach of the team    | accepted               | accepted                                                             |
| Captain or player of the team, or none | accepted               | refused: "You can only host under a team profile you own or manage." |
| Under 16, or age unknown               | refused (as before)    | refused (as before)                                                  |

- On an existing game, the server checks only when its team changes. Editing anything else is unaffected, including games
  written before this rule.
- Deleting a team still works. Its games stay, without the team, through the foreign key, even when a 16-17-year-old manager
  hosts them.
- The server's own writes (service role, jobs) are not limited by the rule.

**Create page** (`src/lib/host-affiliations.ts`, 7 unit tests):

- An adult sees themselves first under "Host as", then the teams they own. With no team, "You" is selected automatically, so
  the "Host as a team" page no longer appears for adults.
- If the app is acting as the person, "You" is selected. If it is acting as a team, that team is selected.
- A 16-17-year-old without a team still sees the "Host as a team" page, now worded "Under 18, games are published under a team
  profile".
- A game hosted as oneself is saved without a team. The game page shows the person ("About <name>"), as it already did for a
  game without a team.

## Checked

- **Test 920:** 25/25. Without the migration it fails in exactly the seven places the rule adds:
  - a 16-17-year-old hosting without a team;
  - a game on another member's team;
  - a captain hosting under the team;
  - a player hosting under the team;
  - moving a game to a team the host doesn't manage;
  - taking the team off a 16-17-year-old's game;
  - the count of games written.
- **Full suites:** SQL 2858 passed, 0 failed. Unit 4360 passed, 0 failed.
- **Rehearsal:**
  - A local replay of the branch gives fingerprint 0ba704e5 (3379 objects).
  - The rollback refuses without its confirmation, then returns the catalog to 82436982. That is production after batch 15.
- **Sandbox:**
  - The wrong-md5 control was refused.
  - The migration is applied as ledger 58. The sandbox equals the branch replay, apart from the unrelated
    `_schema_import_requests` table.
  - At iPhone size, as e2e-host (an adult with no team), the create page showed "Host as: E2E Host · You, Auto-selected". The
    game published ("Game published") and was stored with no team. Its page showed "About E2E Host".
  - Through the API, moving that game onto a temporary team owned by another account was refused: 403, "You can only host under
    a team profile you own or manage." (`GAME_TEAM_NOT_MANAGED`).
  - The game and the team were removed afterwards. No request reached production.
