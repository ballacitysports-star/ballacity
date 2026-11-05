# Audit F01–F16 remediation: independent review brief and remaining staging checklist

Branch `claude/audit-review-snapshot`. Its code is the parent of the commit that adds this file
(`811d05d4`), whose tree is byte-identical to `claude/release-integration` at `3dcd4770`. This file is the only
addition. Nothing in it is merged to `main`, deployed, or applied to any Supabase project.

## Part A: brief for the independent (Codex) security review

### What to review

The fixes for the independent audit of 2026-11-04 (findings F01–F16), on top of the privacy-release stack.

| Finding            | PR                                           | Commits (review diff)                          | Files to read first                                                                                                  |
| ------------------ | -------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| F01 seroval        | #286 → `main`                                | `ab974b45`                                     | `package.json` overrides, `bun.lock`, `src/lib/server-fn-deserialization.test.ts`                                    |
| F02, F11, F12, F13 | #287 → `main`                                | `72357fbd`                                     | `supabase/migrations/20261031120000_close_live_write_holes.sql`, `src/lib/reviews.functions.ts`, tests 440, 310, 442 |
| F16                | #288 → `main`                                | `27b0dc48`                                     | `scripts/db-test-target.mjs`, `scripts/db-test.mjs`                                                                  |
| F15                | #289 → `main`                                | `b7d2f72d`                                     | `scripts/migration-versions.test.mjs`, `docs/migration-history-reconciliation.md` §9                                 |
| F03                | #290 → `claude/audit-fix-base`               | `f67ca881` + manifest                          | `supabase/migrations/20261108160000_guardian_approval_validity.sql`, test 545                                        |
| F04                | #291 → #290                                  | `4fdb9f3f`, `04d9eb01` + manifest              | `src/lib/paypal*.ts`, `supabase/migrations/20261108170000_paypal_capture_state.sql`, test 546                        |
| F05, F06           | #292 → #291                                  | `fdc93991` + manifest                          | `src/lib/image-animation.ts`, `supabase/migrations/20261108180000_image_direct_upload_closure.sql`, test 547         |
| F09, F14           | #293 → `claude/audit-fix-base-image-runtime` | `21ef55e4`                                     | `src/lib/image-runtime/*`, `services/image-processor/src/server.ts`, `src/lib/image-uploads.functions.ts`            |
| F10                | (manifest commits)                           | `b04dca94`, `9e493ff1`, `d0b25d9f`, `e6e8f85d` | `docs/release/release-manifest.json`, `scripts/release-preflight.mjs`                                                |

