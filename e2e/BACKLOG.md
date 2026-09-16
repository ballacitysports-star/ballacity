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
countable, and it is the only copy.

    https://github.com/ballacitysports-star/ballacity/actions/runs/34569074064/artifacts/10188443682

After it expires this file is all that remains. Nothing can regenerate it until
Actions allocates runners again.

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
- `fixture-family-flows` — Guardian Dashboard from Settings.
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
