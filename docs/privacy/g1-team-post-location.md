# G1: the venue of a youth team's private event is not public

## Problem

`team_posts` is readable by anonymous visitors (policy `team_posts_public_read`) and carries `location`, `formatted_address`, `lat`, `lng` and `place_id`. For a youth team these are the practice, tryout and event venues of children.

## Policy implemented

- A post of a youth team (age group `youth`/`teen`, or any member who is not a confirmed adult, or a team that cannot be found) keeps its exact venue in `team_post_private`. With the shared switch on, the public columns hold the team's city and 2-decimal coordinates; the address and place id are removed. Posts without a location (announcements, recaps) and every post of an adult team are untouched.
- **Explicit public-venue policy:** a deliberately public venue (an open day at a school, a public park tryout) is shown publicly only after a moderator verifies it (`verify_team_post_public_venue`). The author may request review (`public_venue_requested`). A trigger reverts any other attempt to set `public_venue`, including a manager's. Changing the location of a verified post removes the verification and re-coarsens it; a moderator can revoke it. Verification is recorded in `team_post_public_venues` (service role only).
- **Who reads the exact venue** (`team_post_private`, policy `team_post_private_read`): the author, the team's managers and members, verified guardians of members, a person registered for the tryout and the person who registered them (a cancelled registration releases nothing), and moderators. Not anonymous visitors, not signed-in strangers of any age. Not in realtime.
- **Text:** title and body of a private youth post cannot carry an address, map link, coordinates, unit or the venue name (the PRIV-2D detector). The venue goes in the location field.
- **Notifications and email:** tryout emails to registered families and roster print-outs read the exact venue for that post with the server client (the recipients are entitled by construction). The parent-invite email and the public tryout listing use the public column, so they carry the coarse form once coarsening is on. `listMyTryoutSignups` and the team events page read the exact venue through the viewer's own session, so the database decides.
- **Search:** public city pages and the sitemap do not read `team_posts`; the public tryout listing reads the public columns (coarse).

## Rollout (shares the one guarded, one-way switch of PRIV-2A)

1. Migration with the switch OFF: adds the private copy, guards and moderator tools. Visible behaviour is unchanged (public columns still exact). Existing posts of affected teams get a private copy.
2. Application with the overlays (this PR).
3. Activation of the shared switch now also requires a private copy for every affected post; then `coarsen_existing_youth_team_posts(n)` until it returns 0.

Old app on the new database: unchanged until activation; after activation a team member on an old build sees the city instead of the venue (no exposure). New app on the old database: the overlay reads a table that does not exist, gets an error, and shows the public value (the same value as before).

## Recovery

No function restores exact values to public columns except a moderator's explicit public-venue verification. A wrong private copy is corrected by the service role (with approval) and the author re-saves; the guard triggers can be fixed forward in a new migration. Rolling back the application before activation is safe; after activation roll back only to a build that includes the overlay.

## Not covered / residual

Post images (`image_url`) can show a venue visually; the G3 metadata strip removes GPS data but not what is in the picture. Events a family already saw or emailed before activation cannot be recalled. A youth team whose age groups are not set and which has no minor member is treated as an adult team. The batch function of PRIV-2A (`coarsen_existing_youth_games`) sets its working flag with a transaction-local setting and does not clear it afterwards; run each batch as its own transaction (the new team-post batch clears it itself).

## Tests

`supabase/tests/370_team_post_location_privacy.test.sql` (75 assertions): youth/adult/unknown/minor-member detection; switch OFF changes nothing visible; activation refused until every affected post has a private copy; batch coarsening and idempotence; anonymous, signed-in adult and teen strangers (coarse only, no private access); author, manager, coach, teen member, under-13 member, verified guardian, moderator, administrator (exact); registered parent and child, cancelled registration, unrelated team; new posts and edits round-trip; unrelated updates; text guard (address, map link, venue name, ordinary text, adult team unrestricted); public-venue policy (request, manager's attempt reverted, moderator-only verify/revoke, record, anonymous sees public venue, moving clears it, revoke re-coarsens); realtime, grants and the one-way switch. Negative control: the file fails without the migration. Unit tests for the overlay helper.
