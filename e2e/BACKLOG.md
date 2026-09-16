# E2E failure backlog

**Source: run 92** (`34569074064`, head `ea77d7047426`, 2026-09-11 06:14–07:07 UTC).
The last run that executed to completion and wrote a report.

```
97 failed, 89 passed, 11 skipped, 197 total
60 spec files with failures
89 passed (50.9m)
```

This was believed unrecoverable. Run 91 was killed by the 40-minute ceiling before
Playwright could finalise its JSON, and every run from 2026-09-11 12:02 onward dies
in 3–4 seconds without acquiring a runner, so no later run has produced anything.
Run 92 did both — it finished, and it uploaded its report — and the job log is still
retrievable through the API. The enumeration below is taken from that log's own
summary step.

## Download the artifact before 2026-09-18

Run 92 uploaded `playwright-report` — **artifact `10188443682`, 148,597,243 bytes,
299 files**, `retention-days: 7` from 2026-09-11. That archive holds the traces,
screenshots and `results.json` that make these failures debuggable rather than just
countable.

    https://github.com/ballacitysports-star/ballacity/actions/runs/34569074064/artifacts/10188443682

**It is no longer the only copy of the failure record.** Every failing test's
error, locator, call log and code frame — plus the full 197-test execution
roster — is transcribed from the job log into `e2e/run92-failures.md`, which is
in version control and does not expire. Read that first; it is what most
debugging actually needs.

What only the artifact has, and what is lost at 2026-09-18T07:06:54Z, is the
`trace.zip` per failure (DOM snapshots, network waterfalls), the screenshots and
the `error-context.md` accessibility dumps. `run92-failures.md` keeps the
`test-results/...` path against each failure so they can still be matched up if
someone rescues the artifact in time.

Two rescue paths exist and both are currently blocked: `preserve-artifact.yml`
(republishes it as a Release asset, but cannot get a runner — same Actions
outage), and a direct download (refused by egress policy from a sandboxed agent
session). A person on an unrestricted machine can still do it in one command:

    gh run download 34569074064 -R ballacitysports-star/ballacity -n playwright-report

## What the failures look like

Three signatures cover nearly all 97:

| Signature | Meaning |
| --- | --- |
| `expect(locator).toBeVisible() failed` | the expected element never rendered |
| `Test timeout of 60000ms exceeded.` | the page never reached the asserted state |
| `expect(page).toHaveURL(...)` / `expect(received).toBe(...)` | navigation landed somewhere else |

The breadth is the interesting part, and the reason this is probably **not** 97
independent bugs. Specs as basic as "refresh on /feed stays on /feed" and "refresh
on /discover stays on /discover" fail, while 89 other tests pass. A near-total
failure of anything that needs a rendered, signed-in view — alongside a working
minority — points at a small number of shared causes in fixture state or first
paint, not at 60 unrelated regressions. Treat the families below as the unit of
work.

## Families

Grouped by spec-file prefix, largest first. Counts are **spec files**, not assertions.

### `invite-*` — 19 files
`invite-deeplink-join-cta`, `invite-deeplink-to-pay`, `invite-expired`,
`invite-fallback-params` (4), `invite-malformed-exp` (4), `invite-notification-cta`,
`invite-pay-and-join`, `invite-pay-and-join-confirmation`,
`invite-pay-and-join-verified`, `invite-request-duplicate`,
`invite-request-happy-path`, `invite-request-idempotent-taps`,
`invite-request-in-flight`, `invite-request-malformed-exp` (4),
`invite-request-network-error`, `invite-request-retry-after-error`,
`invite-request-retry-then-reload`, `invite-request-tampered` (2),
`invite-request-to-join`.

Almost entirely `toBeVisible`. `invite-request-happy-path` and one
`invite-malformed-exp` case fail earlier still, on `page.waitForURL` at 10s — so the
deeplink is not even reaching the game page. Start there: if the invite route never
lands, every downstream assertion in this family is a consequence rather than a bug.

### `pay-*` — 14 files
`pay-approval-gate-flips`, `pay-approval-polling-fallback`,
`pay-approval-realtime-only`, `pay-blocked-until-approved`,
`pay-button-navigates` (**7 assertions — the single biggest file**),
`pay-cta-reaches-success-or-retry` (2), `pay-only-after-approval-no-duplicates`,
`pay-realtime-delayed-polling-no-duplicates`, `pay-rejected-confirmation`,
`pay-screen-no-cross-host-leak`, `pay-screen-rpc-and-empty-state`,
`pay-submission-confirmation`, `pay-submission-declined`,
`pay-verified-confirmation`.

