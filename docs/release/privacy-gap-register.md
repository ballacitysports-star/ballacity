# Privacy gap register (youth safety release)

Status date: 2026-11-04. Audited on `main` (`153f6009` or later) combined with the open pull requests #245, #247, #248, #249 and #256 (#253 merged on 2026-11-04), using code reading, a replayed combined database and read-only production catalog queries. Nothing here was changed. The release is **not complete while any "Open" row remains** unless the owner records an explicit acceptance.

Policy this register enforces (owner, 2026-11-04):

- Private youth activities never expose exact locations. A verified, deliberately public event venue may be shown under an explicit public-location policy. Permissions are enforced on the backend, including text, media metadata, notifications and search.
- A minor host's personal account identifiers and identifying snapshots are hidden from unrelated users. Permitted organizer information comes through restricted backend access.
- Precise youth-game locations never enter general-purpose client caches; legacy caches are purged on update, account switch and logout. Rollback never restores exact locations into public columns. Residual copies (backups, offline devices) are documented with retention and mitigations.
- Invitations hold only coarse location. Eligibility, approval, revocation and payment rules are verified.

## Closed by open pull requests (pending staging rehearsal)

| Path                                                                                                             | Closed by                               | Evidence                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `hosted_games` exact location/coordinates readable by any signed-in account                                      | #247 (+ coarsening step in the runbook) | test 320 (98 assertions); coarsening not yet rehearsed in a real project                                                       |
| Invitations (contact request, message, notification) carrying the exact venue                                    | #256                                    | test 360 (76 assertions) including pending, rejected, approved, revoked, unpaid, payment-pending, verified and refunded states |
| Address or venue typed into a youth game's title, description, neighborhood, rules, equipment, cancellation text | #256                                    | test 360; moderator scan function; heuristic limits below                                                                      |
| Local cache `openrun.hostedGames.v1`/`v2`, avatar cache `v1`/`v2`                                                | #249                                    | unit tests: v1 deleted on first load, v2 coarse only, reset on sign-out and user switch                                        |
| Reminders, passport, guardian activity, MCP output                                                               | #249                                    | unit tests                                                                                                                     |
| Minor host's name via `visible_avatars`; neutral host snapshot                                                   | #248                                    | test 335 (62 assertions)                                                                                                       |

## Open: gaps requiring implementation

Severity: **High** = an unauthorized account can read a private location or identity today. **Medium** = needs work before the release counts as complete. **Low** = defence in depth or documentation.

### G1 (High). Team posts expose exact venues to anonymous visitors

- Fact: policy `team_posts_public_read` is granted to `public` (anonymous included) and `anon` has table-level SELECT on `team_posts`. Every non-hidden post of a non-hidden team exposes `location`, `formatted_address`, `lat`, `lng` and `place_id`. `teams.age_groups` can be `youth`, and the anonymous-read test asserts that a youth team's tryouts are deliberately public. There is no per-post visibility, no coarse form, no private table, no public-venue policy, and no text guard on title, body or location.
- Required policy: private youth activities show no exact location; a verified public venue may be shown under an explicit policy.
- Proposed implementation (a new migration + small app change, to be reviewed before any production use):
  1. `team_posts.location_visibility` (`'private'` | `'public_venue'`), default `'private'` for teams whose `age_groups` include `youth` or that have any minor member; `'public_venue'` is set only through a moderator/owner-approved function that records who verified the venue and when (`venue_verified_by`, `venue_verified_at`) and refuses unless the post is for a recognized public facility (organization listing or verified venue).
  2. A private table `team_post_private` (exact location, coordinates, place id) with RLS for the author, team managers, team members and verified guardians of members; a BEFORE trigger writes the exact copy and stores the coarse form (city/area, 2-decimal coordinates) in the public columns for `'private'` posts.
  3. Reuse `private_sec.text_discloses_location` for title, body and location of `'private'` posts.
  4. Tests for anonymous, signed-in stranger, member, guardian of a member, manager, moderator and administrator; event notifications and tryout alerts built from the coarse form; sitemap and search read only public columns.
- Open decision for the owner: whether youth-team tryouts keep their precise venue public as a deliberate product choice (then each needs the explicit policy and verification above) or default to private.

### G2 (High). Youth teams' facility addresses are readable by every signed-in account

