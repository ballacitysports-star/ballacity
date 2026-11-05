# Audit F01–F16 remediation: independent review brief and remaining staging checklist

Branch `claude/audit-review-snapshot`: the audit-fix PR stack after an independent pre-review round (2026-11-05),
plus the staging verification tools that Part B uses. `claude/release-integration` has the same tree. Except #286
(merged to `main` on 2026-11-05, not yet published), nothing here is merged to `main`, deployed, or applied to any
Supabase project.

**Added on 2026-11-05, after the pre-review; please review these too.**
- #287's production procedure (`docs/release/hotfix-286-287-runbook.md`): the owner runs production SQL only through
  Lovable. The migration is applied by Lovable's migration tool, which records the sha256 of the exact text in
  `drizzle.__drizzle_migrations`. Its read-only checks are:
  - `docs/release/hotfix-287-precheck.sql`;
  - `docs/release/hotfix-287-verify.sql`;
  - `docs/release/hotfix-287-held-reviews.sql`.

  The rollback has one statement per part (`docs/rollbacks/20261031120000_lovable/`), plus the psql variant.
- #294 commit `c6a8ae50`: the release preflight's `pinned_history` also recognizes a hotfix by that drizzle hash. The
  tests are four new self-tests in `scripts/release-preflight.test.mjs`.
- GitHub Actions assigned no runners from 2026-11-05 14:26 UTC onward. The required checks were run locally on every
  affected head; the results are in the runbook, section 8.

## Part A: brief for the independent (Codex) security review

### What to review

The fixes for the independent audit of 2026-11-04 (findings F01–F16), on top of the privacy-release stack.

| Finding                   | PR                                           | Read first                                                                                                               |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| F01 seroval               | #286 → `main`                                | `package.json` overrides, `bun.lock`, `src/lib/server-fn-deserialization.test.ts`                                        |
| F02, F11, F12, F13        | #287 → `main`                                | `supabase/migrations/20261031120000_close_live_write_holes.sql`, `src/lib/reviews.functions.ts`, tests 440, 310, 442     |
| F16                       | #288 → `main`                                | `scripts/db-test-target.mjs`, `scripts/db-test.mjs`                                                                      |
| F15                       | #289 → `main`                                | `scripts/migration-versions.test.mjs`, `docs/migration-history-reconciliation.md` §9                                     |
| F03                       | #290 → `claude/audit-fix-base`               | `supabase/migrations/20261108160000_guardian_approval_validity.sql`, test 545                                            |
| F04                       | #291 → #290                                  | `src/lib/paypal*.ts`, `supabase/migrations/20261108170000_paypal_capture_state.sql`, test 546                            |
| F05, F06                  | #292 → #291                                  | `src/lib/image-animation.ts`, `supabase/migrations/20261108180000_image_direct_upload_closure.sql`, test 547             |
| F13 appeals, F10 pinning  | #294 → #292                                  | `supabase/migrations/20261108190000_appeal_separation.sql`, test 548, `scripts/release-preflight.mjs` (`pinned_history`) |
| F09, F14                  | #293 → `claude/audit-fix-base-image-runtime` | `src/lib/image-runtime/*`, `services/image-processor/src/server.ts`, `src/lib/image-uploads.functions.ts`                |
| F10 manifest              | manifest commits on each PR                  | `docs/release/release-manifest.json` (38 migrations, PG16 and PG17 hashes, `pinned_history`)                             |
| Staging tools (not a fix) | branch `claude/staging-verification-tools`   | `scripts/staging/cutover-probe.ts`, `services/image-processor/scripts/smoke.ts`                                          |

Dependency order:

- `claude/audit-fix-base` is the integration state before the audit fixes. It contains the stack #277–#285, the final
  heads of #286–#289, test 442, a PG16/PG17 manifest, and one merge resolution: the stack's later redefinition of
  "Reviewees view their private reviews" keeps #287's `flagged = false`.
- #290 → #291 → #292 → #294 are stacked in migration-version order, so each tree carries a manifest listing exactly its
  migrations.
- `claude/audit-fix-base-image-runtime` is the same base plus #284, and #293 sits on top of it.

**Pre-review round (2026-11-05).** A fresh-context reviewer found nine issues; all were confirmed by probes. Eight are
fixed in the PR that owns the code, each with tests that fail on the previous version:

| Issue                                            | PR   |
| ------------------------------------------------ | ---- |
| F12: held private review readable by its subject | #287 |
| F12: moderator self-release of a held review     | #287 |
| F13: reviewer attribution of report notes        | #287 |
| F03: approver account eligibility                | #290 |
| F04: order status and payee                      | #291 |
| F06: guarded switch, fail closed                 | #292 |
| F13: appeal separation                           | #294 |
| F10: pinned pre-range hotfix                     | #294 |

The ninth (F16 loopback tunnel) is listed under known limits. Re-running the reviewer's own probes on this tree: every
weakness assertion now fails, except "the switch ships open", which is the intended state until the F06 cutover.

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
npx vitest run                                   # 3619 passed, 22 skipped
node scripts/db-test.mjs                         # local Postgres 16 socket: 3467 passed, 0 failed
docker run -d --name pg17 -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:5433:5432 postgres:17
PGHOST=127.0.0.1 PGPORT=5433 PGUSER=postgres PGPASSWORD=postgres node scripts/db-test.mjs   # 3467 passed, 0 failed
node scripts/release-preflight.mjs --offline     # PASS: 38 migrations, majors 16 and 17, one pinned hotfix
bun run preflight:test                           # 66 passed (needs the local Postgres)
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
- **F04:** payments are disabled. `settlePendingPayPalOrder` is not wired to anything. Its claim of an order stuck in
  `capturing` counts the grace period from the order's creation, not from the claim. A settlement could overlap a
  capture call still in flight. That can cause a refund, never a verified payment without a capture (pre-review
  suspicion, not reproduced; settle before wiring).
