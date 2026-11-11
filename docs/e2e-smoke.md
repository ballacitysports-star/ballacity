# E2E smoke check (P0-9)

The full Playwright suite (`Playwright` check) still fails on stale specs that PR #298 rewrites.
The `E2E smoke` check judges only a small set of tests that already pass on the sandbox. That gives
us an E2E signal we can trust while the rest of the suite is repaired.

## How it works

- `e2e/smoke-set.json` lists the smoke tests by spec file and title path. A title path is the
  describe titles, then the test title, joined with `›`. The file lists 31 tests.
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

| Area                                    | Spec                                                              | Tests |
| --------------------------------------- | ----------------------------------------------------------------- | ----- |
| Route persistence on refresh            | `desktop-refresh-protected`, `mobile-refresh-protected`           | 7     |
| Sign-in, session survival, bad password | `fixture-auth-flows`                                              | 7     |
| Minor and consent safety                | `fixture-age-gated-flows`, `child-lifecycle-cohorts`              | 7     |
| No leaks on public reel pages           | `public-reel-page`                                                | 3     |
| Signed-out entry and invite fallback    | `signed-out-preview`, `invite-fallback-params`                    | 2     |
| Payment security (no cross-host leak)   | `pay-screen-no-cross-host-leak`, `pay-screen-rpc-and-empty-state` | 2     |
| Managed child: add, switch, delete      | `managed-child`                                                   | 1     |

The two payment security specs (`pay-screen-no-cross-host-leak`, `pay-screen-rpc-and-empty-state`)
were added on 2026-11-07, after #298 and #341 fixed them and they passed in three sandbox runs (#341,
#334, #347). The audit also names the invite happy path. It is still left out because it fails on
the sandbox (the invite and join specs wait on the payment-settings guard decision).

The managed-child end-to-end test (`managed child, end to end › add, switch in, switch back,
delete`) was added on 2026-11-10, with the cap raised from 30 to 31 for it (owner decision). #381
fixed its cleanup: it used to skip the delete silently and leave children behind in the sandbox.
It now gives each run's child a unique name and deletes every leftover before and after the flow.
It joins after passing on the sandbox in #381, which merges only once three of its
sandbox runs have passed it.

## Changing the set

- Add a test only after it has passed on the sandbox, and preferably in three runs.
- Keep the set between 20 and 31 tests. A unit test enforces this.
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

## Accessibility gate (P3-5)

`e2e/a11y-public-pages.spec.ts` runs axe (`@axe-core/playwright`, WCAG 2.1 A and AA) on ten public
pages, signed out, plus `/` at phone width. A serious or critical violation fails the test.
Moderate and minor findings are only printed.

- Baseline, 2026-11-09, dev server on the sandbox: 18 public pages scanned. The only serious
  finding was `aria-prohibited-attr` on the skip-link target, on every page. It is fixed in the
  same change. Putting the old target back fails the spec on every page.
- The 11 tests join `e2e/smoke-set.json` once they have passed on the sandbox in CI, like every
  other smoke test.
- Signed-in pages: `e2e/a11y-signed-in-pages.spec.ts` signs in once as the adult `host` fixture and
  runs the same check on `/feed`, `/discover`, `/teams`, `/players`, `/messages`, `/notifications`,
  `/profile`, `/settings` and `/create`. Its baseline (2026-11-10) found one serious problem on every
  one of them: white text on the brand coral in the unread badges (4.1:1, under AA's 4.5:1). Those
  now use `bg-coral-strong` (4.9:1, and 5.3:1 in the light theme), and `src/lib/coral-contrast.test.ts`
  keeps plain `bg-coral` out from behind white text.