Uniformly `toBeVisible`. Two of these assert security properties rather than UX —
`pay-screen-no-cross-host-leak` and `pay-screen-rpc-and-empty-state` — so they are
worth more than their count suggests: while they fail, nothing is checking that a
player cannot see another host's payment methods.

### OAuth and social login — 6 files
`oauth-empty-referrer` (2), `oauth-from-auth-referrer` (2),
`oauth-no-signin-flash-on-navigation` (2), `oauth-non-root-referrer` (4),
`social-login-identity-cases` (5), `google-vendor-rejection` (2).

This family is distinctive: it fails on **where the user lands**, not on rendering.
Every assertion is about routing a new social sign-in to
`/onboarding/account-type`.

**Hypothesis worth testing first, because it is cheap and there is a specific
reason to suspect it.** That routing is decided by one value:
`resolveOnboardingStatus` returns `needsOnboarding: accountType === null`
(`src/lib/onboarding.functions.ts`), and `AccountTypeScreen` bounces straight out
as soon as `profiles.account_type` holds a valid type. Anything that writes a
non-null `account_type` at signup makes every one of these assertions fail exactly
this way.

`20260911001000` did precisely that — it changed `handle_new_user` to insert
`COALESCE(_type, 'player')`. It was written for the dev/E2E project, where
`account_type` is `NOT NULL`, and it is corrected by `20260912150000`, which drops
that constraint and restores the NULL. Production was never affected;
its `account_type` has always been nullable.

So: **check whether the E2E project's `handle_new_user` coalesces, and if it does,
apply `20260912150000` there.** Note this is unverified — run 92 predates
`20260911001000` reaching that project, per the commit message on run 91, so the
timing does not line up on its face and the cause may be unrelated. It is listed
first because it is a one-query check with a known fix, not because it is likely.

### Realtime cross-view — 7 files
`join-cross-device-discover-spots`, `join-cross-device-roster`,
`join-realtime-cross-views`, `join-request-host-approval-realtime`,
`leave-host-pending-realtime`, `leave-verified-payment-consistency`,
`roster-realtime-reconnect`, plus `player-orgs-realtime` (timeout).

These drive two browser contexts and assert one sees the other's change, so they
are the most likely of any family to be genuinely flaky. Note `playwright.config.ts`
sets `retries: 0` and `fullyParallel: false`: there is no retry to absorb a flake,
so an intermittent realtime frame becomes a hard failure, and specs run in sequence
sharing the same handful of fixture accounts. Before treating any of these as a
product bug, establish whether it fails consistently.

### Route persistence — 3 files
`mobile-refresh-protected` (**5 assertions, all 60s timeouts**),
`desktop-refresh-protected` (`toHaveURL`), `boot-recovery`.

The cheapest family to investigate and the most diagnostic: these assert only that
a refresh stays put. If a signed-in user cannot reload `/feed` without the page
failing to settle within 60 seconds, that likely explains a large share of the
`toBeVisible` failures elsewhere, and fixing it may move far more than 6
assertions.

### Filter persistence — 3 files
`filterbar-persistence` (4, all timeouts), `trainers-venue-filter` (2, timeouts),
`trainers-venue-filter-bookmark` (timeout).

### Standalone — 6 files
- `add-player.spec.ts` — "onboarding asks who the account is for", `toBeVisible`.
  Worth calling out: this is the spec PR #13 existed to run, and it has still never
  passed in CI.
- `image-orientation.spec.ts` (2) — the one family with a distinct, self-describing
  failure: `TL for orientation 6: got 255,255,0` and the same for orientation 8. A
  pixel assertion on EXIF-rotated export, unrelated to session or routing, and
  probably the most self-contained bug in the whole list.
- `fixture-age-gated-flows` — teen_16_17 hosting policy.
- `fixture-family-flows` — Parent Center from Settings.
- `host-name-realtime`, `host-name-throttled` — host name stays on `display_name`.
- `team-post-create` — composer publishes end-to-end (timeout).

## Suggested order

1. **Route persistence.** Cheapest, most diagnostic, plausibly upstream of many
   `toBeVisible` failures.
2. **`invite-*` `waitForURL`.** Find out why the deeplink never lands before
   treating 30 downstream assertions as separate.
3. **The OAuth `account_type` check.** One query against the E2E project.
4. **`image-orientation`.** Self-contained and reproducible without a session.
5. **`pay-screen-no-cross-host-leak` / `pay-screen-rpc-and-empty-state`.** Security
   assertions currently unenforced.