Dependency order: `claude/audit-fix-base` (`b04dca94`) is the integration state before the audit fixes (`3004f6f2`:
the stack #277–#285 plus the final heads of #286–#289), plus test 442 and a PG16/PG17 manifest. #290 → #291 → #292
are stacked in migration-version order, so each tree carries a manifest listing exactly its migrations.
`claude/audit-fix-base-image-runtime` (`ccfb30de`) is that base plus #284. #293 is on top of it.

### Questions the review should answer

1. **F03:** can any path still count a guardian approval whose approver has lost authority, whether by suspension,
   revocation, replacement or hold? Can it be done through an RPC that writes `guardian_approved_by` with
   COALESCE, or through a SECURITY DEFINER caller?
2. **F04:**
   - Can a verified `payment_submissions` row exist without a COMPLETED capture on its order with the same id,
     amount, currency, player and game, whether through a direct insert, an update, the service role or a retry
     race?
   - Can the claim (`capturing`) be lost so that a capture is recorded twice?
3. **F06:**
   - With `image_direct_uploads` closed, is there any write into a public image bucket other than the server's
     promotion? Consider signed upload URLs, `supabase_storage_admin`, moves and copies, and upserts.
   - Can a client read or flip the switch?
4. **F05:** can an animated image pass `isAnimatedImage`, for example APNG chunk ordering, WebP without `VP8X`, or
   truncated files?
5. **F09:**
   - Can any runtime's result reach publication with fewer scan renditions than its pixels need?
   - Is there any path that falls back to another runtime, or to in-process sharp, when one is not configured?
6. **F14:**
   - Can an unauthenticated client hold a processing slot, consume nonces, or make the service buffer a body?
   - Is the response signature still bound to the request?
7. **F11–F13:**
   - Can an API role write any `refund_*` column?
   - Can a review become public without `release_review_screening` for the exact text?
   - Can a moderator change a report's subject, reporter, reason or recorded reviewer, or decide an appeal of
     their own decision?
8. **F16:** can `scripts/db-test.mjs` be pointed at a database that is not a local, disposable scratch cluster?
   Consider the environment, service files, conninfo strings, a tunnel or forwarded port to a populated private
   server, and existing databases.
9. **F10:** does `scripts/release-preflight.mjs --offline` (and the online mode) detect a changed, missing,
   reordered or unlisted release migration?

### How to run the checks

Use local, disposable databases only. Never point these at a hosted project.

```sh
bun install
npx tsc --noEmit -p .
npx vitest run                                   # 3606 passed, 22 skipped
node scripts/db-test.mjs                         # local Postgres 16 socket: 3420 passed, 0 failed
docker run -d --name pg17 -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5433:5432 postgres:17
PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres node scripts/db-test.mjs   # 3420 passed, 0 failed
node scripts/release-preflight.mjs --offline     # PASS: 37 migrations, hashes for majors 16 and 17
bun run preflight:test                           # 60 passed (needs the local Postgres)
```

Every test that pins a fix ships with a negative control; the PR descriptions list them.

### Known limits (do not re-report as new unless you can go further)

- **F06:** the switch ships open. Production is exposed until the cutover in Part B closes it.
- **F07 and F08:** phase-2 cutovers not executed. Applying the migrations alone does not establish confidentiality.
- **F09:**
  - The contract check trusts what a runtime declares about its own output's transparency. Verifying it would
    mean decoding up to 30 MP in the Worker. This is the same residual as a compromised service returning
    different pixels.
  - `cloudflare-images` is never wired, so it fails closed.
- **F04:** payments are disabled. `settlePendingPayPalOrder` is not wired to anything.
- **Dependency advisories:** `bun audit` still reports dev and build-tool advisories (vite, undici in miniflare,
  shell-quote, brace-expansion, source-map-js). None of them reach `.output/server`.

### Expected output

Findings with severity, file:line, a concrete reproduction (input → wrong result), and whether a test in this tree
should have caught it.

## Part B: remaining staging checklist

Every item needs owner approval, and nothing here touches production until the last step of each section.

### B1. #285: E2E sandbox isolation (`qkukefvzwlyusvspablz`, `ballacity-staging`)

1. In the Supabase dashboard, confirm the project is `ballacity-staging`, owned by an account the owner controls,
   and not the one serving ballacity.com.
2. Confirm it holds synthetic data only, with no replication, foreign data wrapper, webhook, Edge Function secret
   or auth redirect pointing at production.
3. In GitHub, confirm the `e2e-sandbox` Environment secrets came from this project.
   - `E2E_SANDBOX_PROJECT_REF` must be `qkukefvzwlyusvspablz`.
   - A public read with these keys against production must return 401.
4. Add required reviewers to the `e2e-sandbox` Environment.
5. Merge #285, then add one entry to `VERIFIED_E2E_SANDBOX_ISOLATION` in a separately reviewed commit:
   `verified_by`, `verified_on`, and `evidence` (a pointer to the written record, never a key).
6. Run Playwright once against staging. Expect the preflight to pass and the guard to accept. Fixtures are written
   to staging only.

### B2. Node sharp image runtime (F09/F14)

1. Pin both base-image digests in `services/image-processor/Dockerfile`. Build, and confirm sharp 0.35.5 loads in
   the distroless image.
2. Deploy to the chosen host:
   - Cloudflare Containers with `enableInternet = false`, or Cloud Run with egress denied;
   - reachable only from the staging Worker;
   - `IMAGE_PROCESSOR_SECRET` a fresh random value of at least 32 bytes, held only by the service and the staging
     Worker.
3. On the staging Worker only, set `IMAGE_RUNTIME=sharp-node`, `IMAGE_PROCESSOR_URL` and `IMAGE_PROCESSOR_SECRET`.
   Production keeps `IMAGE_RUNTIME` unset (uploads held).
4. Upload these on staging and check each:

   | Upload                                   | Expected                                 |
   | ---------------------------------------- | ---------------------------------------- |
   | Phone JPEG with EXIF orientation and GPS | Published upright, no metadata           |
   | Partially transparent PNG                | 3 renditions scanned                     |
   | PNG drawn only in alpha                  | 2 renditions; the shape visible on white |
   | Animated WebP                            | Refused                                  |
   | 49 MP bomb                               | Refused                                  |

   For each published file, the scanner must be called once for the file plus once per rendition.

5. Stop the service: uploads are held (`reencode_unavailable`). Restart it: a retry publishes.
6. From outside the private network the service must be unreachable. Inside it, unsigned or slow requests get
   401 or 408 in under 1 s.
7. Measure memory and time for a 30 MP JPEG and an 8 MB PNG within the container limits.
8. Rehearse secret rotation.
9. Work through the "Must be validated" list in `docs/privacy/image-runtime-evaluation.md`.

### B3. F06: closing direct uploads (`image_direct_uploads`)

1. Ship the staging client (private staging and server promotion) to production and wait out the adoption window:
   the old build's cache lifetime plus one week.
2. Run the read-only sweep in `docs/privacy/g3b-image-staging.md` weekly. Public-bucket objects with no moderation
   record must trend to zero.
3. On staging, as the service role:

   ```sql
   update public.app_settings set value = '{"closed": true}' where key = 'image_direct_uploads';
   ```

   Check that:
   - an old-build upload and a signed URL minted before the switch both fail with `DIRECT_IMAGE_UPLOAD_CLOSED`;
   - a new-build upload publishes;
   - a client cannot reopen the switch.

4. With owner approval and a backup, run the same statement in production. F06 is closed from this moment.
5. Run phase 2: copy `supabase/phase2/g3b_phase2_close_direct_image_uploads.sql` into a new timestamped migration,
   rehearse it on staging, then apply it with approval. Retire `finalizeImageUpload` in the same release.

### B4. F07: youth location coarsening (`youth_location_privacy`)

1. Confirm the application that reads exact venues from `hosted_game_private` is live and verified, on staging
   then in production.
2. On staging:
   - set `"app_adoption_confirmed": "2c-verified"`;
   - in the same session, `SET app.confirm_activate_youth_coarsening = 'yes'` and set `"coarsen": true`;
   - the guard refuses unless every youth-inclusive game has its private copy.
3. Run `coarsen_existing_youth_games(200)` (service role) in batches until it returns 0.
4. Direct unauthorized-read check: as `anon` and as an unrelated signed-in user, over REST, `select` the public
   location columns of youth games. They must hold coarsened values only. Repeat for realtime payloads.
5. Production: the same steps with owner approval and a backup. The switch cannot be turned off once on (by
   design), so recovery is fix-forward only.

### B5. F08: minor organizer ids (SEC-5 phase 2)

1. Confirm `20261108110000` is applied and the client build that reads `hosted_games_public`,
   `join_requests_visible` and `game_payment_settings_visible` has been live for the adoption window.
   Lovable previews and old bundles that `select=*` on `hosted_games` will get a permission error.
2. On staging, copy `supabase/phase2/sec5_phase2_close_host_id_columns.sql` into a timestamped migration with a
   `lock_timeout`, and apply it.
   - Verify that direct REST reads of `hosted_games.host_id`, `image` and `host_snapshot`,
     `join_requests.host_id` and `game_payment_settings.host_id` are refused for `anon` and `authenticated`.
   - Verify that realtime payloads drop these columns.
   - Verify that storage listing and signing of custom covers do not reveal the host id.
   - Rehearse `sec5_phase2_rollback.sql`.
3. Production: with owner approval and a backup, apply the same migration, then repeat the direct-read checks.
