# WP 2.0: game invitations the server stands behind

Status: **implemented on branch `claude/lucid-franklin-bxb02r`, tested on a scratch database. Not merged, not published, not applied
to production.** Migration `supabase/migrations/20261119100000_game_invites.sql`; test `supabase/tests/880_game_invites.test.sql`
(68 assertions); rollback `docs/rollbacks/20261119100000_game_invites.down.sql`.

First work package of Phase 2 (player-to-game matching). Owner decisions, 2026-11-18: accepting an invitation counts as the host's
approval; a pending invitation lets the invitee open that one private game.

## What was wrong

An invitation was a row in `availability_contact_requests` with `kind = 'invite'`. The server checked only that `game_id` was not
empty:

- anyone who could see a player's post could "invite" them to someone else's game, or to a game that does not exist;
- the title, time and place the player saw (`game_title`, `game_starts_at`, `game_location`, the message header) and the
  notification were whatever the sender's app sent;
- the recipient could rewrite those fields afterwards;
- accepting only flipped a status. The player then sent an ordinary request the host had to approve again;
- an invited player could not open a private game.

## What it changes

| Path                         | Before                                                             | After                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inviting                     | client insert, `game_id` free text                                 | `game_invite_player` / `game_invite_players` (up to 30): the caller must host the game; the game must be upcoming, listed, open to joins, before its cutoff and have a free place; the player must not already have a place                                                                                                                     |
| Who can be invited           | anyone whose post the sender could see, subject to `allow_invites` | the same post-visibility rule (blocks either way, suspended accounts, minors and unknown ages), `allow_invites`, the messaging rules for minors, a guardian's permission for games, and the game's age range; every refusal about the player is one neutral `INVITE_NOT_AVAILABLE`                                                              |
| Limits                       | none                                                               | one pending invitation per player and game (a repeat returns it); 50 pending per game; 100 a day per host; not again within 7 days of a decline                                                                                                                                                                                                 |
| Notification                 | written by the sender's app                                        | written by the database from the real game (title, sport, time in the game's timezone), linking to `/games/<id>?invite=1&from=<host>&inv=<invitation>&exp=<start>`; a minor's guardians are told                                                                                                                                                |
| Accepting                    | status flip                                                        | `game_respond_invite`: creates the place request if there is none (every insert check applies: declared age, a guardian's permission, the host's blocks) and approves it; roster, payment and per-game guardian approval follow as for any approved player. A game that closed marks it expired; a full one leaves it pending. The host is told |
| Private games                | invisible to the invitee                                           | readable by the invitee while the invitation is pending or accepted                                                                                                                                                                                                                                                                             |
| Old path (`kind = 'invite'`) | any `game_id`, details as sent, editable                           | must name an open game the sender hosts; details copied from the game; message and details fixed after insert                                                                                                                                                                                                                                   |

App: "Send invite" on the Players tab calls `game_invite_player` and shows the invitation's own status with "Withdraw"; the game page
shows Accept and Decline when opened from the invitation; My availability lists pending game invitations; Home's Invitations count
includes them.

## Checked on the sandbox

Applied to `qkukefvzwlyusvspablz` by the ledger route (md5 37c02c55, ledger 55). Leaving out one out-of-repo read rule on
`reputation_insights` that is on the sandbox only (migration `20261118021038`, not in the repository or in production), the sandbox
equals a local replay of the branch (a14ff623, 3360 objects).

At iPhone size with the test accounts, production host blocked (0 attempted): the host invited the player to two games from the
Players tab (reopening the dialog showed "Invite pending" with Withdraw); the player's notifications named the real games and
times; opening one showed Accept and Decline on the game page, and accepting put the player on the roster ("You're approved",
request approved "Invited by the host"); the other was declined from My availability; the host was told of the acceptance. The test
games, post, invitations and notifications were removed afterwards.

## Not in this package

- Bulk invite UI and the host's invited list on the game page (WP 2.1; the server side, `game_invite_players` and the host's read
  of `game_invites`, is here).
- Push notifications for invitations (in-app only, like the WP 1.2 reminders).
- `can_notify`: once any contact request exists between two people, the sender's app can still write arbitrary notifications to the
  other through `createNotificationForUser`. The app no longer does this for invitations; closing the channel is a separate change.
