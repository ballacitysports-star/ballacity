# Legacy data procedures (prepared; sandbox only; never run against production)

Status: **procedures written and exercised in an isolated local replay. Not run in a Supabase sandbox (not yet verified by the owner). Not run against production.** Each production run needs its own written approval, after the sandbox rehearsal is recorded.

## Rules that apply to all four

1. **Nothing is ever restored to a public field.** Every procedure either removes a precise value, replaces it with a coarse one, or moves it to a private, access-controlled table. No procedure writes an exact location, coordinate, address or metadata value into `hosted_games`, `team_posts`, `teams`, `player_availabilities`, a public storage bucket or any column an unrelated account can read. There is no "undo": recovery is to fix forward.
2. **Counts only.** Reports, logs and audit rows hold counts and ids, never addresses, coordinates or image metadata values.
3. **Small, resumable batches** (default 200, maximum 5000), each returning the number of rows changed; run until 0. Every procedure is idempotent and safe to stop between batches.
4. **Order:** database migrations first (switch OFF), application next, adoption window, then these procedures. Backups and point-in-time recovery keep pre-change values until they age out; record the retention window and never restore a backup into production (runbook section 8, residual data table).
5. **Stop conditions:** any unexpected non-zero count in a verification query, any error from a batch, any write to a public column from outside the procedure, or any sign the app build in use is older than PRIV-2C. Stop, record, and ask.

## P1. Existing minors' availability posts (R2, #265)

- **Defined:** `private_sec.blank_minor_availability_location(limit)` (service role): removes stored coordinates, street address and place id from posts of non-adult or unknown-age authors; keeps the city; audit row with counts only. `list_minor_availability_notes_with_location_text()` and `moderator_scrub_availability_note(post, reason)` (moderators): find and remove notes that name a place (heuristic detector; ids and reason only).
- **Why it is safe:** the posts are already unreadable to unrelated accounts after the R2 migration; blanking only removes residue (including from backups' future copies). A trigger prevents any precise value from returning to such a row; the trigger checks a note only when it changes, so an old note never blocks the run.
- **Before (read-only, production or sandbox):** `select count(*) filter (where lat is not null or formatted_address is not null or place_id is not null) as with_precise, count(*) as total from public.player_availabilities a where coalesce(public.age_cohort_of(a.user_id),'unknown') <> 'adult';`
- **Run:** repeat `select private_sec.blank_minor_availability_location(500);` until 0; then the moderator scan for notes.
- **Verify:** the same query returns `with_precise = 0`; the R2 read-policy checks (staging checklist ST-6) still pass; adult posts unchanged (compare adult counts before and after).
- **Tested:** `supabase/tests/420_minor_availability_privacy.test.sql` (batches of 1 and many, idempotence, adult untouched, city kept, audit counts, the owner cannot re-add a precise value, moderator scan and scrub, grants).

## P2. Existing private youth-game locations (PRIV-2A, #247, with #256)

- **Defined:** the guarded one-way switch `app_settings['youth_location_privacy']` and `coarsen_existing_youth_games(limit)`; the private copy in `hosted_game_private` is written by the migration and by the app dual-write; activation is refused without the adoption flag, the typed confirmation, and a private copy for every affected row.
- **What changes:** public columns of youth-inclusive games become the neighborhood label and 2-decimal coordinates; the exact value remains only in `hosted_game_private` (row security: host, rostered players with a settled fee, their guardians, managers). Adult-only games are untouched.
- **Run:** exactly runbook section 8 steps 1 to 5 (prerequisites, adoption window of at least 7 days, activation, batches to 0, completion queries V1 to V7). Sandbox rehearsal is S9.
- **Never:** turn the switch off (refused with `COARSENING_IRREVERSIBLE`), roll back the app below PRIV-2C after activation, or copy `hosted_game_private` rows into public columns.
- **Tested:** `supabase/tests/320_youth_game_location.test.sql` and `360_youth_location_text_and_invites.test.sql`, plus the V1 to V7 dry runs recorded in runbook section 12.

## P3. Youth team posts and team facilities (G1 #259, G2 #260)

- **Defined:** `coarsen_existing_youth_team_posts(limit)` and `coarsen_existing_youth_team_facilities(limit)`; exact values live in `team_post_private` and `team_facility_private` (row security: author, managers, members, verified guardians of members); the shared switch's guards also refuse activation while any affected post or team lacks its private copy. Public venues stay public only through the moderator verification function, which records who verified and when.
- **Run:** in the same activation window as P2, after the same adoption flag; batches to 0; verify with the queries in `docs/privacy/g1-team-post-location.md` and `g2-team-facility.md` (public columns hold only the city or are empty for youth teams).
- **Tested:** `370_team_post_location_privacy.test.sql`, `380_team_facility_privacy.test.sql`.

## P4. Historical image metadata (G3 #258, G3b #268)

- **Inventory (read-only, 2026-11-04):** 32 image objects in the public and game-cover buckets, all with moderation records; message-attachment objects are in a private bucket. Whether any carries GPS/EXIF/XMP is answered only by the assessment.
- **Defined:** `superadminScanImageMetadata` (read-only: counts and bucket/path of images with metadata, never values); `superadminStripStoredImages` (rewrites named images without the tags; **dry run by default**; verifies the rewritten file still decodes with the same dimensions; audited); the stripper never changes the picture or its orientation.
- **Sandbox rehearsal:** load GPS/EXIF/XMP fixtures (`scripts/generate-exif-fixtures.py`) in every public bucket and the game-cover bucket; run the assessment; run the strip with `dryRun` and then for real; assert counts drop to zero, dimensions are unchanged, images render, and the CDN no longer serves the original after replacement (ST-8.5). Never rehearse on production objects.
- **Production (separate approval):** assessment first; with 32 objects a reviewed rewrite is small. Take no copy of the originals (they carry the sensitive data); rely on platform backups for recovery of a corrupted image and record their window. Batches of at most 50, every batch audited.
- **After:** the weekly read-only sweep in `docs/privacy/g3b-image-staging.md` stays at zero; the old direct-upload policies are closed only by the separately approved phase 2 migration.
- **Tested:** `src/lib/image-metadata*.test.ts`, `image-promotion.server.test.ts`, `image-upload.test.ts`, SQL test 440.

## Evidence still needed before any production run

Sandbox verified by the owner; S0 to S11 recorded; P1 and P4 rehearsed there; read-only counts taken on production immediately before each run; the owner's written approval naming the procedure and the batch size.
