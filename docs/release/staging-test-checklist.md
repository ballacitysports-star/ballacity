# Staging test checklist (definitive; run only in a verified sandbox)

**Do not start until** the owner has completed `docs/release/sandbox-verification.md` and recorded the verified project reference. Until then: no remote tests, no `E2E_SANDBOX_PROJECT_REF`, no production credentials anywhere in the run. Use synthetic accounts and fixtures only. Record for every row: build id, migration head, tester, date, result, evidence link (screenshot or query output). A row with no evidence is not passed.

Build under test: `staging/priv-rehearsal` (see the register for its composition). Cohorts used throughout: **C** under 13 (managed child), **T1** 13 to 15, **T2** 16 to 17 (with and without a guardian link), **A** adult, **G** guardian, **O** organizer/host, **M** team manager, **MOD** moderator, **ADM** administrator, **S** unrelated signed-in adult, **ANON** signed out.

## 0. Preconditions

| ID     | Check                                                                                                                                       | Pass                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| ST-0.1 | Sandbox reference verified by the owner and different from production (`cpqihhcqeivbgxqbzatv`); no production secret in the environment     | recorded in the run log                   |
| ST-0.2 | Reset the sandbox; apply every migration up to `20261030120000` in timestamp order (supabase and drizzle together); load synthetic fixtures | catalog fingerprint equals a local replay |
| ST-0.3 | Run the previous production build against this state                                                                                        | existing workflows work                   |

## 1. Database migration order and recovery

| ID     | Check                                                                                                              | Pass                                                  |
| ------ | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| ST-1.1 | Apply migrations 0a to 17 (runbook sections 2 and 16) one at a time; after each run the section 3 comparison       | each matches the local replay                         |
| ST-1.2 | Apply nothing out of order; try re-running one migration                                                           | idempotent or refused loudly, never destructive       |
| ST-1.3 | The coarsening switch is OFF after all migrations                                                                  | `app_settings` row absent or false                    |
| ST-1.4 | Old build against the new database; new build against a database missing the last three migrations                 | both usable (fewer posts; upload falls back)          |
| ST-1.5 | Fix-forward drill: wrong private copy corrected by the service role; guard false positive fixed by a new migration | no step restores an exact location to a public column |

## 2. Authentication and guardian accounts

| ID     | Check                                                                                                   | Pass                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ST-2.1 | Sign up, sign in, sign out for A, T2, T1 (date of birth sets the cohort); under-13 cannot self-register | cohort correct; C needs a guardian                                                               |
| ST-2.2 | Guardian links a child, approves consent, sets child controls (default guardian-only)                   | row created; child restricted                                                                    |
| ST-2.3 | Guardian switches to the child profile and back; sign-out                                               | no data from the previous profile visible; storage keys purged (ST-9)                            |
| ST-2.4 | Guardian revokes the link                                                                               | the child's guarded features stop immediately, including messaging inside existing conversations |
| ST-2.5 | Real Auth tokens: `auth.uid()` as expected for every cohort; expired and revoked tokens refused         | yes                                                                                              |

## 3. Youth and adult profiles

| ID     | Check                                                                                                                  | Pass                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| ST-3.1 | S and ANON look up a minor by id: names, photos, profile                                                               | nothing returned (`visible_avatars`, profile policy)      |
| ST-3.2 | A T2 who hosts an active youth game cannot make the profile members/public; a guardian cannot make it public meanwhile | refused with the explanation; released when the game ends |
| ST-3.3 | Adult profile visibility settings unchanged                                                                            | as set                                                    |

## 4. Game creation, joining, exact and coarse location

| ID     | Check                                                                                                                            | Pass              |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| ST-4.1 | Adult creates a youth-inclusive game; address typed in title/description is refused with the explanation                         | refused           |
| ST-4.2 | Minor hosting needs the approval flow; payments follow the minor-host rules                                                      | as designed       |
| ST-4.3 | With the switch OFF: host, rostered player (fee settled), guardian, manager see the exact venue; S and ANON see the coarse label | per cohort matrix |
| ST-4.4 | Pending, denied, waitlisted, revoked, unpaid and refunded participants see only the coarse label                                 | yes               |
| ST-4.5 | Invitations, contact requests and notifications carry only the area                                                              | yes               |
| ST-4.6 | `get_game_organizer`: neutral for S, details for host, guardian, roster, staff                                                   | yes               |
| ST-4.7 | Minor host's id: S cannot read their team row or skill rating while the game is active; both visible again after cancellation    | yes               |

## 5. Team and facility privacy

| ID     | Check                                                                                                               | Pass |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ---- |
| ST-5.1 | Youth team post with a private event: ANON and S see city only; member, guardian of a member, manager see the venue | yes  |
| ST-5.2 | A verified public venue is shown to everyone only after moderator verification                                      | yes  |
| ST-5.3 | Team facility details: S sees nothing but the city; manager, member, guardian see them; clear function works        | yes  |
| ST-5.4 | Text guard on team posts refuses addresses; tryout announcements still work                                         | yes  |

## 6. Player availability

| ID     | Check                                                                                                                             | Pass                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| ST-6.1 | A, T2, T1, C each post availability                                                                                               | stored with city only for non-adults               |
| ST-6.2 | S, ANON, other minors list/search posts                                                                                           | adult posts only                                   |
| ST-6.3 | Guardian, teammate, manager, accepted follower, MOD, ADM view the minor's post                                                    | visible                                            |
| ST-6.4 | Contact request to a minor: from S refused; from teammate allowed only if the guardian's controls allow; adult to adult unchanged | yes                                                |
| ST-6.5 | Realtime subscription to `player_availabilities` as S                                                                             | no minor post delivered, including after an update |