- Fact: `teams.home_court`, `venues`, `venue_addresses`, `primary_venue`, `venue_geo` and `availability_slots` have column privileges for `authenticated` (not `anon`); the signed-in read policy shows any non-hidden team. For a youth team these are practice venues.
- Proposed implementation: revoke those columns from `authenticated` and expose them through a function that returns them only to managers, members, verified guardians of members and (for verified public facilities) everyone; keep a coarse `city` public. Tests as in G1.
- Decision needed: which teams count as "youth" (`age_groups` contains `youth`, or any minor member).

### G3 (Medium). Image metadata (EXIF/GPS) is not stripped on the server

- Fact: uploads to `game-covers`, avatars, covers and team/org images go through `finalizeImageUpload`, which re-validates type/size and safety-scans but does not re-encode or strip metadata. The only re-encoding is the message-attachment compressor, which touches JPEG/PNG over 300 KB; smaller files are sent unchanged. Child reel clips have a separate client-side location-removal step. The `ballacity-originals` IndexedDB cache keeps original images on the device.
- Proposed implementation: re-encode in `finalizeImageUpload` (drop all metadata) for every bucket, and strip on the message path regardless of size; tests with GPS-EXIF fixtures (`scripts/generate-exif-fixtures.py` exists); document the device cache and clear it on sign-out.

### G4 (Medium). No restricted organizer-information path for minor hosts; `host_id` is public

- Fact: `hosted_games.host_id` (the account id of the host) is readable by any signed-in account for youth games. #248 neutralizes the host snapshot and hides the name via `visible_avatars`, but there is no function that gives a participant, guardian or moderator the permitted organizer information, and the id itself identifies the account.
- Proposed implementation: the per-game `host_ref` design (option B in the earlier proposal): a stable opaque reference replaces `host_id` in public reads for non-adult hosts; `get_game_organizer(game_id)` (restricted, definer) returns the permitted details to the host, roster members with settled participation, their verified guardians, organization admins and moderators; everyone else gets the neutral snapshot.
- Test coverage today: test 335 covers anonymous, signed-in stranger, teen mate, payer, guardian, other guardian, organization admin, host and an administrator. **Not covered: a moderator role and a roster participant for the identity rules.** Add both, and re-run the identity tests through the API in staging.

### G5 (Medium). Client caches: residual and structural gaps

- Closed by #249: hosted-games and avatar caches (v1 deleted, v2 coarse), reset on sign-out and user switch.
- Gaps: (a) no generic "cache epoch" that purges unknown legacy keys on application update (each new version must remember to list the old key); (b) the `ballacity-originals` IndexedDB cache is not in the reset list; (c) push notifications and browser history already delivered before the update cannot be recalled.
- Proposed implementation: a versioned client-storage manifest that deletes every key not in the current manifest on update, sign-out and user switch; add the originals cache to the reset; unit tests; staging check on a device holding the old build's data.

### G6 (Medium). Free-text detection is a heuristic

- The detector (#256) refuses addresses, map links, coordinates, units and the venue name; it cannot see paraphrases. Mitigation in place: `list_youth_games_with_location_text()` for moderators, existing hide tools. Needed: a user-facing report path on game pages for "this reveals a location", a moderation runbook, and a periodic scan (V6 in the runbook).

### G7 (Low). Messages between users

- A person telling another a place is a conversation, governed by the messaging rules. Recorded as accepted by design; the owner confirms.

## Residual data and retention (documented, not removable)

| Where                                                    | What                                            | Retention / mitigation                                                                                                                                                                                                                                                                |
| -------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database backups and point-in-time recovery              | exact venues copied before coarsening           | held until they age out per the Supabase plan setting (check Database, Backups, and record the window); access limited to the owner; **never restore a backup into production**; if a restore is ever needed, restore to an isolated project and copy only `hosted_game_private` rows |
| `hosted_game_private`                                    | the only exact record after coarsening          | RLS-limited; logical dump to restricted storage before activation, kept only as long as the rollback window, then deleted                                                                                                                                                             |
| Devices that loaded the old build                        | `openrun.hostedGames.v1` and earlier page state | cannot be recalled remotely; deleted on the first load of the new build, on sign-out and on user switch; offline devices keep it until they next open the app                                                                                                                         |
| Push notifications and browser history already delivered | venue text from before the change               | cannot be recalled; new notifications carry the coarse form only                                                                                                                                                                                                                      |
| Logs                                                     | request/response logs may contain venue text    | confirm log retention in the hosting and Supabase settings and record it                                                                                                                                                                                                              |

Rollback rule (unchanged): no procedure restores an exact location to a public column; recovery is by fixing forward, and the coarsening switch cannot be turned off once on.
