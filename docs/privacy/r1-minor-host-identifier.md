# R1: a minor host's account identifier

Status: **implemented locally, open in a pull request (stacked on G4). Not merged, not applied to production, not verified in production.**

## Question

Can an unrelated account retrieve or correlate a minor host's account id through game queries, profile lookups, the Supabase API, Realtime, search, notifications, invitations or cached records?

## Findings (replayed combined schema, read-only production fingerprints)

- **Retrieve:** yes, by design. `hosted_games.host_id` is part of the public row for a youth-inclusive game, over the API, Realtime and search. Ownership, payments, joins and every policy are built on it, so it is not removed.
- **Turn the id into a person:** closed before this change: names/photos (`visible_avatars`, PRIV-2B), profile (private while hosting, G4), organizer details (`get_game_organizer`, G4), reviews (PRIV-1), invitations and notifications (coarse, no host name; PRIV-2D), caches (PRIV-2C).
- **Correlate the id with other facts:** two paths remained (this change closes them), and one is handled by R2:
  1. team rosters: a 16-17 year old's `team_members` rows were visible to every signed-in account;
  2. `skill_ratings` were readable by everyone, anonymous included;
  3. availability posts carried the same id and a schedule: **R2** (#265).
- Checked and found already safe by test 410: team posts by the author, reels, skill votes, follows, stats and trait functions (they refuse non-adults), `profile_ages` (only when the profile is public or members-visible, which hosting prevents).

## Change (migration `20261106110000_minor_host_correlation.sql`)

`private_sec.minor_host_hidden(user)`: true when the person is not a confirmed adult, has an active youth-inclusive game, and the caller is neither them nor someone allowed to know a minor's name (guardians, people sharing a game, chat or team, staff dealing with them, accepted followers, moderators, administrators). Used by `roster_row_visible` (16-17 branch only) and the `skill_ratings` read policy. Everyone else, and the same person after the game ends, is unchanged. No data is rewritten. The two definitions this replaces match production (fingerprints compared read-only).

## Tests

`supabase/tests/410_minor_host_id_correlation.test.sql` (39 assertions): anonymous, adult stranger, teen stranger, host, guardian, teammate, manager, player, follower, moderator, administrator; an adult host and a non-hosting teen are unchanged; restriction ends when the game is cancelled; the id still carries ownership and gives no name. Without the migration it fails (6 failures).

## Residual (accepted until the owner decides otherwise)

`host_id` remains in public rows. A stranger can still see that the same opaque id hosts several games (a pattern, not a name). Replacing it with a per-game opaque reference would change payments and policies and is not proposed here.

## Rollout, compatibility, recovery

Additive. Older apps see fewer roster rows for such hosts. Forward-only recovery. Needs G4 (#263) and PRIV-2B.