- **F13:** admins and superadmins keep the existing override and may review an appeal of a decision they took part in.
- **F16:** `db-test` treats any loopback or socket server as local. An `ssh -L` tunnel that ends on a remote,
  non-Supabase Postgres looks the same. Supabase clusters (production included) are still refused by the
  managed-roles check. Requiring a disposable cluster on loopback would refuse every developer's local Postgres that
  holds other databases.
- **#287 in production:** apply it with the release ledger template (`statements = ARRAY[file content]`), or the release
  preflight refuses (`pinned_history`).
- **Dependency advisories:** `bun audit` still reports dev and build-tool advisories (vite, undici in miniflare,
  shell-quote, brace-expansion, source-map-js). None of them reach `.output/server`.

### Expected output

Findings with severity, file:line, a concrete reproduction (input → wrong result), and whether a test in this tree
should have caught it.

## Part B: remaining staging checklist

Every database change below ships as its own reviewed migration file (AGENTS.md: never a hand-run statement). It is
applied to staging first, then to production with owner approval and a backup.

Two scripts automate the checks below. Neither prints keys, tokens, account ids or row values.

- `bun run staging:cutover-probe` (`scripts/staging/cutover-probe.ts`) checks F06, F07 and F08 from outside the
  database, through the REST and Storage APIs, as an anonymous visitor and as an uninvolved signed-in test account
  (`PROBE_SUPABASE_URL`, `PROBE_SUPABASE_PUBLISHABLE_KEY`, `PROBE_USER_JWT`, optionally `PROBE_HIDDEN_HOST_ID`).
  - It reads only by default, so it may run against any project, production included.
  - `--allow-writes` adds the F06 upload attempt. It is refused unless the target is a local Supabase or the
    designated sandbox with a recorded isolation; production is never written.
  - Before a cutover, EXPOSED is the expected baseline for that finding; after it, every check must PASS.
- `bun run staging:image-smoke` (`services/image-processor/scripts/smoke.ts`; `IMAGE_PROCESSOR_URL`,
  `IMAGE_PROCESSOR_SECRET`) exercises a deployed image service exactly as the Worker does: refusal before admission,
  the body deadline, metadata removal, scan renditions, and the animated and bomb refusals. Against the pre-fix #284
  server it fails the F14 checks, as the audit described.

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
6. Run `bun run staging:image-smoke` from inside the private network: all 12 checks PASS. From outside it, the
   service must be unreachable (connection refused or timeout). Inside it, unsigned or slow requests get
   401 or 408 in under 1 s.
7. Measure memory and time for a 30 MP JPEG and an 8 MB PNG within the container limits.
8. Rehearse secret rotation.
9. Work through the "Must be validated" list in `docs/privacy/image-runtime-evaluation.md`.

### B3. F06: closing direct uploads (`image_direct_uploads`)

1. Ship the staging client (private staging and server promotion) to production and wait out the adoption window:
   the old build's cache lifetime plus one week.
2. Run the read-only sweep in `docs/privacy/g3b-image-staging.md` weekly. Public-bucket objects with no moderation
   record must trend to zero.
3. Write a migration that closes the switch, and apply it on staging:

   ```sql
   UPDATE public.app_settings SET value = '{"closed": true}' WHERE key = 'image_direct_uploads';
   ```

   Then check:
   - `bun run staging:cutover-probe --only F06 --allow-writes` reports PASS (refused by the closed switch);
   - an old-build upload and a signed URL minted before the switch both fail with `DIRECT_IMAGE_UPLOAD_CLOSED`;
   - a new-build upload publishes;
   - a client cannot reopen the switch.

4. With owner approval and a backup, apply the same migration in production. F06 is closed from this moment.
5. Run phase 2: copy `supabase/phase2/g3b_phase2_close_direct_image_uploads.sql` into a new timestamped migration,
   rehearse it on staging, then apply it with approval. Retire `finalizeImageUpload` in the same release.

### B4. F07: youth location coarsening (`youth_location_privacy`)

1. Confirm the application that reads exact venues from `hosted_game_private` is live and verified, on staging
   then in production.
2. Write the activation migration and apply it on staging. In one transaction it:
   - sets `SET LOCAL app.confirm_activate_youth_coarsening = 'yes'`;
   - updates `youth_location_privacy` to carry `"app_adoption_confirmed": "2c-verified"` and `"coarsen": true`.

   The guard refuses unless every youth-inclusive game has its private copy.

3. Then backfill: call `coarsen_existing_youth_games(200)` in a loop until it returns 0. This can be the same
   migration or the next one.
4. Direct unauthorized-read check (`bun run staging:cutover-probe --only F07`, before activation for the baseline
   and after): as `anon` and as an unrelated signed-in user, over REST, `select` the public
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
     `join_requests.host_id` and `game_payment_settings.host_id` are refused for `anon` and `authenticated`:
     `bun run staging:cutover-probe --only F08`, with `PROBE_HIDDEN_HOST_ID` set to a staging host who is not a
     confirmed adult and has a custom cover. The probe also checks that the app's read views still work.
   - Verify that realtime payloads drop these columns. This is a manual check: the probe does not open a realtime
     channel.
   - Verify that storage listing and signing of custom covers do not reveal the host id.
   - Rehearse `sec5_phase2_rollback.sql`.
3. Production: with owner approval and a backup, apply the same migration, then repeat the direct-read checks
   (`bun run staging:cutover-probe --only F08` against production reads only).