6. Everything else, once the shared causes are known.

## Blocked

None of this can be re-measured until Actions allocates runners. Every run since
2026-09-11 12:02 fails in 3–4 seconds with no runner, no steps and no logs,
identically on `main` and on branches. The `Runner probe` workflow
(`workflow_dispatch`) answers "can Actions get a runner yet" in seconds; run that
before spending 40–75 minutes on the suite.

## Update: full run-92 job log re-read (2026-09-16)

Run 92's `playwright-report` artifact was still downloadable (`10188443682`,
expires ~2026-09-18) and its full job log — not just the "Summarise results"
tally — is retrievable through the Actions API. Reading the actual per-test
`waitForURL`/`toBeVisible` failure text (not just the one-line error summary)
turned up two concrete, confirmed causes and closed out a third hypothesis:

**Confirmed: `invite=1` is rewritten to `invite=true` on load.** The
`invite-request-happy-path` failure's log shows Playwright's own navigation
trace: `navigated to ".../games/g2?invite=true&from=...&exp=..."`. The app's
`validateSearch` on `/games/$gameId` (`src/routes/games.$gameId.index.tsx`)
parses `invite=1` into the boolean `true`, and the router's own URL sync
writes that back as `invite=true` — the app is doing exactly what
`invite-deeplink-join-cta.spec.ts` and `invite-deeplink-to-pay.spec.ts`
already expected (`["1", "true"].includes(...)`). Eleven other `invite-*`
spec files asserted the stricter, incorrect `=== "1"` and have been fixed to
match: `invite-request-happy-path`, `invite-notification-cta`,
`invite-expired`, `invite-request-to-join`, `invite-request-tampered`,
`invite-request-duplicate`, `invite-request-retry-after-error`,
`invite-request-retry-then-reload`, `invite-pay-and-join`,
`invite-pay-and-join-confirmation`, `invite-pay-and-join-verified`.

**Confirmed: `desktop-refresh-protected` still asserts on `/discover`.**
`/discover` (`src/routes/_tabs.discover.tsx`) is a `beforeLoad` redirect to
`/feed` — an intentional merge ("Merged into /feed as the 'Map' view"), not a
regression. The log shows the refresh landing on
`/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming`, which is
`/feed`'s own canonicalized search — not a hydration bounce. The sibling
`mobile-refresh-protected.spec.ts` already excludes `/discover` for this exact
reason; `desktop-refresh-protected.spec.ts` was out of sync and has been
fixed to match.

**Narrowed, not fixed: the `getByText('E2E ...')` / `/auth` cluster.** A large
share of the remaining failures — the `invite-*` tests that seed a
notification directly and then look for it on `/notifications`
(`invite-expired`, `invite-notification-cta`, `invite-pay-and-join*`,
`invite-request-tampered`, `invite-request-to-join`), plus
`host-name-realtime`/`host-name-throttled` (looking for `'E2E Player'`) and
the `social-login-identity-cases`/`google-vendor-rejection` OAuth specs that
sign in for real through the `/auth` form and end up parked on `/auth`
instead — all share one shape: content seeded or authenticated earlier in the
same test never shows up. `notifications` RLS (`INSERT`/`SELECT ... USING
(user_id = auth.uid())`) checks out fine by inspection, and the real
`signInWithPassword` failing to reach `/auth`'s destination is exactly what
`e2e/global-setup.ts`'s fixture-account/`SUPABASE_SERVICE_ROLE_KEY` seeding
gaps (documented inline in that file) would produce. Those specific seeding
gaps were fixed in this repo after run 92 — the g1/g2 host account, adult
birthdays, and the loud missing-service-role-key warning all landed later —
so this cluster is most likely already resolved by those fixes rather than a
live bug, but it is unverified: nothing has re-run since 2026-09-11 12:02.
Re-run the suite once Actions allocates a runner before assuming it's clear.

**Not re-verified: the OAuth `account_type` coalesce question.** Still
depends on live schema state on the E2E Supabase project
(`olrbulvwexrkjcxddjxq`), which nothing in this repo can inspect or migrate —
`.github/workflows/e2e.yml` never runs `supabase db push` against it (see
`supabase/config.e2e.toml`). `20260912150000_account_type_nullable_preserve_onboarding.sql`
is the correct fix and is already in `supabase/migrations/`; whether it has
been applied to that project is an infra question for whoever holds its
credentials, not something resolvable from the codebase.
