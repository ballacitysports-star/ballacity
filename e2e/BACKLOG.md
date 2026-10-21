# E2E failure backlog

**Source: run 92** (`34569074064`, head `ea77d7047426`, 2026-09-11 06:14–07:07 UTC).
The last run that executed to completion and wrote a report.

```
97 failed, 89 passed, 11 skipped, 197 total
60 spec files with failures
89 passed (50.9m)
```

## Root causes found 2026-10-07 (fixed on this branch, not yet run)

Found by reading the per-test errors of runs 191 (2026-10-01) and 288
(2026-10-06) against the code. None of this has been through CI yet: every job
on this branch since 2026-10-07 12:36 UTC was refused with "recent account
payments have failed or your spending limit needs to be increased" (GitHub
billing), and the app can't be run locally without dependencies.

1. **Game page crashed on every cold deep link (app bug).** `GameDetail` in
   `src/routes/games.$gameId.index.tsx` called `useMyAge`, `useJoinGate` and two
   `useState`s *after* its `Loading…` / `Game not found` early returns. A deep
   link renders `Loading…` first (the hosted-games store is empty until it
   loads), then the game; the second render calls four more hooks, React throws
   "Rendered more hooks than during the previous render", and the route shows
   its error screen. That is the "invite-* routes time out before the game
   landing state renders" cluster: banner, Join / Request / Pay host CTAs,
   roster, status strip and `invite-expired-banner` all live on that page.
   It only rendered when the game happened to be in `localStorage` already,
   which is why `invite-deeplink-to-pay` passed once. The hooks now run before
   the returns, and `useJoinGate` accepts a game that hasn't loaded.