## 7. Messaging

| ID     | Check                                                                        | Pass                                                                      |
| ------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ST-7.1 | S to C, T1, linked T2, unlinked T2                                           | refused except as the documented exceptions E1 to E5 (record which occur) |
| ST-7.2 | Guardian to own child; other family's guardian                               | allowed; refused                                                          |
| ST-7.3 | Change child controls or revoke the guardian inside an existing conversation | next message refused                                                      |
| ST-7.4 | No client can create a conversation or add a participant directly            | refused                                                                   |
| ST-7.5 | Blocks stop messages and requests; attachments only readable by participants | yes                                                                       |

## 8. Media uploads and metadata

| ID     | Check                                                                                                          | Pass                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| ST-8.1 | Upload GPS-EXIF fixtures (`scripts/generate-exif-fixtures.py`) as avatar, cover, team/org image, game cover    | stored public bytes contain no GPS/EXIF/XMP; picture and orientation unchanged                       |
| ST-8.2 | During upload, request the destination URL before finalization completes                                       | nothing exists at the destination (staging)                                                          |
| ST-8.3 | Force a failure at each step (scan fails, publish fails, network drop) and retry; two concurrent finalizations | no unprocessed original in a public bucket; retry succeeds; second call returns the recorded outcome |
| ST-8.4 | 8 MB image and a 4.5 MB image                                                                                  | cleaned and scanned within platform limits                                                           |
| ST-8.5 | Fetch the old URL of an overwritten object through the CDN                                                     | no original served (replaces the unverified local assumption)                                        |
| ST-8.6 | Unsafe-image fixture                                                                                           | stays in the private staging bucket, quarantined, never copied                                       |
| ST-8.7 | Message attachment with GPS                                                                                    | stripped; only participants can fetch                                                                |
| ST-8.8 | Historical media: run the assessment function on the loaded fixtures, then the sandbox rewrite                 | counts drop to zero; images still render                                                             |
| ST-8.9 | Direct upload to a public bucket with the old client path                                                      | still works during the adoption window; the sweep finds objects without a moderation record          |

## 9. Client caches, logout and updates

| ID     | Check                                                                                                          | Pass                                                                                               |
| ------ | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ST-9.1 | Load the old build, then the new build on the same browser                                                     | legacy keys (including `openrun.hostedGames.v1` and the original-image cache) purged on first load |
| ST-9.2 | Sign out; switch user; guardian-child switch                                                                   | all per-user keys and original-image cache cleared                                                 |
| ST-9.3 | Storage scan: no exact venue, address, coordinates or minor's name in local/session storage, IndexedDB, caches | none                                                                                               |

## 10. Reporting and moderation

| ID      | Check                                                                                             | Pass                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ST-10.1 | Report a game with "reveals a private location" from two accounts                                 | text removed, host notified, no copy kept, audit written                                      |
| ST-10.2 | Report a team post and a comment (the UI buttons are not wired yet: use the client helper or API) | reports private; thresholds 1/2/3 hold the item; held item visible to author and manager only |
| ST-10.3 | Moderator decisions, media quarantine, notices                                                    | audited; neutral notices                                                                      |
| ST-10.4 | Appeal by author and by a guardian; review by the same moderator refused; reversal restores       | yes                                                                                           |
| ST-10.5 | Retention purge on fixtures (not on any real data)                                                | escalated items and open appeals untouched                                                    |

## 11. Realtime and API exposure

| ID      | Check                                                                                                                                                                                                                      | Pass                                                                   |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ST-11.1 | Subscribe as each cohort to `hosted_games`, `notifications`, `messages`, `player_availabilities`, `teams`, `highlight_reels`, `post_comments`, and try `hosted_game_private`, `team_post_private`, `team_facility_private` | no private payload to an unentitled subscriber, including `old_record` |
| ST-11.2 | PostgREST as ANON, S, minor, guardian, MOD: every negative in `docs/privacy/*.md` test lists                                                                                                                               | refused or empty                                                       |
| ST-11.3 | `anon` calls to trigger functions, moderator tools, organizer lookup, scan functions                                                                                                                                       | refused                                                                |

## 12. Coarsening and forward recovery (last, irreversible)

| ID      | Check                                                                                                                                                | Pass                                         |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| ST-12.1 | Activation refused without the adoption flag, without the typed confirmation, and with any missing private copy (games, team posts, team facilities) | refused each time                            |
| ST-12.2 | Activate; run the three batch functions to 0; run V1 to V7                                                                                           | V2, V3, V5, V6, V7 = 0                       |
| ST-12.3 | Previous build after activation shows coarse values only; the new build still shows exact values to the entitled                                     | yes                                          |
| ST-12.4 | App rollback to a build older than PRIV-2C after activation                                                                                          | **forbidden**; confirm the procedure says so |
| ST-12.5 | Stale tab after activation; offline device returning                                                                                                 | no exact value reappears in a public column  |

## 13. Browsers and devices

| ID      | Check                                                                                                                                                                                                 | Pass                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| ST-13.1 | Mobile Safari (iOS, real device or the closest emulator) at 390 px: sign-in, create/join game, upload an HEIC-origin photo, report, messaging, sign-out; Safari private mode and storage-blocked mode | works; no raw error codes shown |
| ST-13.2 | Chrome, Firefox, Safari and Edge on desktop at 1280 px: the same flows                                                                                                                                | works                           |
| ST-13.3 | Screenshots of the new screens for owner review                                                                                                                                                       | signed by the owner             |

## 14. Exit

Every row passed with evidence, or an owner-signed exception. Then a separate final release plan is written; each production step still needs its own written approval. This checklist authorizes nothing against production.
