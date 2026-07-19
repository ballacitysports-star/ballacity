## Goal

Add a GitHub Actions workflow that runs Playwright e2e tests (all specs under `e2e/`, including `trainers-venue-filter-bookmark.spec.ts`) on every pull request and on pushes to `main`.

## New file

`.github/workflows/e2e.yml`

## Workflow shape

- **Name**: `E2E`
- **Triggers**: `pull_request` (all branches) and `push` to `main`.
- **Concurrency**: group by ref, cancel in-progress runs so PR pushes supersede.
- **Job**: `playwright` on `ubuntu-latest`, 20-minute timeout.

## Steps

1. `actions/checkout@v4`
2. `oven-sh/setup-bun@v2` (bun latest)
3. `bun install --frozen-lockfile`
4. Install Playwright's Chromium: `bunx playwright install --with-deps chromium` (overrides the sandbox-only `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` by unsetting it in the env of the test step so Playwright falls back to its own managed browser).
5. Build the app: `bun run build:dev` (Cloudflare/Vite build).
6. Start the dev server in the background: `bun run dev &` and wait for `http://localhost:8080` to respond (curl retry loop, ~60s max).
7. Run tests: `bunx playwright test` with env:
   - `E2E_BASE_URL=http://localhost:8080`
   - `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=` (empty, so config's fallback path isn't used)
   - `LOVABLE_BROWSER_SUPABASE_*` NOT set — auth-gated specs auto-skip; `trainers-venue-filter-bookmark.spec.ts` skips per its own guard. That's expected in CI without a workspace session; we run the suite so unauthenticated specs still validate.
8. On failure, upload `playwright-report/` and `test-results/` via `actions/upload-artifact@v4` with `if: always()`.

## Notes

- No secret required for this workflow; auth-gated specs skip cleanly. If the user later wants the bookmark spec to actually execute in CI (not skip), they'll need to add `LOVABLE_BROWSER_SUPABASE_SESSION_JSON` / `LOVABLE_BROWSER_SUPABASE_STORAGE_KEY` as GitHub Actions secrets — flag this in the closing message, don't wire it now.
- No package.json changes needed; `test:e2e` script already exists.
- Playwright config already reads `E2E_BASE_URL`.
