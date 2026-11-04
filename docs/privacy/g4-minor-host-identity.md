# G4: a minor host's identity is not retrievable by unrelated users

## What was already true (PRIV-2B)

A minor host's public host snapshot is neutral (no name, username or photo). `visible_avatars` returns a non-adult's name only to the person, a verified guardian, people who share a game, chat or team with them, staff dealing with them, accepted followers and administrators/moderators.

## The remaining paths and what this change does

1. **`hosted_games.host_id`** is an account id every signed-in account can read for a youth-inclusive game. It stays (joins, payments and every policy are built on it). An id is harmless only if no open path turns it into a person, so this change closes the open ones and tests the rest (below).
2. **The profile.** A profile set to "members" (or made public by a guardian) is readable by every signed-in account (or everyone): host_id -> profile -> name and photo. Now a host under 18 cannot publish, re-date, re-age or take over a youth-inclusive game while their profile is not private (`MINOR_HOST_PROFILE_VISIBLE`, with an explanation), cannot set their profile to members/public while they have an active youth-inclusive game, and a guardian cannot make the profile public meanwhile. Cancelling or finishing the game releases the restriction. Adults are untouched. Production has no minor-hosted games, so nothing existing is blocked.
3. **A single path for organizer details.** `get_game_organizer(game)` returns the name/photo of an adult host as before, and for a minor host only to the host, a verified guardian, people who may know a minor's name (same rule as `visible_avatars`) and staff; everyone else gets a neutral organizer. It reveals nothing about a game the caller cannot read (private and hidden games, unknown ids) and is not callable by anonymous users. The helper that takes a chosen viewer is service-role only. Client wrapper: `src/lib/game-organizer.ts` (never carries a name for a neutral organizer).

## Pathways tested (test 400, 36 assertions) for a 17-year-old host

Anonymous, signed-in adult stranger, teen stranger (15), under-13 stranger, player in the game, teen player, verified guardian, the host, moderator, administrator, another family's guardian/manager:

- `visible_avatars` names, `get_game_organizer`, the profile table, the game's host snapshot, follow relationships;
- private game and unknown game reveal nothing; an adult host is shown as before;
- Realtime does not carry profiles, reviews or privacy preferences; the organizer function is not callable by anonymous users; the helper is not callable by clients;
- profile-visibility coupling: refused with a members-visible profile, accepted once private, members/public refused while the game is active, guardian public profile refused, released on cancellation; adult with a public profile unaffected.
  Reviews about minors are protected by PRIV-1 (#245, its own test 310); the PRIV-1 migration is a separate pull request and is not in this branch's replay.

## Notification, search and Realtime

- Notifications written by the database for games carry the game's title and sport, not the host's name (PRIV-2D); the invitation notification carries only the area. Realtime delivers `hosted_games` rows (neutral snapshot plus the opaque host_id), `join_requests` and `game_participants` only to rows the viewer can read.
- Search and listing pages read the neutral snapshot or `visible_avatars`. **Not changed here:** a 17-year-old's player-availability post is readable by a signed-in stranger (it carries the same user id, sports, radius and note, not the name). It is a deliberate discovery feature of a different surface; it is listed as a follow-up decision in the gap register.

## Compatibility and recovery

New triggers can refuse a minor's publish; the message names the fix. Old clients see the error text (publish fails with the message). New client on the old database: `get_game_organizer` does not exist; the wrapper returns null. Recovery: fix forward in a new migration; the profile-privacy requirement can be relaxed only by dropping `yy_minor_host_profile_private_trg`/`yy_keep_minor_host_profile_private_trg` with the owner's approval; nothing restores a name into a public column.

## Residual

`host_id` remains an opaque id in public rows (an opaque per-game reference would need a larger change to payments and policies). Availability posts (above). A minor who is also a participant in a shared game is visible to those participants by the existing rule. Backups hold earlier public rows.
