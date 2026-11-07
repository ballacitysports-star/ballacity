# E2E smoke check (P0-9)

The full Playwright suite (`Playwright` check) still fails on stale specs that PR #298 rewrites.
The `E2E smoke` check judges only a small set of tests that already pass on the sandbox. That gives
us an E2E signal we can trust while the rest of the suite is repaired.

## How it works

- `e2e/smoke-set.json` lists the smoke tests by spec file and title path. A title path is the
  describe titles, then the test title, joined with `›`. The file lists 26 tests.
- The `Playwright` job runs the whole suite once, as before. After the report is sanitized, its
  `Check smoke set` step runs `.github/e2e-smoke-gate.mjs` on `ci-sanitized/results.json`.
- The gate passes only if every listed test is in the report and passed. A skipped, missing
  (renamed or never reached), failed, flaky or interrupted test fails it.
- The `E2E smoke` job reads that result and fails closed. It also fails if `Playwright` failed
  before the report, was cancelled by the shared sandbox queue, or was skipped (fork and Dependabot
  pull requests).
- There is no second run, no extra sandbox time and no new secret. The smoke job has no checkout,
  no environment and no token permissions.

Run the smoke set locally against the sandbox:

```sh
node -e 'const s=require("./e2e/smoke-set.json");console.log([...new Set(s.tests.map(t=>"e2e/"+t.file))].join(" "))' \
  | xargs bunx playwright test --trace=off
```

That runs the whole of each listed file. The gate then judges only the listed tests.

## What is in the set

The tests were chosen on 2026-11-06. Each passed in all four sandbox runs available then: #298 run
42138934406 attempt 3, and the latest runs of #304, #314 and #317. None was skipped in any of them.

| Area                                    | Spec                                                    | Tests |
| --------------------------------------- | ------------------------------------------------------- | ----- |
| Route persistence on refresh            | `desktop-refresh-protected`, `mobile-refresh-protected` | 7     |
| Sign-in, session survival, bad password | `fixture-auth-flows`                                    | 7     |
| Minor and consent safety                | `fixture-age-gated-flows`, `child-lifecycle-cohorts`    | 7     |
| No leaks on public reel pages           | `public-reel-page`                                      | 3     |
| Signed-out entry and invite fallback    | `signed-out-preview`, `invite-fallback-params`          | 2     |

The audit also names the invite happy path and the two payment security specs
(`pay-screen-no-cross-host-leak`, `pay-screen-rpc-and-empty-state`). They are left out because they
still fail on the sandbox. Add them once #298 is merged and they have passed there.

## Changing the set

- Add a test only after it has passed on the sandbox, and preferably in three runs.
- Keep the set between 20 and 30 tests. A unit test enforces this.
- If you rename a smoke test, update its entry in the same pull request. Otherwise the gate reports
  it as "missing from the report" and fails.
- Never remove a test from the set just to turn the check green. If a smoke test fails, fix the test
  or the app.

## Making it required (owner, in GitHub settings)

The audit's rule: require `E2E smoke` after three consecutive green runs. Before switching it on:

- `E2E smoke` has passed on three consecutive pull request runs.
- The `e2e-sandbox` Environment has required reviewers, or you accept that every pull request
  waits for that approval.
- You accept the queue cost. A newer queued E2E run cancels an older queued one, and a cancelled
  run fails `E2E smoke`. That pull request then needs its E2E workflow re-run before it can merge.
- You accept that Dependabot and fork pull requests fail it, because they get no sandbox
  secrets, and need an admin merge.

Then add `E2E smoke` under required status checks (see `docs/branch-protection.md`). To roll back,
remove it from the required checks. Nothing in the repository needs to change.
