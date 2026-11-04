# R1: a minor host's account identifier

Status: **implemented locally, open in a pull request (stacked on G4). Not merged, not applied to production, not verified in production.**

## Question

Can an unrelated account retrieve or correlate a minor host's account id through game queries, profile lookups, the Supabase API, Realtime, search, notifications, invitations or cached records?

## Findings (replayed combined schema, read-only production fingerprints)

- **Retrieve:** yes, by design. `hosted_games.host_id` is part of the public row for a youth-inclusive game, over the API, Realtime and search. Ownership, payments, joins and every policy are built on it, so it is not removed.
- **Turn the id into a person:** closed before this change: names/photos (`visible_avatars`, PRIV-2B), profile (private while hosting, G4), organizer details (`get_game_organizer`, G4), reviews (PRIV-1), invitations and notifications (coarse, no host name; PRIV-2D), caches (PRIV-2C).
- **Correlate the id with other facts (revision 2, after an adversarial pass with realistic fixtures):** five paths remained; the first review missed three because its fixtures were not visible to strangers (a post that was still pending moderation, a reel that was not completed). Corrected here.
  1. team rosters: a 16-17 year old's `team_members` rows were visible to every signed-in account;
  2. `skill_ratings` were readable by everyone, anonymous included;
  3. team posts: a 16-17 year old's non-announcement post is public and carries `author_id`, anonymous visitors included;
  4. reels: a 16-17 year old's completed reel has the audience "members", i.e. every signed-in account, and carries `user_id`;
  5. team ownership: `teams.owner_id` is readable by every signed-in account, so a minor who owns a team is linked to its name.
     Availability posts carried the same id and a schedule: **R2** (#265).
- Checked and found already safe by test 410: comments by the author, follows (profile visibility, which hosting forces private), skill votes (voter only), stats and trait functions (refuse non-adults), `profile_ages`. Reviews about or by minors depend on PRIV-1 (#245): without #245 merged a minor's reviews are not covered.

## Change (migration `20261106110000_minor_host_correlation.sql`)

`private_sec.minor_host_hidden(user)`: true when the person is not a confirmed adult, has an active youth-inclusive game, and the caller is neither them nor someone allowed to know a minor's name (guardians, people sharing a game, chat or team, staff dealing with them, accepted followers, moderators, administrators). Used by `roster_row_visible` (16-17 branch only), the `skill_ratings` read policy, a restrictive `team_posts` policy on the author, and `reel_publicly_visible` (the "members" audience). Team ownership cannot be hidden per row, so a minor cannot be both organizer of an active youth-inclusive game and owner of a visible team (`MINOR_HOST_TEAM_OWNER`, either order, with instructions: ask an adult to own it, hide it, or finish the game). Everyone else, and the same person after the game ends, is unchanged. No data is rewritten. The definitions this replaces (`roster_row_visible`, `reel_publicly_visible`, the `skill_ratings` policy and the `team_posts` policy set) match production (fingerprints compared read-only).

## Tests

`supabase/tests/410_minor_host_id_correlation.test.sql` (59 assertions): anonymous, adult stranger, teen stranger, host, guardian, teammate, manager, player, follower, moderator, administrator; an adult host and a non-hosting teen are unchanged; restriction ends when the game is cancelled; the id still carries ownership and gives no name. Without the migration it fails.

## Exploitability and trade-offs (documented before any risk is accepted)

- **Today in production (read-only aggregates, 2026-11-04):** 0 games hosted by anyone under 18, 0 teams owned and 0 team posts by non-adults, 2 non-adult profiles in total, 1 reel by a non-adult. The correlations are therefore not exploitable now; they become exploitable the day minor hosting is activated, which is why the restriction is tied to an active youth-inclusive game.
- **How an attacker would use it:** read a youth game (public), take `host_id`, then list `team_members`, `team_posts`, `highlight_reels`, `skill_ratings` and `teams.owner_id` for that id to learn the host's team, sports, level, video and any team they own. A team or school name plus a 16-17 year old's schedule narrows to a person.
- **What it costs legitimate users:** while a 16-17 year old hosts, strangers do not see their team in rosters, their recaps, their reel or their rating; teammates, guardians, participants, staff and followers do. A minor host cannot own a visible team at the same time. Everything returns when the game ends.
- **What is not closed:** `host_id` stays in the game row (a pattern: the same opaque id on several games); reviews about or by a minor depend on #245; free text the minor writes. An opaque per-game reference would remove the pattern but changes payments and policies; it is not proposed unless the owner wants it.

## Rollout, compatibility, recovery

Additive plus replaced definitions that only reduce what unrelated viewers can read. Older apps see fewer rows for such hosts. Forward-only recovery. Needs G4 (#263) and PRIV-2B.

## Second review round (independent reviewer, 2026-11-05) and what changed

- **Comments and reactions** by the minor host (on adult content) carried `author_id` and were public wherever the content was; the first fixture used a comment on the minor's own post, so it passed vacuously. A restrictive policy now hides them from unrelated viewers (and Realtime, which uses the same policies).
- **The protection lapsed when the game ended** (or was never marked completed) although the game row, and the id in it, stay readable. The status is now permanent for a person who is not a confirmed adult: after hosting a youth-inclusive game, the roster, rating, post, comment and reel restrictions, the private-profile rule (G4) and the team-ownership guard apply until they are a confirmed adult. **Cost:** a teen who hosted once keeps a private profile and cannot own a visible team until 18; their teammates, guardians, participants and staff are unaffected. This replaces the earlier "restriction ends with the game" behaviour and the matching assertions in tests 400 and 410.
- **Reported against earlier work and fixed in SEC-1 (see `sec1-stack-hardening.md`):** a stranger could make themselves "related" with an unaccepted team invitation or an organization membership they created alone; this opened every restriction above. Without SEC-1 these protections can be bypassed.
- **Open (documented, not fixed here):** public helper functions (`is_team_member`, `is_game_participant`, `team_role_of`, `is_team_manager`, `shares_team`, `is_guardian_of`, `blocks_exist_between`, `is_minor`) answer for any user id and bypass the roster hiding (an unrelated adult can ask "which teams is this id on?"). Closing them needs an internal/external split of the helpers used by many policies and triggers; see the register.