2. **e2e-player was stuck in Parent Mode (test pollution).** The onboarding
   picker's Parent / Guardian tests let `supabase.auth.updateUser({ data: {
   is_guardian: true } })` through to the real account, and `global-setup`
   merged existing metadata, so the flag survived every later run. Parent Mode
   sends `/profile` to `/parent` and `/games/$id/pay` to `/guardian`, and hides
   the join and pay CTAs. Run 191 has no `/parent` redirects and run 288 has
   them from its first `/profile` test, so the flag landed in between (run 191's
   own Parent / Guardian tests passed late in that run). The spec now stubs that
   update, and `global-setup` writes `is_guardian: false` and
   `account_type: player` every run.
3. **"Updated legal documents" dialog over every tab route (missing fixture
   data).** The 2026-09-01 Terms and Privacy versions are material, the
   fixture accounts never accepted them, and `LegalReacceptGate` covers the
   tabs and intercepts clicks. The four `filterbar-persistence` failures in run
   288 name the dialog in their call logs; the `trainers-*` timeouts are likely
   the same but their logs don't say. `global-setup` now records acceptance of
   the bundled and published versions for the fixture accounts.
4. **OAuth "new user" specs could never reach the picker (spec drift).** They
   stubbed only the client's `profiles?select=account_type` read, but the app
   asks the `getOnboardingStatus` server fn first, and the server reads the
   real fixture profile, which has a type. supabase-js emits `SIGNED_IN` when
   it restores the stored session on load, so the root handler sent the
   "new" user to the saved `next` or the feed. One spec stubbed the server fn
   at `/n/…onboarding…`, a URL the app no longer uses. All four specs now use
   `e2e/helpers/server-fn.ts`. `oauth-non-root-referrer` also compared the full
   referrer, which now carries the `/players` default filters; it compares the
   path. The app itself is fine for real users: the repo's latest
   `handle_new_user` (`20260912150000`) leaves `account_type` NULL for social
   sign-ups, so the server reports `needsOnboarding`, *if* that migration is
   applied to the backend in question.
5. **Pay specs asserted copy that isn't in the app.** "Pay host using" and
   "host hasn't configured payment yet" appear nowhere in the repo's history
   (it starts 2026-09-07). The screen says "How do you want to pay?" (or "Or pay
   another way" with PayPal) and "Host hasn't set up payment yet".

Still open, not understood from logs alone:

- The invite specs that seed a notification and open it from `/notifications`
  (`invite-notification-cta`, `invite-pay-and-join*`, `invite-request-tampered`,
  `invite-request-to-join`, `invite-expired`) fail before they reach the game
  page: the seeded row never shows, or the seeding `page.evaluate` hangs for the
  whole test. Fix 1 only helps them once they get past that.
- `invite-fallback-params` "unknown gameId → Game not found" fails in both runs,
  and that path adds no hooks, so fix 1 doesn't explain it.

- `onboarding-null-account-type` route-gate tests passed in run 191 and failed
  in run 288 (picker heading not shown); TanStack Start moved from 1.168.50 to
  1.168.60 in between.
- `social-login-identity-cases` (3 tests) ended on `/auth` in run 288 only;
  `google-vendor-rejection` signup cases and `oauth-empty-referrer` "returning
  user with stashed next" fail in both runs.
- `image-orientation` o6/o8 and `boot-recovery` are unrelated to sessions.
- `managed-child` adds a real child under e2e-host and deletes it in `finally`
  through the UI; if that cleanup fails, e2e-host counts as a guardian.
- The run takes about an hour and the stored session is good for about an
  hour (run 288: tests 11:52–12:53, session minted ~11:52). Any growth pushes
  the last specs past token expiry.
- Hooks after early returns also exist in `profile.edit.tsx`,
  `messages.index.tsx` and `messages.$conversationId.tsx`, but only behind
  signed-out branches `AuthGate` never mounts, so they don't fire today.

## Update 2026-10-01: Actions is back, and there are two newer real runs

| | job | code under test | result |
|---|---|---|---|
| run 191 | `110390007245` | `main` @ `3cb8129` | 98 failed, 110 passed, 8 skipped, 216 total (58.6m) |
| PR #17 re-run | `110434858916` (run `35745044651`) | PR head `9f07d54` merged with the `main` of 2026-09-22 | 90 failed, 101 passed, 5 skipped, 196 total (49.1m) |

Run 191 uploaded a trace artifact, `11170155125` (125,080,828 bytes, 300 files),
which expires about 2026-10-08. Traces for these failures exist again. The job
logs below are what could be read from here; downloading the artifact is blocked
by this environment's egress policy, so the *causes* of the later failures are
still unread. Someone with access should `npx playwright show-trace` a few of
them before 2026-10-08 (or run `preserve-artifact.yml`).

What the two runs show:

- **The fixture sign-in gap is closed.** `global-setup` now prints
  `Signed in e2e-player@lovable.test`, and the `fixture-auth-flows` specs pass.
  Real sign-ins work against the E2E backend (when it is up — see below).
- **The `invite=1` assertion fix does what it says, and is not sufficient.**
  `invite-request-happy-path` failed on `main` at `page.waitForURL` (the strict
  `=== "1"` check); with the fix it gets past that and fails later, at the invite
  banner. The same holds for the other touched specs. **None of the 11 specs
  edited here passes yet.** After the URL step they fail on one of three things:
  1. the "You're invited to this game" banner never renders (`happy-path`,
     `retry-then-reload`);
  2. the CTA's POST never fires — `join_requests` or `game_participants`
     (`duplicate`, `to-join`, `retry-after-error`, plus `in-flight` and
     `network-error`, which were not edited);
  3. a seeded notification never shows or cannot be clicked
     (`pay-and-join`, `notification-cta`, `pay-and-join-verified`, `tampered`,
     `expired`).
- **`desktop-refresh-protected` is fixed**: the `/discover` case is gone and the
  rest pass.
- **Missing `g1`/`g2` is ruled out as the cause.** `GAMES` in
  `src/lib/sample-data.ts` has been `[]` since `12b39bd` (2026-09-05), and 39 specs
  open `/games/g1`, `/games/g2`… without stubbing `hosted_games`. They work because
  `e2e/global-setup.ts` seeds those two rows through the `e2e-games-host` account
  (it logs `Could not seed fixture games g1/g2` or `No games host account` if it
  cannot). Neither run 191 nor the PR re-run logged either warning, so both ids
  existed. Yet `invite-deeplink-to-pay` passes in the PR re-run and fails in run
  191 with the banner missing, on the same seeded game. The cause is therefore
  something that differs between those two bases — `main` gained, among other
  things, the onboarding rework (#23), managed children and a monetization
  free-through date between 2026-09-22 and 2026-10-01 — and only a trace of the
  run 191 failure will say which.
- **Run 195 (`main`) and run 196 (this branch) are not measurements.** On
  2026-10-01 between 17:59 and 18:31 UTC every `global-setup` call to the E2E
  backend (the one behind the `E2E_SUPABASE_*` secrets) returned `Gateway
  Timeout` (upserting the four fixture accounts, then the sign-in). With no
  session, the auth-required specs skip: run 195 was 21 failed / 16 passed / 179
  skipped of 216, run 196 was 21 / 16 / 178 of 215. That is the E2E backend being
  unavailable, not a spec result; `global-setup` logs it at the top of the run,
  so check there first.
- **Runs are not comparable one-to-one.** Different base, different test count
  (216 vs 196). `host-name-deeplink` and `invite-deeplink-to-pay` fail on `main`
  and pass in the PR re-run (same specs, which this PR does not touch).
  `social-login-identity-cases` goes the other way: 7 of 7 pass on `main`, 7 of 7
  fail in the PR re-run — it tests the routing that `main`'s onboarding rework
  changed. `managed-child` and `add-player` exist in only one of the two bases.
  Those differences come from the base, not from the edits in this PR. A run of
  this branch merged with current `main` is the fair comparison; run 196 was
  meant to be that run and was lost to the backend outage described below, so it
  is still outstanding.

## Update 2026-10-07: one healthy run on `main`, and the backend keeps flapping

| | job | result |
|---|---|---|
| run 288 (`main`, 2026-10-06, ~11:45–12:53 UTC) | `112251111958` | 118 failed, 79 passed, 19 skipped, 216 total (1.0h) |
| run 335 (`main`, 2026-10-07 03:21–03:35 UTC) | — | 19 failed, 17 passed, 180 skipped, 216 total — backend timeouts |
| PR #17 re-run (2026-10-06 15:09–15:23 UTC) | `112341883239` | red, backend timeouts |

- **Run 288 is the only recent measurement on a healthy backend.** Only 19 specs
  skipped (the auth-required ones ran), so it is the fair baseline for `main`.
  Its failures are not a backend artefact.
- **29 `invite-*` tests across 19 spec files fail in run 288**, including the
  deeplink, request and pay-and-join families and the ones this PR did not edit
  (`invite-deeplink-join-cta`, `invite-fallback-params`, `invite-malformed-exp`,
  `invite-request-idempotent-taps`, …). So the `invite=1` assertion was one
  cause among several, and the remaining one(s) are not visible in a job log.
  They need the Playwright traces — artifact `11170155125` (expires about
  2026-10-08) or the later `11414886434` (expires 2026-10-13).
- **`desktop-refresh-protected` fails on `main`** in run 288 (still asserts
  `/discover`), as it did before this PR fixed it.
- **The backend behind the `E2E_SUPABASE_*` secrets is unreliable.** `global-setup`
  reported `Gateway Timeout` on every call during runs 195, 196 and 204
  (2026-10-01), the PR re-run on 2026-10-06 and run 335 on 2026-10-07; run 288
  was healthy. Every time it times out, ~180 of 216 specs skip and the
  pass/fail counts mean nothing. Treat a run as a measurement only if
  `global-setup` has no `Gateway Timeout` lines and the skip count is in the
  teens, not the hundreds. The repo cannot fix this; whoever owns the secrets
  has to look at that backend's Auth service.
- **`bun install --frozen-lockfile` was briefly failing on `main`** because
  `bun.lock` was out of sync with `package.json`. It has since been re-synced on
  `main`; run 288 installed cleanly.

## Older notes (written while runners were down)

This was believed unrecoverable. Run 91 was killed by the 40-minute ceiling before
Playwright could finalise its JSON, and every run from 2026-09-11 12:02 onward dies
in 3–4 seconds without acquiring a runner, so no later run has produced anything.
Run 92 did both — it finished, and it uploaded its report — and the job log is still
retrievable through the API. The enumeration below is taken from that log's own
summary step.

## The artifact expired on 2026-09-18 — read `run92-failures.md` instead

Run 92 uploaded `playwright-report` — artifact `10188443682`, 148,597,243 bytes,
299 files, `retention-days: 7` from 2026-09-11. **It expired at
2026-09-18T07:06:54Z and GitHub has purged it** (the Actions API now reports
`"expired": true` for it). Nothing can regenerate it: it was the output of a run
that no longer has a runner to repeat.

Both rescue paths stayed blocked for the whole retention window:
`preserve-artifact.yml`, which would have republished it as a Release asset,
never acquired a runner (same Actions outage, still ongoing as of 2026-09-22 —
every run since 2026-09-11 12:02 dies in seconds with no steps and no logs), and
a direct download was refused by this session's egress policy.

**The failure record itself survived.** Every failing test's error, locator, call
log and code frame — plus the full 197-test execution roster — was transcribed
out of the job log into `e2e/run92-failures.md` before the deadline. That file is
in version control, does not expire, and is what most debugging actually needs.
Start there.

What went with the artifact, permanently:

- the per-failure `trace.zip` (DOM snapshots, network waterfalls, action timeline)
- the failure screenshots
- the `error-context.md` accessibility dumps
- `results.json`

So the `invite-*`, `pay-*` and `oauth-*` failures can still be read — assertion,
selector, timeout, and the exact line that failed — but they can no longer be
*replayed*. `run92-failures.md` keeps each failure's `test-results/...` path, which
is now only useful for correlating against a future run that reproduces the same
case.

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
`COALESCE(_type, 'player')`. It was written for a backend where
`account_type` is `NOT NULL`, and it is corrected by `20260912150000`, which drops
that constraint and restores the NULL. The Lovable backend that serves the app was
never affected; its `account_type` has always been nullable.

So: **check whether the backend the E2E secrets point at has a `handle_new_user`
that coalesces, and if it does, apply `20260912150000` there.** Note this is
unverified — run 92 predates `20260911001000` reaching that backend, per the commit
message on run 91, so the timing does not line up on its face and the cause may be
unrelated. It is listed first because it is a one-query check with a known fix, not
because it is likely.

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
3. **The OAuth `account_type` check.** One query against the E2E backend.
4. **`image-orientation`.** Self-contained and reproducible without a session.
5. **`pay-screen-no-cross-host-leak` / `pay-screen-rpc-and-empty-state`.** Security
   assertions currently unenforced.
6. Everything else, once the shared causes are known.

## Blocked

**No longer blocked as of 2026-10-01.** Actions allocated runners again at about
13:25 UTC that day (run 191); see "Update 2026-10-01" at the top of this file. The
outage ran from 2026-09-11 12:02 to 2026-10-01 — every run in between failed
within seconds with no runner, no steps and no logs (e.g. run 166, `35676681560`,
4s; its job log 404s because no step ever ran). If it comes back, the `Runner
probe` workflow (`workflow_dispatch`) answers "can Actions get a runner" in
seconds; run it before spending 40–75 minutes on the suite.

## Update: full run-92 job log re-read (2026-09-16)

At the time of this re-read, run 92's `playwright-report` artifact was still
downloadable (`10188443682`; it has since expired — see above) and its full job
log — not just the "Summarise results" tally — is retrievable through the Actions
API. Reading the actual per-test
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
depends on live schema state on the backend that the `E2E_SUPABASE_*` repository
secrets point at. Nothing in this repo can inspect or migrate it, and the secret
values are masked in CI logs, so the repo does not say which backend that is.
`.github/workflows/e2e.yml` never runs `supabase db push` against it.
`20260912150000_account_type_nullable_preserve_onboarding.sql` is the correct fix
and is already in `supabase/migrations/`; whether it has been applied there is a
question for whoever holds the secrets, not something resolvable from the
codebase.
