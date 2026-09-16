# Run 92 — full E2E failure record

Verbatim failure output from **run 92** ([`34569074064`](https://github.com/ballacitysports-star/ballacity/actions/runs/34569074064)),
head `ea77d7047426`, 2026-09-11 06:14–07:07 UTC — the last E2E run that executed
to completion. `e2e/BACKLOG.md` is the analysis of this run; this file is the
underlying evidence it was derived from.

```
97 failed, 89 passed, 11 skipped, 197 total
```

## Why this file exists

Run 92 uploaded a `playwright-report` artifact (id `10188443682`, 148 MB) holding
the traces, screenshots and `results.json`. That artifact was created with
`retention-days: 7` and expires **2026-09-18T07:06:54Z**, and two independent
paths to rescuing it are both blocked:

- The repo's own `preserve-artifact.yml` does the download inside GitHub's
  network, but cannot get a runner — the same Actions outage that has failed
  every run in this repo since 2026-09-11 12:02. Three dispatches have died in
  3–5 seconds with no runner and no steps.
- A sandboxed agent session cannot fetch it either: the artifact's storage host
  is refused by egress policy (`403` on CONNECT).

The job **log**, however, retains far longer than the 7-day artifact, and it
carries the part that matters most for debugging: every failing test's error,
locator, call log and code frame. That is what is transcribed below, so the
diagnostic record survives the artifact's expiry.

What is NOT preserved here, and is lost when the artifact expires: the
`trace.zip` files (DOM snapshots, network waterfalls), the failure screenshots,
and the `error-context.md` accessibility dumps. The `test-results/...` paths are
kept against each failure so they can still be matched up if the artifact is
rescued before the window closes.

## Reading this

Failures are grouped by family in `e2e/BACKLOG.md`, which also records which
causes have since been confirmed, fixed, or ruled out. Two worth carrying
forward when reading the raw output below:

- Failure 32 (`invite-request-happy-path`) contains the navigation line
  `navigated to ".../games/g2?invite=true&..."` — proof that the app rewrites
  `invite=1` to `invite=true`, which is app behavior, not a bug. The strict
  `=== "1"` assertions were the defect.
- Failure 3 (`desktop-refresh-protected`, `/discover`) shows the refresh landing
  on `/feed?q=&sport=...`. `/discover` is a deliberate redirect into `/feed`,
  not a hydration bounce.

Note the execution roster below is as informative as the failures: several specs
in a failing family passed (`oauth-new-user-onboarding` passed all three cases
while `social-login-identity-cases` failed five), which is what separates a real
regression from a fixture or environment fault.

---

## Execution roster (197 tests, in run order)

```
  ✓    1 [chromium] › e2e/add-player.spec.ts:58:1 › a parent adds a child, who gets no login (26.9s)
  ✓    2 [chromium] › e2e/add-player.spec.ts:88:1 › the sport is optional, the name and birthday are not (4.6s)
  ✘    3 [chromium] › e2e/add-player.spec.ts:108:1 › onboarding asks who the account is for (21.6s)
  ✓    4 [chromium] › e2e/boot-recovery.spec.ts:3:1 › the app boots with the dependency-free OG image endpoint (2.0s)
  ✓    5 [chromium] › e2e/boot-recovery.spec.ts:18:1 › failed client boot reloads once, then shows recovery actions (20.6s)
  ✓    6 [chromium] › e2e/boot-recovery.spec.ts:41:1 › a silently stalled startup module reloads once, then becomes actionable (20.6s)
  ✘    7 [chromium] › e2e/boot-recovery.spec.ts:58:1 › slow client boot is not interrupted by an automatic reload (18.5s)
  ✓    8 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:136:5 › child lifecycle: consent gate per cohort › under-13 with consent required gets limited, browse-only access (18.4s)
  ✓    9 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:136:5 › child lifecycle: consent gate per cohort › under-13 with consent pending gets limited, browse-only access (6.1s)
  ✓   10 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:136:5 › child lifecycle: consent gate per cohort › under-13 with consent revoked gets limited, browse-only access (6.1s)
  ✓   11 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:161:3 › child lifecycle: consent gate per cohort › under-13 with approved consent reaches the app (3.0s)
  ✓   12 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:176:5 › child lifecycle: consent gate per cohort › teen_13_15 is never consent-gated (3.1s)
  ✓   13 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:176:5 › child lifecycle: consent gate per cohort › teen_16_17 is never consent-gated (2.9s)
  ✓   14 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:176:5 › child lifecycle: consent gate per cohort › adult is never consent-gated (2.9s)
  ✓   15 [chromium] › e2e/child-lifecycle-cohorts.spec.ts:191:3 › child lifecycle: consent gate per cohort › a blocked child can still reach the consent flow and safety pages (5.2s)
  ✓   16 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /feed stays on /feed (desktop) (5.6s)
  ✓   17 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /players stays on /players (desktop) (7.6s)
  ✓   18 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /teams stays on /teams (desktop) (13.9s)
  ✘   19 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /discover stays on /discover (desktop) (20.5s)
  ✓   20 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /create stays on /create (desktop) (9.1s)
  ✓   21 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /profile stays on /profile (desktop) (8.9s)
  ✓   22 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /notifications stays on /notifications (desktop) (6.3s)
  ✓   23 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /messages stays on /messages (desktop) (8.1s)
  ✓   24 [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /settings stays on /settings (desktop) (6.7s)
  ✓   25 [chromium] › e2e/desktop-refresh-protected.spec.ts:87:1 › signed-out refresh on a protected route still redirects to /auth (1.4s)
  ✓   26 [chromium] › e2e/desktop-refresh-protected.spec.ts:102:1 › unusable persisted session exits the loader and redirects to sign-in (1.5s)
  ✘   27 [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /feed (1.0m)
  ✘   28 [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /players (1.0m)
  ✘   29 [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /teams (1.0m)
  ✘   30 [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /trainers (1.0m)
  ✓   31 [chromium] › e2e/fixture-age-gated-flows.spec.ts:34:3 › hosting screen matches the child_under_13 hosting policy (19.9s)
  ✓   32 [chromium] › e2e/fixture-age-gated-flows.spec.ts:34:3 › hosting screen matches the teen_13_15 hosting policy (22.2s)
  ✘   33 [chromium] › e2e/fixture-age-gated-flows.spec.ts:34:3 › hosting screen matches the teen_16_17 hosting policy (29.9s)
  -   34 [chromium] › e2e/fixture-age-gated-flows.spec.ts:34:3 › hosting screen matches the adult hosting policy
  -   35 [chromium] › e2e/fixture-age-gated-flows.spec.ts:52:1 › an under-13 account without consent still cannot reach hosting
  -   36 [chromium] › e2e/fixture-age-gated-flows.spec.ts:59:1 › payment coordination policy agrees for every cohort
  -   37 [chromium] › e2e/fixture-age-gated-flows.spec.ts:66:1 › a minor cohort keeps the app browsable rather than locking it out
  -   38 [chromium] › e2e/fixture-age-gated-flows.spec.ts:79:1 › a revoked child sees the account-off explanation with a way forward
  -   39 [chromium] › e2e/fixture-age-gated-flows.spec.ts:90:1 › messages surface loads for an adult fixture account
  ✓   40 [chromium] › e2e/fixture-auth-flows.spec.ts:19:3 › host: signs in and reaches a protected surface (13.2s)
  ✓   41 [chromium] › e2e/fixture-auth-flows.spec.ts:30:3 › host: session survives a hard refresh of a protected route (8.5s)
  ✓   42 [chromium] › e2e/fixture-auth-flows.spec.ts:19:3 › player: signs in and reaches a protected surface (9.2s)
  ✓   43 [chromium] › e2e/fixture-auth-flows.spec.ts:30:3 › player: session survives a hard refresh of a protected route (27.4s)
  ✓   44 [chromium] › e2e/fixture-auth-flows.spec.ts:19:3 › player2: signs in and reaches a protected surface (12.6s)
  ✓   45 [chromium] › e2e/fixture-auth-flows.spec.ts:30:3 › player2: session survives a hard refresh of a protected route (8.3s)
  ✓   46 [chromium] › e2e/fixture-auth-flows.spec.ts:45:1 › wrong password is rejected and keeps the visitor on /auth (3.6s)
  ✓   47 [chromium] › e2e/fixture-auth-flows.spec.ts:58:1 › signing out clears the session and protected routes redirect back to /auth (23.2s)
  ✓   48 [chromium] › e2e/fixture-auth-flows.spec.ts:74:1 › two fixture accounts hold independent sessions side by side (26.9s)
  ✘   49 [chromium] › e2e/fixture-family-flows.spec.ts:19:1 › adult host reaches the Parent Center from Settings (30.8s)
  -   50 [chromium] › e2e/fixture-family-flows.spec.ts:34:1 › Parent Center offers the invite-a-minor form to a guardian
  -   51 [chromium] › e2e/fixture-family-flows.spec.ts:45:1 › Parent Center shows no linked children for a fresh fixture guardian
  -   52 [chromium] › e2e/fixture-family-flows.spec.ts:55:1 › a child account is steered to the consent flow, not the guardian surface
  -   53 [chromium] › e2e/fixture-family-flows.spec.ts:73:1 › a pending child sees the waiting state and can re-check status
  -   54 [chromium] › e2e/fixture-family-flows.spec.ts:84:1 › guardian safety pages stay public and reachable while signed in
  ✓   55 [chromium] › e2e/google-vendor-rejection.spec.ts:38:5 › OAuth vendor rejection › google: signin vendor error surfaces actionable toast and preserves next (1.8s)
  ✘   56 [chromium] › e2e/google-vendor-rejection.spec.ts:75:5 › OAuth vendor rejection › google: signup vendor error preserves pending account type for onboarding (6.5s)
  ✓   57 [chromium] › e2e/google-vendor-rejection.spec.ts:38:5 › OAuth vendor rejection › apple: signin vendor error surfaces actionable toast and preserves next (1.7s)
  ✘   58 [chromium] › e2e/google-vendor-rejection.spec.ts:75:5 › OAuth vendor rejection › apple: signup vendor error preserves pending account type for onboarding (6.9s)
  ✓   59 [chromium] › e2e/google-vendor-rejection.spec.ts:125:3 › OAuth vendor rejection › negative control: non-vendor error uses plain toast (1.7s)
  ✓   60 [chromium] › e2e/host-name-deeplink.spec.ts:30:1 › cold deep-link and hard reload keep display_name as the host (39.3s)
  ✘   61 [chromium] › e2e/host-name-realtime.spec.ts:60:1 › realtime refetches never flicker the host name off display_name (15.4s)
  ✘   62 [chromium] › e2e/host-name-throttled.spec.ts:30:1 › host name stays on display_name under throttled profile reads (15.7s)
  ✓   63 [chromium] › e2e/image-orientation.spec.ts:73:5 › image orientation normalization › upright export for EXIF orientation 1 (o1.jpg) (600ms)
  ✓   64 [chromium] › e2e/image-orientation.spec.ts:73:5 › image orientation normalization › upright export for EXIF orientation 3 (o3.jpg) (340ms)
  ✘   65 [chromium] › e2e/image-orientation.spec.ts:73:5 › image orientation normalization › upright export for EXIF orientation 6 (o6.jpg) (911ms)
  ✘   66 [chromium] › e2e/image-orientation.spec.ts:73:5 › image orientation normalization › upright export for EXIF orientation 8 (o8.jpg) (1.3s)
  ✘   67 [chromium] › e2e/invite-deeplink-join-cta.spec.ts:47:1 › opening an invite deeplink to an unpaid game -> Join CTA keeps invite params on the detail page (10.5s)
  ✘   68 [chromium] › e2e/invite-deeplink-to-pay.spec.ts:38:1 › opening an invite deeplink lands on the game and the pay CTA routes to checkout (10.5s)
  ✘   69 [chromium] › e2e/invite-expired.spec.ts:42:1 › expired invite → renders Invite expired banner, CTA routes to /discover fallback (50.9s)
  ✘   70 [chromium] › e2e/invite-fallback-params.spec.ts:47:1 › invite=0 with `from` → fallback: no banner, no error, normal Join CTA (11.3s)
  ✘   71 [chromium] › e2e/invite-fallback-params.spec.ts:76:1 › `from` param alone (no invite) → fallback: no banner, no error (10.8s)
  ✘   72 [chromium] › e2e/invite-fallback-params.spec.ts:96:1 › invite=bogus with junk `from` → fallback: params stripped, no banner (11.1s)
  ✘   73 [chromium] › e2e/invite-fallback-params.spec.ts:122:1 › unknown gameId with invite params → routes to notFound fallback, not invite flow (10.4s)
  ✘   74 [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (non-numeric string) → Invite expired banner, CTA routes to /discover (20.6s)
  ✘   75 [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (negative timestamp) → Invite expired banner, CTA routes to /discover (10.6s)
  ✘   76 [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (zero) → Invite expired banner, CTA routes to /discover (10.5s)
  ✘   77 [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (NaN literal) → Invite expired banner, CTA routes to /discover (10.5s)
  ✘   78 [chromium] › e2e/invite-notification-cta.spec.ts:41:1 › tapping an invite notification opens the game with preserved invite params + CTA copy (45.8s)
  ✘   79 [chromium] › e2e/invite-pay-and-join-confirmation.spec.ts:50:1 › invite → Pay & join → confirmation with invite params preserved (36.9s)
  ✘   80 [chromium] › e2e/invite-pay-and-join-verified.spec.ts:48:1 › invite → Pay & join → host-verified → Confirmed on game page (invite params preserved) (54.6s)
  ✘   81 [chromium] › e2e/invite-pay-and-join.spec.ts:46:1 › tapping invite -> Pay & join CTA routes to checkout with preserved invite params (29.7s)
  ✘   82 [chromium] › e2e/invite-request-duplicate.spec.ts:51:1 › re-opening a valid invite after submitting blocks a second join request (10.5s)
  ✘   83 [chromium] › e2e/invite-request-happy-path.spec.ts:48:1 › well-formed invite → Request to join succeeds and shows pending UI with params preserved (10.5s)
  ✘   84 [chromium] › e2e/invite-request-idempotent-taps.spec.ts:47:1 › rapid taps on Request-to-join create exactly one pending row (server-side idempotency) (10.5s)
  ✘   85 [chromium] › e2e/invite-request-in-flight.spec.ts:49:1 › double-tapping Request to join while the first POST is in flight blocks the second submission (10.5s)
  ✘   86 [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (non-numeric string) → Request to join is blocked, no join_requests POST (10.5s)
  ✘   87 [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (negative timestamp) → Request to join is blocked, no join_requests POST (10.5s)
  ✘   88 [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (zero) → Request to join is blocked, no join_requests POST (10.5s)
  ✘   89 [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (NaN literal) → Request to join is blocked, no join_requests POST (10.6s)
  ✘   90 [chromium] › e2e/invite-request-network-error.spec.ts:43:1 › network error on first Request-to-join blocks a mid-flight second tap, then allows a successful retry (10.5s)
  ✘   91 [chromium] › e2e/invite-request-retry-after-error.spec.ts:41:1 › failed first join request can be retried and lands on pending UI with invite params preserved (10.4s)
  ✘   92 [chromium] › e2e/invite-request-retry-then-reload.spec.ts:42:1 › pending UI + invite params survive a reload after network-error retry (10.5s)
  ✘   93 [chromium] › e2e/invite-request-tampered.spec.ts:183:1 › invite tampered: missing `from` → CTA errors and no join_requests POST (1.0m)
  ✘   94 [chromium] › e2e/invite-request-tampered.spec.ts:189:1 › invite tampered: wrong `from` → CTA errors and no join_requests POST (38.0s)
  ✘   95 [chromium] › e2e/invite-request-to-join.spec.ts:50:1 › tapping invite -> Request to join CTA posts correct payload with preserved invite params (13.9s)
  ✘   96 [chromium] › e2e/join-cross-device-discover-spots.spec.ts:66:1 › Discover bottom card 'N spots' pill refreshes instantly when another device joins (27.3s)
  ✘   97 [chromium] › e2e/join-cross-device-roster.spec.ts:66:1 › another device joining updates roster + counters on feed, map, detail, profile (17.4s)
  ✘   98 [chromium] › e2e/join-realtime-cross-views.spec.ts:53:1 › joining from game detail updates feed, profile, and detail CTA in real time (21.3s)
  ✘   99 [chromium] › e2e/join-request-host-approval-realtime.spec.ts:50:1 › join request → host approval arrives via realtime and status flips live (15.6s)
  ✘  100 [chromium] › e2e/leave-host-pending-realtime.spec.ts:49:1 › host's pending list clears in realtime when the player's join_request is deleted (15.4s)
  ✘  101 [chromium] › e2e/leave-verified-payment-consistency.spec.ts:45:1 › leaving with a verified payment flips CTA, roster, and clears host-visible rows (15.5s)
  ✘  102 [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › iOS Safari (iPhone 13) › refresh on /feed stays on /feed (1.0m)
  ✘  103 [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › iOS Safari (iPhone 13) › refresh on /profile stays on /profile (1.0m)
  ✘  104 [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › iOS Safari (iPhone 13) › refresh on /notifications stays on /notifications (1.0m)
  ✘  105 [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › Android Chrome (Pixel 7) › refresh on /feed stays on /feed (1.0m)
  ✘  106 [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › Android Chrome (Pixel 7) › refresh on /profile stays on /profile (1.0m)
  ✓  107 [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › Android Chrome (Pixel 7) › refresh on /notifications stays on /notifications (51.2s)
  ✓  108 [chromium] › e2e/oauth-empty-referrer.spec.ts:93:5 › OAuth on /auth with empty document.referrer › google: NEW user → /onboarding/account-type with pending state preserved (2.8s)
  ✘  109 [chromium] › e2e/oauth-empty-referrer.spec.ts:121:5 › OAuth on /auth with empty document.referrer › google: RETURNING user with stashed next → next path (not "/") (15.8s)
  ✓  110 [chromium] › e2e/oauth-empty-referrer.spec.ts:139:5 › OAuth on /auth with empty document.referrer › google: RETURNING user without next → /feed fallback (2.9s)
  ✓  111 [chromium] › e2e/oauth-empty-referrer.spec.ts:93:5 › OAuth on /auth with empty document.referrer › apple: NEW user → /onboarding/account-type with pending state preserved (1.7s)
  ✘  112 [chromium] › e2e/oauth-empty-referrer.spec.ts:121:5 › OAuth on /auth with empty document.referrer › apple: RETURNING user with stashed next → next path (not "/") (15.6s)
  ✓  113 [chromium] › e2e/oauth-empty-referrer.spec.ts:139:5 › OAuth on /auth with empty document.referrer › apple: RETURNING user without next → /feed fallback (2.8s)
  ✘  114 [chromium] › e2e/oauth-from-auth-referrer.spec.ts:81:5 › OAuth from /auth with referrer '/' → onboarding picker › google: new user lands on /onboarding/account-type with pending state preserved (15.7s)
  ✘  115 [chromium] › e2e/oauth-from-auth-referrer.spec.ts:81:5 › OAuth from /auth with referrer '/' → onboarding picker › apple: new user lands on /onboarding/account-type with pending state preserved (15.9s)
  ✓  116 [chromium] › e2e/oauth-missing-provider-metadata.spec.ts:117:5 › OAuth return with missing provider metadata › google: backend guard routes user to onboarding with state preserved (2.3s)
  ✓  117 [chromium] › e2e/oauth-missing-provider-metadata.spec.ts:117:5 › OAuth return with missing provider metadata › apple: backend guard routes user to onboarding with state preserved (2.0s)
  ✓  118 [chromium] › e2e/oauth-new-user-onboarding.spec.ts:69:5 › OAuth new-user onboarding gate › google: brand-new user lands on /onboarding/account-type with state preserved (4.0s)
  ✓  119 [chromium] › e2e/oauth-new-user-onboarding.spec.ts:69:5 › OAuth new-user onboarding gate › apple: brand-new user lands on /onboarding/account-type with state preserved (3.5s)
  ✓  120 [chromium] › e2e/oauth-new-user-onboarding.spec.ts:139:3 › OAuth new-user onboarding gate › saved provider marker routes new OAuth user to onboarding even if session metadata is missing (1.9s)
  ✘  121 [chromium] › e2e/oauth-no-signin-flash-on-navigation.spec.ts:76:3 › no auth loader flash while navigating after google login (1.0m)
  ✘  122 [chromium] › e2e/oauth-no-signin-flash-on-navigation.spec.ts:76:3 › no auth loader flash while navigating after apple login (1.0m)
  ✓  123 [chromium] › e2e/oauth-no-signin-flash-on-navigation.spec.ts:106:1 › deep-linking between protected routes after OAuth keeps the app mounted (19.0s)
  ✘  124 [chromium] › e2e/oauth-non-root-referrer.spec.ts:88:5 › OAuth from /auth with non-root referrer › google: NEW user → /onboarding/account-type with pending state preserved (596ms)
  ✘  125 [chromium] › e2e/oauth-non-root-referrer.spec.ts:116:5 › OAuth from /auth with non-root referrer › google: RETURNING user → saved next path (not landing page) (813ms)
  ✘  126 [chromium] › e2e/oauth-non-root-referrer.spec.ts:88:5 › OAuth from /auth with non-root referrer › apple: NEW user → /onboarding/account-type with pending state preserved (673ms)
  ✘  127 [chromium] › e2e/oauth-non-root-referrer.spec.ts:116:5 › OAuth from /auth with non-root referrer › apple: RETURNING user → saved next path (not landing page) (1.1s)
  ✓  128 [chromium] › e2e/onboarding-null-account-type.spec.ts:83:5 › null account_type → account-type setup › route gate: visiting /feed with null account_type shows onboarding in place (7.8s)
  ✓  129 [chromium] › e2e/onboarding-null-account-type.spec.ts:83:5 › null account_type → account-type setup › route gate: visiting /profile with null account_type shows onboarding in place (7.6s)
  ✓  130 [chromium] › e2e/onboarding-null-account-type.spec.ts:83:5 › null account_type → account-type setup › route gate: visiting /notifications with null account_type shows onboarding in place (7.0s)
  ✓  131 [chromium] › e2e/onboarding-null-account-type.spec.ts:106:5 › null account_type → account-type setup › SIGNED_IN reconcile: google return with null account_type redirects to onboarding (2.5s)
  ✓  132 [chromium] › e2e/onboarding-null-account-type.spec.ts:106:5 › null account_type → account-type setup › SIGNED_IN reconcile: apple return with null account_type redirects to onboarding (2.1s)
  ✓  133 [chromium] › e2e/onboarding-null-account-type.spec.ts:153:3 › null account_type → account-type setup › onboarding page itself is NOT redirected away (1.7s)
  ✘  134 [chromium] › e2e/pay-approval-gate-flips.spec.ts:44:1 › pay page auto-flips from approval gate to payment picker on approval (11.0s)
  ✘  135 [chromium] › e2e/pay-approval-polling-fallback.spec.ts:43:1 › pay page flips from gate to picker via polling when realtime is unavailable (10.6s)
  ✘  136 [chromium] › e2e/pay-approval-realtime-only.spec.ts:49:1 › realtime approval flips pay page from gate to picker (no focus / reload) (10.6s)
  ✘  137 [chromium] › e2e/pay-blocked-until-approved.spec.ts:48:1 › payment submission is blocked while join request is unapproved (10.5s)
  ✘  138 [chromium] › e2e/pay-button-navigates.spec.ts:156:1 › Pay host button on a custom (sample) game routes to the pay screen (10.5s)
  ✘  139 [chromium] › e2e/pay-button-navigates.spec.ts:180:1 › Pay host still renders when optional status lookups hang (10.5s)
  ✘  140 [chromium] › e2e/pay-button-navigates.spec.ts:258:1 › Pay screen exits payment-options loading when payment settings hang (10.8s)
  ✘  141 [chromium] › e2e/pay-button-navigates.spec.ts:302:1 › Pay host button remains a pay link when local joined state is stale (10.5s)
  ✘  142 [chromium] › e2e/pay-button-navigates.spec.ts:329:1 › Payment status button with a pending submission still routes to the pay screen (10.5s)
  ✘  143 [chromium] › e2e/pay-button-navigates.spec.ts:360:1 › Payment rejected button routes back to the pay screen without deleting the attempt (10.6s)
  ✘  144 [chromium] › e2e/pay-button-navigates.spec.ts:391:1 › Pay host button on a hosted game routes to the pay screen (10.5s)
  ✘  145 [chromium] › e2e/pay-cta-reaches-success-or-retry.spec.ts:115:1 › Pay CTA reaches the ready pay screen when the backend responds (10.5s)
  ✘  146 [chromium] › e2e/pay-cta-reaches-success-or-retry.spec.ts:142:1 › Pay CTA surfaces retry affordance when the payment service hangs (10.6s)
  ✘  147 [chromium] › e2e/pay-only-after-approval-no-duplicates.spec.ts:42:1 › pay is blocked while pending; after approval exactly one submission is created (10.6s)
  ✘  148 [chromium] › e2e/pay-realtime-delayed-polling-no-duplicates.spec.ts:96:1 › delayed realtime: polling flips gate once, late frames create no duplicate submissions (10.6s)
  ✘  149 [chromium] › e2e/pay-rejected-confirmation.spec.ts:43:1 › payment rejected by host updates pay screen to rejected state (10.5s)
  ✘  150 [chromium] › e2e/pay-screen-no-cross-host-leak.spec.ts:91:1 › Pay screen for HOST_A never renders or requests HOST_B's payment methods (15.5s)
  ✘  151 [chromium] › e2e/pay-screen-rpc-and-empty-state.spec.ts:77:1 › Pay screen uses host-scoped RPC and renders empty state when no methods (15.5s)
  ✘  152 [chromium] › e2e/pay-submission-confirmation.spec.ts:40:1 › submitting mocked payment shows the post-payment confirmation UI (10.5s)
  ✘  153 [chromium] › e2e/pay-submission-declined.spec.ts:40:1 › declined submission shows actionable error and stays on the pay screen (10.6s)
  ✘  154 [chromium] › e2e/pay-verified-confirmation.spec.ts:42:1 › payment verified by host updates pay screen to confirmed state (10.5s)
  ✘  155 [chromium] › e2e/player-orgs-realtime.spec.ts:48:1 › player profile Organizations section updates in real time (1.0m)
  ✓  156 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › / fits every viewport width (4.8s)
  ✓  157 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /auth fits every viewport width (4.2s)
  ✓  158 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /terms fits every viewport width (49.1s)
  ✓  159 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /privacy fits every viewport width (10.3s)
  ✓  160 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /safety fits every viewport width (4.4s)
  ✓  161 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /trust-center fits every viewport width (4.7s)
  ✓  162 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /community-guidelines fits every viewport width (4.3s)
  ✓  163 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /contact fits every viewport width (4.2s)
  ✓  164 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /highlights fits every viewport width (4.6s)
  ✓  165 [chromium] › e2e/responsive-overflow.spec.ts:167:5 › no horizontal overflow › /reset-password fits every viewport width (4.3s)
  ✓  166 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /feed fits every viewport width (4.5s)
  ✓  167 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /players fits every viewport width (4.4s)
  ✓  168 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /teams fits every viewport width (4.3s)
  ✓  169 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /notifications fits every viewport width (4.2s)
  ✓  170 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /profile fits every viewport width (4.5s)
  ✓  171 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /create fits every viewport width (4.6s)
  ✓  172 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /settings fits every viewport width (4.4s)
  ✓  173 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /messages fits every viewport width (4.4s)
  ✓  174 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/privacy fits every viewport width (4.7s)
  ✓  175 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/notifications fits every viewport width (4.4s)
  ✓  176 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/data fits every viewport width (4.6s)
  ✓  177 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/security fits every viewport width (4.5s)
  ✓  178 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/legal fits every viewport width (5.1s)
  ✓  179 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/blocked fits every viewport width (4.4s)
  ✓  180 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /account/ai-privacy fits every viewport width (4.7s)
  ✓  181 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /profile/edit fits every viewport width (5.3s)
  ✓  182 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /parent fits every viewport width (4.6s)
  ✓  183 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /payments fits every viewport width (4.7s)
  ✓  184 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /reviews fits every viewport width (4.5s)
  ✓  185 [chromium] › e2e/responsive-overflow.spec.ts:180:5 › no horizontal overflow (signed in) › /orgs fits every viewport width (4.4s)
  ✘  186 [chromium] › e2e/roster-realtime-reconnect.spec.ts:114:1 › roster stays consistent across INSERT, DELETE, and reconnect (16.6s)
  ✘  187 [chromium] › e2e/social-login-identity-cases.spec.ts:159:5 › social login: identity-present vs identity-missing › identity-present (google): new user lands on onboarding with state preserved (22.0s)
  ✘  188 [chromium] › e2e/social-login-identity-cases.spec.ts:159:5 › social login: identity-present vs identity-missing › identity-present (apple): new user lands on onboarding with state preserved (22.0s)
  ✘  189 [chromium] › e2e/social-login-identity-cases.spec.ts:191:5 › social login: identity-present vs identity-missing › identity-missing (google): provider marker without a linked identity still routes to onboarding (22.6s)
  ✘  190 [chromium] › e2e/social-login-identity-cases.spec.ts:191:5 › social login: identity-present vs identity-missing › identity-missing (apple): provider marker without a linked identity still routes to onboarding (22.3s)
  ✓  191 [chromium] › e2e/social-login-identity-cases.spec.ts:218:3 › social login: identity-present vs identity-missing › identity-missing: no social identity and no account type still routes to onboarding (7.6s)
  ✓  192 [chromium] › e2e/social-login-identity-cases.spec.ts:247:5 › social login: identity-present vs identity-missing › identity-present (google), onboarding complete: saved next path is consumed (10.0s)
  ✘  193 [chromium] › e2e/social-login-identity-cases.spec.ts:247:5 › social login: identity-present vs identity-missing › identity-present (apple), onboarding complete: saved next path is consumed (21.8s)
  ✘  194 [chromium] › e2e/team-post-create.spec.ts:48:1 › team-post composer publishes a post end-to-end (1.0m)
  ✘  195 [chromium] › e2e/trainers-venue-filter-bookmark.spec.ts:48:1 › bookmarked venue+radius URL persists across tabs, profile, and booking sheet (1.0m)
  ✘  196 [chromium] › e2e/trainers-venue-filter.spec.ts:49:1 › venue filter narrows feed and persists across profile navigation (1.0m)
  ✘  197 [chromium] › e2e/trainers-venue-filter.spec.ts:95:1 › book session sheet opens with sticky venue from the feed (1.0m)
```

---

## Failure detail (97)

```
  1) [chromium] › e2e/add-player.spec.ts:108:1 › onboarding asks who the account is for

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /i'm playing$/i })
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /i'm playing$/i }) with timeout 15000ms
      - waiting for getByRole('button', { name: /i'm playing$/i })

      119 |   ).toBeVisible({ timeout: 15_000 });
      120 |
    > 121 |   await expect(page.getByRole("button", { name: /i'm playing$/i })).toBeVisible({
          |                                                                     ^
      122 |     timeout: 15_000,
      123 |   });
      124 |   await expect(
        at e2e/add-player.spec.ts:121:69

    test-results/add-player-onboarding-asks-who-the-account-is-for-chromium/test-failed-1.png

    Error Context: test-results/add-player-onboarding-asks-who-the-account-is-for-chromium/error-context.md

    test-results/add-player-onboarding-asks-who-the-account-is-for-chromium/trace.zip

  2) [chromium] › e2e/boot-recovery.spec.ts:58:1 › slow client boot is not interrupted by an automatic reload

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('heading', { name: /ballaCity/i }).first()
    Expected: visible
    Timeout: 18000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('heading', { name: /ballaCity/i }).first() with timeout 18000ms
      - waiting for getByRole('heading', { name: /ballaCity/i }).first()

      68 |
      69 |   await page.goto("/", { waitUntil: "domcontentloaded" });
    > 70 |   await expect(page.getByRole("heading", { name: /ballaCity/i }).first()).toBeVisible({
         |                                                                           ^
      71 |     timeout: 18_000,
      72 |   });
      73 |   expect(documentRequests, "a slow but healthy startup must not be reloaded").toBe(1);
        at e2e/boot-recovery.spec.ts:70:75

    test-results/boot-recovery-slow-client--31479-pted-by-an-automatic-reload-chromium/test-failed-1.png

    Error Context: test-results/boot-recovery-slow-client--31479-pted-by-an-automatic-reload-chromium/error-context.md

    test-results/boot-recovery-slow-client--31479-pted-by-an-automatic-reload-chromium/trace.zip

  3) [chromium] › e2e/desktop-refresh-protected.spec.ts:39:3 › refresh on /discover stays on /discover (desktop)

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/discover(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
    Timeout: 15000ms

    Call log:
      - Expect "toHaveURL" with timeout 15000ms
        33 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"

      62 |     await page.goto(route, { waitUntil: "domcontentloaded" });
      63 |     await page.waitForLoadState("networkidle").catch(() => {});
    > 64 |     await expect(page).toHaveURL(new RegExp(`${route}(?:[?#/].*)?$`), { timeout: 15_000 });
         |                        ^
      65 |
      66 |     // Hard reload — no in-memory React / router state survives.
      67 |     await page.reload({ waitUntil: "domcontentloaded" });
        at e2e/desktop-refresh-protected.spec.ts:64:24

    test-results/desktop-refresh-protected--ac5de--stays-on-discover-desktop--chromium/test-failed-1.png

    Error Context: test-results/desktop-refresh-protected--ac5de--stays-on-discover-desktop--chromium/error-context.md

    test-results/desktop-refresh-protected--ac5de--stays-on-discover-desktop--chromium/trace.zip

  4) [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /feed

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: /\bBasketball\b/ }).first()
        - locator resolved to <button data-tsd-source="/src/components/SportChips.tsx:43:11" class="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all border-border bg-surface text-foreground hover:border-lime/40">…</button>
      - attempting click action
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
        - waiting 20ms
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
          - waiting 100ms
        105 × waiting for element to be visible, enabled and stable
            - element is visible, enabled and stable
            - scrolling into view if needed
            - done scrolling
            - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
          - retrying click action
            - waiting 500ms

      55 |   const chip = page.getByRole("button", { name: new RegExp(`\\b${SPORT}\\b`) }).first();
      56 |   await chip.waitFor({ state: "visible", timeout: 15_000 });
    > 57 |   await chip.click();
         |              ^
      58 |   await expect(page).toHaveURL(/[?&]sport=Basketball/, { timeout: 5_000 });
      59 |   // Close the sheet if it's still open so it doesn't cover cards.
      60 |   await page.keyboard.press("Escape").catch(() => {});
        at pickSport (e2e/filterbar-persistence.spec.ts:57:14)
        at e2e/filterbar-persistence.spec.ts:82:5

    test-results/filterbar-persistence-Filt-59c5e-esults-and-persists-on-feed-chromium/test-failed-1.png

    Error Context: test-results/filterbar-persistence-Filt-59c5e-esults-and-persists-on-feed-chromium/error-context.md

    test-results/filterbar-persistence-Filt-59c5e-esults-and-persists-on-feed-chromium/trace.zip

  5) [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /players

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: /\bBasketball\b/ }).first()
        - locator resolved to <button data-tsd-source="/src/components/SportChips.tsx:43:11" class="shrink-0 inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-semibold transition-all border-border bg-surface text-foreground hover:border-lime/40">…</button>
      - attempting click action
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <p class="text-[11px] leading-relaxed text-muted-foreground" data-tsd-source="/src/components/legal/LegalConsent.tsx:79:7">These documents are placeholder drafts pending le…</p> from <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> subtree intercepts pointer events
        - retrying click action
        - waiting 20ms
        - waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <span class="text-foreground" data-tsd-source="/src/components/legal/LegalConsent.tsx:61:15">…</span> from <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> subtree intercepts pointer events
      2 × retrying click action
          - waiting 100ms
          - waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
      25 × retrying click action
           - waiting 500ms
           - waiting for element to be visible, enabled and stable
           - element is visible, enabled and stable
           - scrolling into view if needed
           - done scrolling
           - <p class="text-[11px] leading-relaxed text-muted-foreground" data-tsd-source="/src/components/legal/LegalConsent.tsx:79:7">These documents are placeholder drafts pending le…</p> from <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> subtree intercepts pointer events
         - retrying click action
           - waiting 500ms
           - waiting for element to be visible, enabled and stable
           - element is visible, enabled and stable
           - scrolling into view if needed
           - done scrolling
           - <span class="text-foreground" data-tsd-source="/src/components/legal/LegalConsent.tsx:61:15">…</span> from <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> subtree intercepts pointer events
         - retrying click action
           - waiting 500ms
           - waiting for element to be visible, enabled and stable
           - element is visible, enabled and stable
           - scrolling into view if needed
           - done scrolling
           - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
         - retrying click action
           - waiting 500ms
           - waiting for element to be visible, enabled and stable
           - element is visible, enabled and stable
           - scrolling into view if needed
           - done scrolling
           - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
      - retrying click action
        - waiting 500ms
        - waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <p class="text-[11px] leading-relaxed text-muted-foreground" data-tsd-source="/src/components/legal/LegalConsent.tsx:79:7">These documents are placeholder drafts pending le…</p> from <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> subtree intercepts pointer events
      - retrying click action
        - waiting 500ms
        - waiting for element to be visible, enabled and stable
        - element is visible, enabled and stable
        - scrolling into view if needed
        - done scrolling
        - <span class="text-foreground" data-tsd-source="/src/components/legal/LegalConsent.tsx:61:15">…</span> from <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> subtree intercepts pointer events
      - retrying click action
        - waiting 500ms

      55 |   const chip = page.getByRole("button", { name: new RegExp(`\\b${SPORT}\\b`) }).first();
      56 |   await chip.waitFor({ state: "visible", timeout: 15_000 });
    > 57 |   await chip.click();
         |              ^
      58 |   await expect(page).toHaveURL(/[?&]sport=Basketball/, { timeout: 5_000 });
      59 |   // Close the sheet if it's still open so it doesn't cover cards.
      60 |   await page.keyboard.press("Escape").catch(() => {});
        at pickSport (e2e/filterbar-persistence.spec.ts:57:14)
        at e2e/filterbar-persistence.spec.ts:82:5

    test-results/filterbar-persistence-Filt-737aa-lts-and-persists-on-players-chromium/test-failed-1.png

    Error Context: test-results/filterbar-persistence-Filt-737aa-lts-and-persists-on-players-chromium/error-context.md

    test-results/filterbar-persistence-Filt-737aa-lts-and-persists-on-players-chromium/trace.zip

  6) [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /teams

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: 'Filters' })
        - locator resolved to <button aria-label="Filters" aria-expanded="false" data-tsd-source="/src/components/FilterBar.tsx:67:9" class="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-surface border-border">…</button>
      - attempting click action
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
        - waiting 20ms
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
          - waiting 100ms
        102 × waiting for element to be visible, enabled and stable
            - element is visible, enabled and stable
            - scrolling into view if needed
            - done scrolling
            - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
          - retrying click action
            - waiting 500ms

      51 |   // them inside the Filters bottom sheet — open it first.
      52 |   if (route === "/teams" || route === "/trainers") {
    > 53 |     await page.getByRole("button", { name: "Filters" }).click();
         |                                                         ^
      54 |   }
      55 |   const chip = page.getByRole("button", { name: new RegExp(`\\b${SPORT}\\b`) }).first();
      56 |   await chip.waitFor({ state: "visible", timeout: 15_000 });
        at pickSport (e2e/filterbar-persistence.spec.ts:53:57)
        at e2e/filterbar-persistence.spec.ts:82:11

    test-results/filterbar-persistence-Filt-4dfde-sults-and-persists-on-teams-chromium/test-failed-1.png

    Error Context: test-results/filterbar-persistence-Filt-4dfde-sults-and-persists-on-teams-chromium/error-context.md

    test-results/filterbar-persistence-Filt-4dfde-sults-and-persists-on-teams-chromium/trace.zip

  7) [chromium] › e2e/filterbar-persistence.spec.ts:64:3 › FilterBar sport filter updates results and persists on /trainers

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: 'Filters' })
        - locator resolved to <button aria-label="Filters" aria-expanded="false" data-tsd-source="/src/components/FilterBar.tsx:67:9" class="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-surface border-border">…</button>
      - attempting click action
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
        - waiting 20ms
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
          - waiting 100ms
        99 × waiting for element to be visible, enabled and stable
           - element is visible, enabled and stable
           - scrolling into view if needed
           - done scrolling
           - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
         - retrying click action
           - waiting 500ms

      51 |   // them inside the Filters bottom sheet — open it first.
      52 |   if (route === "/teams" || route === "/trainers") {
    > 53 |     await page.getByRole("button", { name: "Filters" }).click();
         |                                                         ^
      54 |   }
      55 |   const chip = page.getByRole("button", { name: new RegExp(`\\b${SPORT}\\b`) }).first();
      56 |   await chip.waitFor({ state: "visible", timeout: 15_000 });
        at pickSport (e2e/filterbar-persistence.spec.ts:53:57)
        at e2e/filterbar-persistence.spec.ts:82:11

    test-results/filterbar-persistence-Filt-c3c41-ts-and-persists-on-trainers-chromium/test-failed-1.png

    Error Context: test-results/filterbar-persistence-Filt-c3c41-ts-and-persists-on-trainers-chromium/error-context.md

    test-results/filterbar-persistence-Filt-c3c41-ts-and-persists-on-trainers-chromium/trace.zip

  8) [chromium] › e2e/fixture-age-gated-flows.spec.ts:34:3 › hosting screen matches the teen_16_17 hosting policy

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('heading', { name: /Host a game/i })
    Expected: visible
    Timeout: 20000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('heading', { name: /Host a game/i }) with timeout 20000ms
      - waiting for getByRole('heading', { name: /Host a game/i })

      23 | async function openHosting(page: Page) {
      24 |   await page.goto("/create", { waitUntil: "domcontentloaded" });
    > 25 |   await expect(page.getByRole("heading", { name: /Host a game/i })).toBeVisible({
         |                                                                     ^
      26 |     timeout: 20_000,
      27 |   });
      28 | }
        at openHosting (e2e/fixture-age-gated-flows.spec.ts:25:69)
        at e2e/fixture-age-gated-flows.spec.ts:37:5

    test-results/fixture-age-gated-flows-ho-1ddf0-e-teen-16-17-hosting-policy-chromium/test-failed-1.png

    Error Context: test-results/fixture-age-gated-flows-ho-1ddf0-e-teen-16-17-hosting-policy-chromium/error-context.md

    test-results/fixture-age-gated-flows-ho-1ddf0-e-teen-16-17-hosting-policy-chromium/trace.zip

  9) [chromium] › e2e/fixture-family-flows.spec.ts:19:1 › adult host reaches the Parent Center from Settings

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('heading', { name: /Your child’s account|Your child's account/i })
    Expected: visible
    Timeout: 20000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('heading', { name: /Your child’s account|Your child's account/i }) with timeout 20000ms
      - waiting for getByRole('heading', { name: /Your child’s account|Your child's account/i })

      29 |   await expect(
      30 |     page.getByRole("heading", { name: /Your child’s account|Your child's account/i }),
    > 31 |   ).toBeVisible({ timeout: 20_000 });
         |     ^
      32 | });
      33 |
      34 | test("Parent Center offers the invite-a-minor form to a guardian", async ({ page }) => {
        at e2e/fixture-family-flows.spec.ts:31:5

    test-results/fixture-family-flows-adult-14f98-Parent-Center-from-Settings-chromium/test-failed-1.png

    Error Context: test-results/fixture-family-flows-adult-14f98-Parent-Center-from-Settings-chromium/error-context.md

    test-results/fixture-family-flows-adult-14f98-Parent-Center-from-Settings-chromium/trace.zip

  10) [chromium] › e2e/google-vendor-rejection.spec.ts:75:5 › OAuth vendor rejection › google: signup vendor error preserves pending account type for onboarding

    Error: expect(locator).toBeVisible() failed

    Locator: getByText(/rejected by the provider/i)
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText(/rejected by the provider/i) with timeout 5000ms
      - waiting for getByText(/rejected by the provider/i)

      102 |         await button.click();
      103 |
    > 104 |         await expect(page.getByText(/rejected by the provider/i)).toBeVisible({ timeout: 5_000 });
          |                                                                   ^
      105 |
      106 |         // Still on /auth, still in signup form (email field is present).
      107 |         await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
        at e2e/google-vendor-rejection.spec.ts:104:67

    test-results/google-vendor-rejection-OA-383fa-account-type-for-onboarding-chromium/test-failed-1.png

    Error Context: test-results/google-vendor-rejection-OA-383fa-account-type-for-onboarding-chromium/error-context.md

    test-results/google-vendor-rejection-OA-383fa-account-type-for-onboarding-chromium/trace.zip

  11) [chromium] › e2e/google-vendor-rejection.spec.ts:75:5 › OAuth vendor rejection › apple: signup vendor error preserves pending account type for onboarding

    Error: expect(locator).toBeVisible() failed

    Locator: getByText(/rejected by the provider/i)
    Expected: visible
    Timeout: 5000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText(/rejected by the provider/i) with timeout 5000ms
      - waiting for getByText(/rejected by the provider/i)

      102 |         await button.click();
      103 |
    > 104 |         await expect(page.getByText(/rejected by the provider/i)).toBeVisible({ timeout: 5_000 });
          |                                                                   ^
      105 |
      106 |         // Still on /auth, still in signup form (email field is present).
      107 |         await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
        at e2e/google-vendor-rejection.spec.ts:104:67

    test-results/google-vendor-rejection-OA-3419f-account-type-for-onboarding-chromium/test-failed-1.png

    Error Context: test-results/google-vendor-rejection-OA-3419f-account-type-for-onboarding-chromium/error-context.md

    test-results/google-vendor-rejection-OA-3419f-account-type-for-onboarding-chromium/trace.zip

  12) [chromium] › e2e/host-name-realtime.spec.ts:60:1 › realtime refetches never flicker the host name off display_name

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E Player').first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E Player').first() with timeout 15000ms
      - waiting for getByText('E2E Player').first()

       at helpers/seeded-host-game.ts:166

      164 |   timeout = 15_000,
      165 | ) {
    > 166 |   await expect(page.getByText(hostName, { exact: false }).first()).toBeVisible({ timeout });
          |                                                                    ^
      167 |   if (forbidden && forbidden !== hostName) {
      168 |     await expect(page.getByText(new RegExp(`^${forbidden}$`))).toHaveCount(0);
      169 |   }
        at expectHostName (e2e/helpers/seeded-host-game.ts:166:68)
        at e2e/host-name-realtime.spec.ts:70:9

    test-results/host-name-realtime-realtim-65885--host-name-off-display-name-chromium/test-failed-1.png

    Error Context: test-results/host-name-realtime-realtim-65885--host-name-off-display-name-chromium/error-context.md

    test-results/host-name-realtime-realtim-65885--host-name-off-display-name-chromium/trace.zip

  13) [chromium] › e2e/host-name-throttled.spec.ts:30:1 › host name stays on display_name under throttled profile reads

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E Player').first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E Player').first() with timeout 15000ms
      - waiting for getByText('E2E Player').first()

       at helpers/seeded-host-game.ts:166

      164 |   timeout = 15_000,
      165 | ) {
    > 166 |   await expect(page.getByText(hostName, { exact: false }).first()).toBeVisible({ timeout });
          |                                                                    ^
      167 |   if (forbidden && forbidden !== hostName) {
      168 |     await expect(page.getByText(new RegExp(`^${forbidden}$`))).toHaveCount(0);
      169 |   }
        at expectHostName (e2e/helpers/seeded-host-game.ts:166:68)
        at e2e/host-name-throttled.spec.ts:40:9

    test-results/host-name-throttled-host-n-f5806-der-throttled-profile-reads-chromium/test-failed-1.png

    Error Context: test-results/host-name-throttled-host-n-f5806-der-throttled-profile-reads-chromium/error-context.md

    test-results/host-name-throttled-host-n-f5806-der-throttled-profile-reads-chromium/trace.zip

  14) [chromium] › e2e/image-orientation.spec.ts:73:5 › image orientation normalization › upright export for EXIF orientation 6 (o6.jpg)

    Error: TL for orientation 6: got 255,255,0

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

      160 |
      161 |       // Corners should match the upright reference regardless of EXIF tag.
    > 162 |       expect(close(result.tl, EXPECTED.tl), `TL for orientation ${orientation}: got ${result.tl}`).toBe(true);
          |                                                                                                    ^
      163 |       expect(close(result.tr, EXPECTED.tr), `TR for orientation ${orientation}: got ${result.tr}`).toBe(true);
      164 |       expect(close(result.bl, EXPECTED.bl), `BL for orientation ${orientation}: got ${result.bl}`).toBe(true);
      165 |       expect(close(result.br, EXPECTED.br), `BR for orientation ${orientation}: got ${result.br}`).toBe(true);
        at e2e/image-orientation.spec.ts:162:100

    test-results/image-orientation-image-or-b83d8--EXIF-orientation-6-o6-jpg--chromium/test-failed-1.png

    Error Context: test-results/image-orientation-image-or-b83d8--EXIF-orientation-6-o6-jpg--chromium/error-context.md

    test-results/image-orientation-image-or-b83d8--EXIF-orientation-6-o6-jpg--chromium/trace.zip

  15) [chromium] › e2e/image-orientation.spec.ts:73:5 › image orientation normalization › upright export for EXIF orientation 8 (o8.jpg)

    Error: TL for orientation 8: got 255,255,0

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

      160 |
      161 |       // Corners should match the upright reference regardless of EXIF tag.
    > 162 |       expect(close(result.tl, EXPECTED.tl), `TL for orientation ${orientation}: got ${result.tl}`).toBe(true);
          |                                                                                                    ^
      163 |       expect(close(result.tr, EXPECTED.tr), `TR for orientation ${orientation}: got ${result.tr}`).toBe(true);
      164 |       expect(close(result.bl, EXPECTED.bl), `BL for orientation ${orientation}: got ${result.bl}`).toBe(true);
      165 |       expect(close(result.br, EXPECTED.br), `BR for orientation ${orientation}: got ${result.br}`).toBe(true);
        at e2e/image-orientation.spec.ts:162:100

    test-results/image-orientation-image-or-4b723--EXIF-orientation-8-o8-jpg--chromium/test-failed-1.png

    Error Context: test-results/image-orientation-image-or-4b723--EXIF-orientation-8-o8-jpg--chromium/error-context.md

    test-results/image-orientation-image-or-4b723--EXIF-orientation-8-o8-jpg--chromium/trace.zip

  16) [chromium] › e2e/invite-deeplink-join-cta.spec.ts:47:1 › opening an invite deeplink to an unpaid game -> Join CTA keeps invite params on the detail page

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      160 |     .filter({ hasText: /you're invited to this game/i })
      161 |     .first();
    > 162 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      163 |   await expect(banner).toContainText(/tap\s+[“"']?Join[”"']?\s+below/i);
      164 |   await expect(banner).not.toContainText(/Request to join/i);
      165 |   await expect(banner).not.toContainText(/Pay & join/i);
        at e2e/invite-deeplink-join-cta.spec.ts:162:24

    test-results/invite-deeplink-join-cta-o-bca91-e-params-on-the-detail-page-chromium/test-failed-1.png

    Error Context: test-results/invite-deeplink-join-cta-o-bca91-e-params-on-the-detail-page-chromium/error-context.md

    test-results/invite-deeplink-join-cta-o-bca91-e-params-on-the-detail-page-chromium/trace.zip

  17) [chromium] › e2e/invite-deeplink-to-pay.spec.ts:38:1 › opening an invite deeplink lands on the game and the pay CTA routes to checkout

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      117 |     .filter({ hasText: /you're invited to this game/i })
      118 |     .first();
    > 119 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      120 |   await expect(banner).toContainText(/Pay & join/i);
      121 |
      122 |   // Paid CTA — variant shows "Pay host · $X" (rendered as a link on paid games).
        at e2e/invite-deeplink-to-pay.spec.ts:119:24

    test-results/invite-deeplink-to-pay-ope-ea462--pay-CTA-routes-to-checkout-chromium/test-failed-1.png

    Error Context: test-results/invite-deeplink-to-pay-ope-ea462--pay-CTA-routes-to-checkout-chromium/error-context.md

    test-results/invite-deeplink-to-pay-ope-ea462--pay-CTA-routes-to-checkout-chromium/trace.zip

  18) [chromium] › e2e/invite-expired.spec.ts:42:1 › expired invite → renders Invite expired banner, CTA routes to /discover fallback

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E expired invite 1789108224707').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E expired invite 1789108224707').first() with timeout 10000ms
      - waiting for getByText('E2E expired invite 1789108224707').first()

      82 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      83 |   const item = page.getByText(title, { exact: false }).first();
    > 84 |   await expect(item).toBeVisible({ timeout: 10_000 });
         |                      ^
      85 |   await item.click();
      86 |
      87 |   // URL preserves the invite/from/exp params on the game detail page.
        at e2e/invite-expired.spec.ts:84:22

    test-results/invite-expired-expired-inv-1b165-routes-to-discover-fallback-chromium/test-failed-1.png

    Error Context: test-results/invite-expired-expired-inv-1b165-routes-to-discover-fallback-chromium/error-context.md

    test-results/invite-expired-expired-inv-1b165-routes-to-discover-fallback-chromium/trace.zip

  19) [chromium] › e2e/invite-fallback-params.spec.ts:47:1 › invite=0 with `from` → fallback: no banner, no error, normal Join CTA

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /^join(\s|·|$)/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /^join(\s|·|$)/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /^join(\s|·|$)/i }).first()

      64 |   // Normal CTA renders (g1 is free + no-approval → "Join").
      65 |   const cta = page.getByRole("button", { name: /^join(\s|·|$)/i }).first();
    > 66 |   await expect(cta).toBeVisible({ timeout: 10_000 });
         |                     ^
      67 |
      68 |   // validateSearch drops `invite=0` (only "1"/1/true count). `from` alone
      69 |   // may or may not survive per implementation — either way, invite mode is off.
        at e2e/invite-fallback-params.spec.ts:66:21

    test-results/invite-fallback-params-inv-8ce67-er-no-error-normal-Join-CTA-chromium/test-failed-1.png

    Error Context: test-results/invite-fallback-params-inv-8ce67-er-no-error-normal-Join-CTA-chromium/error-context.md

    test-results/invite-fallback-params-inv-8ce67-er-no-error-normal-Join-CTA-chromium/trace.zip

  20) [chromium] › e2e/invite-fallback-params.spec.ts:76:1 › `from` param alone (no invite) → fallback: no banner, no error

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /^join(\s|·|$)/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /^join(\s|·|$)/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /^join(\s|·|$)/i }).first()

      86 |
      87 |   const cta = page.getByRole("button", { name: /^join(\s|·|$)/i }).first();
    > 88 |   await expect(cta).toBeVisible({ timeout: 10_000 });
         |                     ^
      89 |
      90 |   const url = new URL(page.url());
      91 |   expect(url.searchParams.get("invite")).not.toBe("1");
        at e2e/invite-fallback-params.spec.ts:88:21

    test-results/invite-fallback-params--fr-fb786-fallback-no-banner-no-error-chromium/test-failed-1.png

    Error Context: test-results/invite-fallback-params--fr-fb786-fallback-no-banner-no-error-chromium/error-context.md

    test-results/invite-fallback-params--fr-fb786-fallback-no-banner-no-error-chromium/trace.zip

  21) [chromium] › e2e/invite-fallback-params.spec.ts:96:1 › invite=bogus with junk `from` → fallback: params stripped, no banner

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /^join(\s|·|$)/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /^join(\s|·|$)/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /^join(\s|·|$)/i }).first()

      115 |
      116 |   const cta = page.getByRole("button", { name: /^join(\s|·|$)/i }).first();
    > 117 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      118 |
      119 |   await ctx.close();
      120 | });
        at e2e/invite-fallback-params.spec.ts:117:21

    test-results/invite-fallback-params-inv-e5355-k-params-stripped-no-banner-chromium/test-failed-1.png

    Error Context: test-results/invite-fallback-params-inv-e5355-k-params-stripped-no-banner-chromium/error-context.md

    test-results/invite-fallback-params-inv-e5355-k-params-stripped-no-banner-chromium/trace.zip

  22) [chromium] › e2e/invite-fallback-params.spec.ts:122:1 › unknown gameId with invite params → routes to notFound fallback, not invite flow

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('heading', { name: /game not found/i })
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('heading', { name: /game not found/i }) with timeout 10000ms
      - waiting for getByRole('heading', { name: /game not found/i })

      133 |   // The route's notFoundComponent renders "Game not found" with a Back to feed link.
      134 |   const notFound = page.getByRole("heading", { name: /game not found/i });
    > 135 |   await expect(notFound).toBeVisible({ timeout: 10_000 });
          |                          ^
      136 |
      137 |   // No invite banner and no tampering toast on the fallback page.
      138 |   await assertNoInviteBanner(page);
        at e2e/invite-fallback-params.spec.ts:135:26

    test-results/invite-fallback-params-unk-13902-nd-fallback-not-invite-flow-chromium/test-failed-1.png

    Error Context: test-results/invite-fallback-params-unk-13902-nd-fallback-not-invite-flow-chromium/error-context.md

    test-results/invite-fallback-params-unk-13902-nd-fallback-not-invite-flow-chromium/trace.zip

  23) [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (non-numeric string) → Invite expired banner, CTA routes to /discover

    TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
    =========================== logs ===========================
    waiting for navigation until "load"
    ============================================================

      80 |     // Following the CTA lands on /discover.
      81 |     await cta.click();
    > 82 |     await page.waitForURL((u) => u.pathname === "/discover", { timeout: 10_000 });
         |                ^
      83 |
      84 |     expect(writeAttempts, "malformed-exp invite must not trigger join/payment writes").toEqual([]);
      85 |
        at e2e/invite-malformed-exp.spec.ts:82:16

    test-results/invite-malformed-exp-malfo-f8488-nner-CTA-routes-to-discover-chromium/test-failed-1.png

    Error Context: test-results/invite-malformed-exp-malfo-f8488-nner-CTA-routes-to-discover-chromium/error-context.md

    test-results/invite-malformed-exp-malfo-f8488-nner-CTA-routes-to-discover-chromium/trace.zip

  24) [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (negative timestamp) → Invite expired banner, CTA routes to /discover

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      66 |     // Expired banner renders instead of the normal "You're invited" one.
      67 |     const expired = page.getByTestId("invite-expired-banner");
    > 68 |     await expect(expired).toBeVisible({ timeout: 10_000 });
         |                           ^
      69 |     await expect(expired).toContainText(/invite expired/i);
      70 |
      71 |     const normalBanner = page
        at e2e/invite-malformed-exp.spec.ts:68:27

    test-results/invite-malformed-exp-malfo-4d75e-nner-CTA-routes-to-discover-chromium/test-failed-1.png

    Error Context: test-results/invite-malformed-exp-malfo-4d75e-nner-CTA-routes-to-discover-chromium/error-context.md

    test-results/invite-malformed-exp-malfo-4d75e-nner-CTA-routes-to-discover-chromium/trace.zip

  25) [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (zero) → Invite expired banner, CTA routes to /discover

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      66 |     // Expired banner renders instead of the normal "You're invited" one.
      67 |     const expired = page.getByTestId("invite-expired-banner");
    > 68 |     await expect(expired).toBeVisible({ timeout: 10_000 });
         |                           ^
      69 |     await expect(expired).toContainText(/invite expired/i);
      70 |
      71 |     const normalBanner = page
        at e2e/invite-malformed-exp.spec.ts:68:27

    test-results/invite-malformed-exp-malfo-dea80-nner-CTA-routes-to-discover-chromium/test-failed-1.png

    Error Context: test-results/invite-malformed-exp-malfo-dea80-nner-CTA-routes-to-discover-chromium/error-context.md

    test-results/invite-malformed-exp-malfo-dea80-nner-CTA-routes-to-discover-chromium/trace.zip

  26) [chromium] › e2e/invite-malformed-exp.spec.ts:40:3 › malformed exp (NaN literal) → Invite expired banner, CTA routes to /discover

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      66 |     // Expired banner renders instead of the normal "You're invited" one.
      67 |     const expired = page.getByTestId("invite-expired-banner");
    > 68 |     await expect(expired).toBeVisible({ timeout: 10_000 });
         |                           ^
      69 |     await expect(expired).toContainText(/invite expired/i);
      70 |
      71 |     const normalBanner = page
        at e2e/invite-malformed-exp.spec.ts:68:27

    test-results/invite-malformed-exp-malfo-685d2-nner-CTA-routes-to-discover-chromium/test-failed-1.png

    Error Context: test-results/invite-malformed-exp-malfo-685d2-nner-CTA-routes-to-discover-chromium/error-context.md

    test-results/invite-malformed-exp-malfo-685d2-nner-CTA-routes-to-discover-chromium/trace.zip

  27) [chromium] › e2e/invite-notification-cta.spec.ts:41:1 › tapping an invite notification opens the game with preserved invite params + CTA copy

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E invite 1789108377419').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E invite 1789108377419').first() with timeout 10000ms
      - waiting for getByText('E2E invite 1789108377419').first()

      73 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      74 |   const item = page.getByText(title, { exact: false }).first();
    > 75 |   await expect(item).toBeVisible({ timeout: 10_000 });
         |                      ^
      76 |   await item.click();
      77 |
      78 |   // URL must preserve both invite params exactly.
        at e2e/invite-notification-cta.spec.ts:75:22

    test-results/invite-notification-cta-ta-6411f-rved-invite-params-CTA-copy-chromium/test-failed-1.png

    Error Context: test-results/invite-notification-cta-ta-6411f-rved-invite-params-CTA-copy-chromium/error-context.md

    test-results/invite-notification-cta-ta-6411f-rved-invite-params-CTA-copy-chromium/trace.zip

  28) [chromium] › e2e/invite-pay-and-join-confirmation.spec.ts:50:1 › invite → Pay & join → confirmation with invite params preserved

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E pay-and-join confirmation 1789108424334').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E pay-and-join confirmation 1789108424334').first() with timeout 10000ms
      - waiting for getByText('E2E pay-and-join confirmation 1789108424334').first()

      185 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      186 |   const item = page.getByText(notifTitle, { exact: false }).first();
    > 187 |   await expect(item).toBeVisible({ timeout: 10_000 });
          |                      ^
      188 |   await item.click();
      189 |
      190 |   // Landing on game detail with both invite params preserved.
        at e2e/invite-pay-and-join-confirmation.spec.ts:187:22

    test-results/invite-pay-and-join-confir-1a9ef-ith-invite-params-preserved-chromium/test-failed-1.png

    Error Context: test-results/invite-pay-and-join-confir-1a9ef-ith-invite-params-preserved-chromium/error-context.md

    test-results/invite-pay-and-join-confir-1a9ef-ith-invite-params-preserved-chromium/trace.zip

  29) [chromium] › e2e/invite-pay-and-join-verified.spec.ts:48:1 › invite → Pay & join → host-verified → Confirmed on game page (invite params preserved)

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E pay-join-verified 1789108462064').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E pay-join-verified 1789108462064').first() with timeout 10000ms
      - waiting for getByText('E2E pay-join-verified 1789108462064').first()

      188 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      189 |   const item = page.getByText(notifTitle, { exact: false }).first();
    > 190 |   await expect(item).toBeVisible({ timeout: 10_000 });
          |                      ^
      191 |   await item.click();
      192 |
      193 |   await page.waitForURL(
        at e2e/invite-pay-and-join-verified.spec.ts:190:22

    test-results/invite-pay-and-join-verifi-3693c-ge-invite-params-preserved--chromium/test-failed-1.png

    Error Context: test-results/invite-pay-and-join-verifi-3693c-ge-invite-params-preserved--chromium/error-context.md

    test-results/invite-pay-and-join-verifi-3693c-ge-invite-params-preserved--chromium/trace.zip

  30) [chromium] › e2e/invite-pay-and-join.spec.ts:46:1 › tapping invite -> Pay & join CTA routes to checkout with preserved invite params

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E pay-and-join invite 1789108517943').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E pay-and-join invite 1789108517943').first() with timeout 10000ms
      - waiting for getByText('E2E pay-and-join invite 1789108517943').first()

      129 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      130 |   const item = page.getByText(notifTitle, { exact: false }).first();
    > 131 |   await expect(item).toBeVisible({ timeout: 10_000 });
          |                      ^
      132 |   await item.click();
      133 |
      134 |   // URL preserves both invite params on landing.
        at e2e/invite-pay-and-join.spec.ts:131:22

    test-results/invite-pay-and-join-tappin-35d9d-ith-preserved-invite-params-chromium/test-failed-1.png

    Error Context: test-results/invite-pay-and-join-tappin-35d9d-ith-preserved-invite-params-chromium/error-context.md

    test-results/invite-pay-and-join-tappin-35d9d-ith-preserved-invite-params-chromium/trace.zip

  31) [chromium] › e2e/invite-request-duplicate.spec.ts:51:1 › re-opening a valid invite after submitting blocks a second join request

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      148 |     .filter({ hasText: /you're invited to this game/i })
      149 |     .first();
    > 150 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      151 |
      152 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
      153 |   await expect(cta).toBeVisible({ timeout: 10_000 });
        at e2e/invite-request-duplicate.spec.ts:150:24

    test-results/invite-request-duplicate-r-7f05a-locks-a-second-join-request-chromium/test-failed-1.png

    Error Context: test-results/invite-request-duplicate-r-7f05a-locks-a-second-join-request-chromium/error-context.md

    test-results/invite-request-duplicate-r-7f05a-locks-a-second-join-request-chromium/trace.zip

  32) [chromium] › e2e/invite-request-happy-path.spec.ts:48:1 › well-formed invite → Request to join succeeds and shows pending UI with params preserved

    TimeoutError: page.waitForURL: Timeout 10000ms exceeded.
    =========================== logs ===========================
    waiting for navigation until "load"
      navigated to "http://localhost:8080/games/g2?invite=true&from=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&exp=1789194959783"
    ============================================================

      144 |   });
      145 |
    > 146 |   await page.waitForURL(
          |              ^
      147 |     (u) =>
      148 |       u.pathname === `/games/${GAME_ID}` &&
      149 |       u.searchParams.get("invite") === "1" &&
        at e2e/invite-request-happy-path.spec.ts:146:14

    test-results/invite-request-happy-path--8e259-ng-UI-with-params-preserved-chromium/test-failed-1.png

    Error Context: test-results/invite-request-happy-path--8e259-ng-UI-with-params-preserved-chromium/error-context.md

    test-results/invite-request-happy-path--8e259-ng-UI-with-params-preserved-chromium/trace.zip

  33) [chromium] › e2e/invite-request-idempotent-taps.spec.ts:47:1 › rapid taps on Request-to-join create exactly one pending row (server-side idempotency)

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      182 |     .filter({ hasText: /you're invited to this game/i })
      183 |     .first();
    > 184 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      185 |
      186 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
      187 |   await expect(cta).toBeVisible({ timeout: 10_000 });
        at e2e/invite-request-idempotent-taps.spec.ts:184:24

    test-results/invite-request-idempotent--4b683-ow-server-side-idempotency--chromium/test-failed-1.png

    Error Context: test-results/invite-request-idempotent--4b683-ow-server-side-idempotency--chromium/error-context.md

    test-results/invite-request-idempotent--4b683-ow-server-side-idempotency--chromium/trace.zip

  34) [chromium] › e2e/invite-request-in-flight.spec.ts:49:1 › double-tapping Request to join while the first POST is in flight blocks the second submission

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      147 |     .filter({ hasText: /you're invited to this game/i })
      148 |     .first();
    > 149 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      150 |
      151 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
      152 |   await expect(cta).toBeVisible({ timeout: 10_000 });
        at e2e/invite-request-in-flight.spec.ts:149:24

    test-results/invite-request-in-flight-d-d9f75-locks-the-second-submission-chromium/test-failed-1.png

    Error Context: test-results/invite-request-in-flight-d-d9f75-locks-the-second-submission-chromium/error-context.md

    test-results/invite-request-in-flight-d-d9f75-locks-the-second-submission-chromium/trace.zip

  35) [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (non-numeric string) → Request to join is blocked, no join_requests POST

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      119 |     // Expired error state is what the viewer sees — not the normal invite banner.
      120 |     const expired = page.getByTestId("invite-expired-banner");
    > 121 |     await expect(expired).toBeVisible({ timeout: 10_000 });
          |                           ^
      122 |     await expect(expired).toContainText(/invite expired/i);
      123 |
      124 |     const normalBanner = page
        at e2e/invite-request-malformed-exp.spec.ts:121:27

    test-results/invite-request-malformed-e-a7fbf-ocked-no-join-requests-POST-chromium/test-failed-1.png

    Error Context: test-results/invite-request-malformed-e-a7fbf-ocked-no-join-requests-POST-chromium/error-context.md

    test-results/invite-request-malformed-e-a7fbf-ocked-no-join-requests-POST-chromium/trace.zip

  36) [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (negative timestamp) → Request to join is blocked, no join_requests POST

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      119 |     // Expired error state is what the viewer sees — not the normal invite banner.
      120 |     const expired = page.getByTestId("invite-expired-banner");
    > 121 |     await expect(expired).toBeVisible({ timeout: 10_000 });
          |                           ^
      122 |     await expect(expired).toContainText(/invite expired/i);
      123 |
      124 |     const normalBanner = page
        at e2e/invite-request-malformed-exp.spec.ts:121:27

    test-results/invite-request-malformed-e-a2109-ocked-no-join-requests-POST-chromium/test-failed-1.png

    Error Context: test-results/invite-request-malformed-e-a2109-ocked-no-join-requests-POST-chromium/error-context.md

    test-results/invite-request-malformed-e-a2109-ocked-no-join-requests-POST-chromium/trace.zip

  37) [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (zero) → Request to join is blocked, no join_requests POST

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      119 |     // Expired error state is what the viewer sees — not the normal invite banner.
      120 |     const expired = page.getByTestId("invite-expired-banner");
    > 121 |     await expect(expired).toBeVisible({ timeout: 10_000 });
          |                           ^
      122 |     await expect(expired).toContainText(/invite expired/i);
      123 |
      124 |     const normalBanner = page
        at e2e/invite-request-malformed-exp.spec.ts:121:27

    test-results/invite-request-malformed-e-6df8e-ocked-no-join-requests-POST-chromium/test-failed-1.png

    Error Context: test-results/invite-request-malformed-e-6df8e-ocked-no-join-requests-POST-chromium/error-context.md

    test-results/invite-request-malformed-e-6df8e-ocked-no-join-requests-POST-chromium/trace.zip

  38) [chromium] › e2e/invite-request-malformed-exp.spec.ts:101:3 › malformed exp (NaN literal) → Request to join is blocked, no join_requests POST

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('invite-expired-banner')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('invite-expired-banner') with timeout 10000ms
      - waiting for getByTestId('invite-expired-banner')

      119 |     // Expired error state is what the viewer sees — not the normal invite banner.
      120 |     const expired = page.getByTestId("invite-expired-banner");
    > 121 |     await expect(expired).toBeVisible({ timeout: 10_000 });
          |                           ^
      122 |     await expect(expired).toContainText(/invite expired/i);
      123 |
      124 |     const normalBanner = page
        at e2e/invite-request-malformed-exp.spec.ts:121:27

    test-results/invite-request-malformed-e-40c5d-ocked-no-join-requests-POST-chromium/test-failed-1.png

    Error Context: test-results/invite-request-malformed-e-40c5d-ocked-no-join-requests-POST-chromium/error-context.md

    test-results/invite-request-malformed-e-40c5d-ocked-no-join-requests-POST-chromium/trace.zip

  39) [chromium] › e2e/invite-request-network-error.spec.ts:43:1 › network error on first Request-to-join blocks a mid-flight second tap, then allows a successful retry

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      148 |     .filter({ hasText: /you're invited to this game/i })
      149 |     .first();
    > 150 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      151 |
      152 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
      153 |   await expect(cta).toBeVisible({ timeout: 10_000 });
        at e2e/invite-request-network-error.spec.ts:150:24

    test-results/invite-request-network-err-80b76-n-allows-a-successful-retry-chromium/test-failed-1.png

    Error Context: test-results/invite-request-network-err-80b76-n-allows-a-successful-retry-chromium/error-context.md

    test-results/invite-request-network-err-80b76-n-allows-a-successful-retry-chromium/trace.zip

  40) [chromium] › e2e/invite-request-retry-after-error.spec.ts:41:1 › failed first join request can be retried and lands on pending UI with invite params preserved

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      143 |     .filter({ hasText: /you're invited to this game/i })
      144 |     .first();
    > 145 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      146 |
      147 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
      148 |   await expect(cta).toBeVisible({ timeout: 10_000 });
        at e2e/invite-request-retry-after-error.spec.ts:145:24

    test-results/invite-request-retry-after-82898-ith-invite-params-preserved-chromium/test-failed-1.png

    Error Context: test-results/invite-request-retry-after-82898-ith-invite-params-preserved-chromium/error-context.md

    test-results/invite-request-retry-after-82898-ith-invite-params-preserved-chromium/trace.zip

  41) [chromium] › e2e/invite-request-retry-then-reload.spec.ts:42:1 › pending UI + invite params survive a reload after network-error retry

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('status').filter({ hasText: /you're invited to this game/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('status').filter({ hasText: /you're invited to this game/i }).first() with timeout 10000ms
      - waiting for getByRole('status').filter({ hasText: /you're invited to this game/i }).first()

      140 |     .filter({ hasText: /you're invited to this game/i })
      141 |     .first();
    > 142 |   await expect(banner).toBeVisible({ timeout: 10_000 });
          |                        ^
      143 |
      144 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
      145 |   await expect(cta).toBeVisible({ timeout: 10_000 });
        at e2e/invite-request-retry-then-reload.spec.ts:142:24

    test-results/invite-request-retry-then--b742b-d-after-network-error-retry-chromium/test-failed-1.png

    Error Context: test-results/invite-request-retry-then--b742b-d-after-network-error-retry-chromium/error-context.md

    test-results/invite-request-retry-then--b742b-d-after-network-error-retry-chromium/trace.zip

  42) [chromium] › e2e/invite-request-tampered.spec.ts:183:1 › invite tampered: missing `from` → CTA errors and no join_requests POST

    Test timeout of 60000ms exceeded.

    Error: page.evaluate: Test ended.

      106 |
      107 | async function seedInvite(page: Page, userId: string, title: string, link: string) {
    > 108 |   const res = await page.evaluate(
          |                          ^
      109 |     async ({ userId, title, link }) => {
      110 |       const mod = await import("/src/integrations/supabase/client.ts");
      111 |       const { error } = await mod.supabase.from("notifications").insert({
        at seedInvite (e2e/invite-request-tampered.spec.ts:108:26)
        at runTamperedCase (e2e/invite-request-tampered.spec.ts:142:9)
        at e2e/invite-request-tampered.spec.ts:186:3

    test-results/invite-request-tampered-in-11693-s-and-no-join-requests-POST-chromium/test-failed-1.png

    Error Context: test-results/invite-request-tampered-in-11693-s-and-no-join-requests-POST-chromium/error-context.md

    test-results/invite-request-tampered-in-11693-s-and-no-join-requests-POST-chromium/trace.zip

  43) [chromium] › e2e/invite-request-tampered.spec.ts:189:1 › invite tampered: wrong `from` → CTA errors and no join_requests POST

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E tampered invite [wrong-from] 1789108732709').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E tampered invite [wrong-from] 1789108732709').first() with timeout 10000ms
      - waiting for getByText('E2E tampered invite [wrong-from] 1789108732709').first()

      145 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      146 |   const item = page.getByText(notifTitle, { exact: false }).first();
    > 147 |   await expect(item).toBeVisible({ timeout: 10_000 });
          |                      ^
      148 |   await item.click();
      149 |
      150 |   // Land on game with the tampered/missing params exactly as encoded.
        at runTamperedCase (e2e/invite-request-tampered.spec.ts:147:22)
        at e2e/invite-request-tampered.spec.ts:192:3

    test-results/invite-request-tampered-in-45ede-s-and-no-join-requests-POST-chromium/test-failed-1.png

    Error Context: test-results/invite-request-tampered-in-45ede-s-and-no-join-requests-POST-chromium/error-context.md

    test-results/invite-request-tampered-in-45ede-s-and-no-join-requests-POST-chromium/trace.zip

  44) [chromium] › e2e/invite-request-to-join.spec.ts:50:1 › tapping invite -> Request to join CTA posts correct payload with preserved invite params

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('E2E request-to-join invite 1789108772234').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('E2E request-to-join invite 1789108772234').first() with timeout 10000ms
      - waiting for getByText('E2E request-to-join invite 1789108772234').first()

      159 |   await page.goto("/notifications", { waitUntil: "domcontentloaded" });
      160 |   const item = page.getByText(notifTitle, { exact: false }).first();
    > 161 |   await expect(item).toBeVisible({ timeout: 10_000 });
          |                      ^
      162 |   await item.click();
      163 |
      164 |   // URL preserves both invite params on landing.
        at e2e/invite-request-to-join.spec.ts:161:22

    test-results/invite-request-to-join-tap-e5279-ith-preserved-invite-params-chromium/test-failed-1.png

    Error Context: test-results/invite-request-to-join-tap-e5279-ith-preserved-invite-params-chromium/error-context.md

    test-results/invite-request-to-join-tap-e5279-ith-preserved-invite-params-chromium/trace.zip

  45) [chromium] › e2e/join-cross-device-discover-spots.spec.ts:66:1 › Discover bottom card 'N spots' pill refreshes instantly when another device joins

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /join free/i }).first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /join free/i }).first() with timeout 15000ms
      - waiting for getByRole('button', { name: /join free/i }).first()

      129 |
      130 |     const joinCta = bDetail.getByRole("button", { name: /join free/i }).first();
    > 131 |     await expect(joinCta).toBeVisible({ timeout: 15_000 });
          |                           ^
      132 |     await joinCta.click();
      133 |
      134 |     // Device B flips locally.
        at e2e/join-cross-device-discover-spots.spec.ts:131:27

    test-results/join-cross-device-discover-3ba89-y-when-another-device-joins-chromium/test-failed-1.png

    test-results/join-cross-device-discover-3ba89-y-when-another-device-joins-chromium/test-failed-2.png

    Error Context: test-results/join-cross-device-discover-3ba89-y-when-another-device-joins-chromium/error-context.md

    test-results/join-cross-device-discover-3ba89-y-when-another-device-joins-chromium/trace.zip

  46) [chromium] › e2e/join-cross-device-roster.spec.ts:66:1 › another device joining updates roster + counters on feed, map, detail, profile

    Error: expect(locator).toBeVisible() failed

    Locator: getByText(/Roster \(\d+\/\d+\)/).first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText(/Roster \(\d+\/\d+\)/).first() with timeout 15000ms
      - waiting for getByText(/Roster \(\d+\/\d+\)/).first()

       95 |
       96 |     // Wait for detail roster to hydrate on device A.
    >  97 |     await expect(aDetail.getByText(/Roster \(\d+\/\d+\)/).first()).toBeVisible({
          |                                                                    ^
       98 |       timeout: 15_000,
       99 |     });
      100 |     const beforeRoster = await readSpotsFromDetail(aDetail);
        at e2e/join-cross-device-roster.spec.ts:97:68

    test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/test-failed-1.png

    test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/test-failed-2.png

    test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/test-failed-3.png

    test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/test-failed-4.png

    test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/test-failed-5.png

    Error Context: test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/error-context.md

    test-results/join-cross-device-roster-a-7a307--on-feed-map-detail-profile-chromium/trace.zip

  47) [chromium] › e2e/join-realtime-cross-views.spec.ts:53:1 › joining from game detail updates feed, profile, and detail CTA in real time

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /join free|you're in|full/i }).first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /join free|you're in|full/i }).first() with timeout 15000ms
      - waiting for getByRole('button', { name: /join free|you're in|full/i }).first()
        - waiting for "http://localhost:8080/games/g1" navigation to finish...

      79 |       .getByRole("button", { name: /join free|you're in|full/i })
      80 |       .first();
    > 81 |     await expect(joinCta).toBeVisible({ timeout: 15_000 });
         |                           ^
      82 |     await expect(joinCta).toContainText(/join free/i);
      83 |
      84 |     // Feed card for this game shouldn't show a "Joined" pill yet. Cards
        at e2e/join-realtime-cross-views.spec.ts:81:27

    test-results/join-realtime-cross-views--58d4e-and-detail-CTA-in-real-time-chromium/test-failed-1.png

    test-results/join-realtime-cross-views--58d4e-and-detail-CTA-in-real-time-chromium/test-failed-2.png

    Error Context: test-results/join-realtime-cross-views--58d4e-and-detail-CTA-in-real-time-chromium/error-context.md

    test-results/join-realtime-cross-views--58d4e-and-detail-CTA-in-real-time-chromium/trace.zip

  48) [chromium] › e2e/join-request-host-approval-realtime.spec.ts:50:1 › join request → host approval arrives via realtime and status flips live

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /request to join/i }).first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /request to join/i }).first() with timeout 15000ms
      - waiting for getByRole('button', { name: /request to join/i }).first()

      149 |   // Fire the CTA.
      150 |   const cta = page.getByRole("button", { name: /request to join/i }).first();
    > 151 |   await expect(cta).toBeVisible({ timeout: 15_000 });
          |                     ^
      152 |   await cta.click();
      153 |
      154 |   // POST captured with correct payload.
        at e2e/join-request-host-approval-realtime.spec.ts:151:21

    test-results/join-request-host-approval-1f593-ltime-and-status-flips-live-chromium/test-failed-1.png

    Error Context: test-results/join-request-host-approval-1f593-ltime-and-status-flips-live-chromium/error-context.md

    test-results/join-request-host-approval-1f593-ltime-and-status-flips-live-chromium/trace.zip

  49) [chromium] › e2e/leave-host-pending-realtime.spec.ts:49:1 › host's pending list clears in realtime when the player's join_request is deleted

    Error: expect(locator).toBeVisible() failed

    Locator: getByText(/Pickup requests · 1 pending/i)
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText(/Pickup requests · 1 pending/i) with timeout 15000ms
      - waiting for getByText(/Pickup requests · 1 pending/i)

      159 |
      160 |   // 1. Host sees the pending request in the pickup list.
    > 161 |   await expect(page.getByText(/Pickup requests · 1 pending/i)).toBeVisible({
          |                                                                ^
      162 |     timeout: 15_000,
      163 |   });
      164 |
        at e2e/leave-host-pending-realtime.spec.ts:161:64

    test-results/leave-host-pending-realtim-22c84-r-s-join-request-is-deleted-chromium/test-failed-1.png

    Error Context: test-results/leave-host-pending-realtim-22c84-r-s-join-request-is-deleted-chromium/error-context.md

    test-results/leave-host-pending-realtim-22c84-r-s-join-request-is-deleted-chromium/trace.zip

  50) [chromium] › e2e/leave-verified-payment-consistency.spec.ts:45:1 › leaving with a verified payment flips CTA, roster, and clears host-visible rows

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('your-status-strip')
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('your-status-strip') with timeout 15000ms
      - waiting for getByTestId('your-status-strip')

      266 |   // 1. Baseline: confirmed state visible.
      267 |   const strip = page.getByTestId("your-status-strip");
    > 268 |   await expect(strip).toBeVisible({ timeout: 15_000 });
          |                       ^
      269 |   await expect(strip).toContainText(/payment verified/i);
      270 |
      271 |   const cta = page.getByRole("button", { name: /confirmed · tap to leave/i });
        at e2e/leave-verified-payment-consistency.spec.ts:268:23

    test-results/leave-verified-payment-con-a2a4a-nd-clears-host-visible-rows-chromium/test-failed-1.png

    Error Context: test-results/leave-verified-payment-con-a2a4a-nd-clears-host-visible-rows-chromium/error-context.md

    test-results/leave-verified-payment-con-a2a4a-nd-clears-host-visible-rows-chromium/trace.zip

  51) [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › iOS Safari (iPhone 13) › refresh on /feed stays on /feed

    Test timeout of 60000ms exceeded.

    Error: browserContext.close: Target page, context or browser has been closed

      85 |           ).toHaveLength(0);
      86 |         } finally {
    > 87 |           await context.close();
         |           ^
      88 |         }
      89 |       });
      90 |     }
        at e2e/mobile-refresh-protected.spec.ts:87:11

    test-results/mobile-refresh-protected-i-d2da7-fresh-on-feed-stays-on-feed-chromium/test-failed-1.png

    Error Context: test-results/mobile-refresh-protected-i-d2da7-fresh-on-feed-stays-on-feed-chromium/error-context.md

    test-results/mobile-refresh-protected-i-d2da7-fresh-on-feed-stays-on-feed-chromium/trace.zip

  52) [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › iOS Safari (iPhone 13) › refresh on /profile stays on /profile

    Test timeout of 60000ms exceeded.

    Error: browserContext.close: Target page, context or browser has been closed

      85 |           ).toHaveLength(0);
      86 |         } finally {
    > 87 |           await context.close();
         |           ^
      88 |         }
      89 |       });
      90 |     }
        at e2e/mobile-refresh-protected.spec.ts:87:11

    test-results/mobile-refresh-protected-i-b0d80-on-profile-stays-on-profile-chromium/test-failed-1.png

    Error Context: test-results/mobile-refresh-protected-i-b0d80-on-profile-stays-on-profile-chromium/error-context.md

    test-results/mobile-refresh-protected-i-b0d80-on-profile-stays-on-profile-chromium/trace.zip

  53) [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › iOS Safari (iPhone 13) › refresh on /notifications stays on /notifications

    Test timeout of 60000ms exceeded.

    Error: browserContext.close: Test ended.
    Browser logs:

    <launching> /home/runner/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell --disable-field-trial-config --disable-background-networking --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-back-forward-cache --disable-breakpad --disable-client-side-phishing-detection --disable-component-extensions-with-background-pages --disable-component-update --no-default-browser-check --disable-default-apps --disable-dev-shm-usage --disable-edgeupdater --disable-extensions --disable-features=AvoidUnnecessaryBeforeUnloadCheckSync,DestroyProfileOnBrowserClose,DialMediaRouteProvider,GlobalMediaControls,HttpsUpgrades,LensOverlay,MediaRouter,PaintHolding,ThirdPartyStoragePartitioning,BlockOriginHeaderModificationOnRedirect,Translate,AutoDeElevate,OptimizationHints,msForceBrowserSignIn,msEdgeUpdateLaunchServicesPreferredVersion --enable-features=CDPScreenshotNewSurface --allow-pre-commit-input --disable-hang-monitor --disable-ipc-flooding-protection --disable-popup-blocking --disable-prompt-on-repost --disable-renderer-backgrounding --disable-updater-scheduler --force-color-profile=srgb --metrics-recording-only --no-first-run --password-store=basic --use-mock-keychain --no-service-autorun --export-tagged-pdf --disable-search-engine-choice-screen --unsafely-disable-devtools-self-xss-warnings --edge-skip-compat-layer-relaunch --disable-infobars --disable-search-engine-choice-screen --disable-sync --enable-unsafe-swiftshader --headless --hide-scrollbars --mute-audio --blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4 --no-sandbox --user-data-dir=/tmp/playwright_chromiumdev_profile-kU4X5t --remote-debugging-pipe --no-startup-window
    <launched> pid=7875
    [pid=7875][err] [0911/064347.181853:ERROR:dbus/bus.cc:405] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix")
    [pid=7875][err] [0911/064347.196586:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type:
    [pid=7875][err] [0911/064347.196696:ERROR:dbus/bus.cc:405] Failed to connect to the bus: Could not parse server address: Unknown address type (examples of valid types are "tcp" and on UNIX "unix")
    [pid=7875][err] [0911/064347.202312:ERROR:dbus/object_proxy.cc:572] Failed to call method: org.freedesktop.DBus.NameHasOwner: object_path= /org/freedesktop/DBus: unknown error type:
    [pid=7875][err] [0911/064347.217709:WARNING:media/gpu/vaapi/vaapi_wrapper.cc:1660] drmGetDevices2() has not found any devices
    [pid=7875][err] [0911/064347.224602:WARNING:sandbox/policy/linux/sandbox_linux.cc:405] InitializeSandbox() called with multiple threads in process gpu-process.
    [pid=7875][err] [0911/064347.571648:INFO:CONSOLE:733] "[vite] connecting...", source: http://localhost:8080/@vite/client (733)
    [pid=7875][err] [0911/064347.579657:INFO:CONSOLE:827] "[vite] connected.", source: http://localhost:8080/@vite/client (827)
    [pid=7875][err] [0911/064347.765685:INFO:CONSOLE:733] "[vite] connecting...", source: http://localhost:8080/@vite/client (733)
    [pid=7875][err] [0911/064347.768853:INFO:CONSOLE:827] "[vite] connected.", source: http://localhost:8080/@vite/client (827)
    [pid=7875][err] [0911/064349.297832:INFO:CONSOLE:89] "[AuthGate] verify-start [object Object]", source: http://localhost:8080/src/lib/authgate-log.ts (89)
    [pid=7875][err] [0911/064349.298692:INFO:CONSOLE:89] "[AuthGate] verify-start [object Object]", source: http://localhost:8080/src/lib/authgate-log.ts (89)
    [pid=7875][err] [0911/064349.303280:INFO:CONSOLE:89] "[AuthGate] user-present [object Object]", source: http://localhost:8080/src/lib/authgate-log.ts (89)
    [pid=7875][err] [0911/064349.317514:INFO:CONSOLE:89] "[AuthGate] user-present [object Object]", source: http://localhost:8080/src/lib/authgate-log.ts (89)
    [pid=7875][err] [0911/064349.439518:INFO:CONSOLE:68] "[onesignal] init error Error: App not configured for web push", source: http://localhost:8080/src/lib/onesignal.ts (68)
    [pid=7875][err] [0911/064359.339092:INFO:CONSOLE:89] "[AuthGate] user-present [object Object]", source: http://localhost:8080/src/lib/authgate-log.ts (89)
    [pid=7875] <gracefully close start>

      85 |           ).toHaveLength(0);
      86 |         } finally {
    > 87 |           await context.close();
         |           ^
      88 |         }
      89 |       });
      90 |     }
        at e2e/mobile-refresh-protected.spec.ts:87:11

    test-results/mobile-refresh-protected-i-aa2da-ions-stays-on-notifications-chromium/test-failed-1.png

    Error Context: test-results/mobile-refresh-protected-i-aa2da-ions-stays-on-notifications-chromium/error-context.md

    test-results/mobile-refresh-protected-i-aa2da-ions-stays-on-notifications-chromium/trace.zip

  54) [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › Android Chrome (Pixel 7) › refresh on /feed stays on /feed

    Test timeout of 60000ms exceeded.

    Error: browserContext.close: Target page, context or browser has been closed

      85 |           ).toHaveLength(0);
      86 |         } finally {
    > 87 |           await context.close();
         |           ^
      88 |         }
      89 |       });
      90 |     }
        at e2e/mobile-refresh-protected.spec.ts:87:11

    test-results/mobile-refresh-protected-A-33007-fresh-on-feed-stays-on-feed-chromium/test-failed-1.png

    Error Context: test-results/mobile-refresh-protected-A-33007-fresh-on-feed-stays-on-feed-chromium/error-context.md

    test-results/mobile-refresh-protected-A-33007-fresh-on-feed-stays-on-feed-chromium/trace.zip

  55) [chromium] › e2e/mobile-refresh-protected.spec.ts:48:7 › Android Chrome (Pixel 7) › refresh on /profile stays on /profile

    Test timeout of 60000ms exceeded.

    Error: browserContext.close: Target page, context or browser has been closed

      85 |           ).toHaveLength(0);
      86 |         } finally {
    > 87 |           await context.close();
         |           ^
      88 |         }
      89 |       });
      90 |     }
        at e2e/mobile-refresh-protected.spec.ts:87:11

    test-results/mobile-refresh-protected-A-0154a-on-profile-stays-on-profile-chromium/test-failed-1.png

    Error Context: test-results/mobile-refresh-protected-A-0154a-on-profile-stays-on-profile-chromium/error-context.md

    test-results/mobile-refresh-protected-A-0154a-on-profile-stays-on-profile-chromium/trace.zip

  56) [chromium] › e2e/oauth-empty-referrer.spec.ts:121:5 › OAuth on /auth with empty document.referrer › google: RETURNING user with stashed next → next path (not "/")

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/trainers(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
    Timeout: 15000ms

    Call log:
      - Expect "toHaveURL" with timeout 15000ms
        6 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/auth"
        2 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
        25 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"

      129 |         await emitOAuthSignedIn(page, provider);
      130 |
    > 131 |         await expect(page).toHaveURL(/\/trainers(?:[?#/].*)?$/, { timeout: 15_000 });
          |                            ^
      132 |         await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
      133 |         await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/?$/);
      134 |       } finally {
        at e2e/oauth-empty-referrer.spec.ts:131:28

    test-results/oauth-empty-referrer-OAuth-82beb-ashed-next-→-next-path-not--chromium/test-failed-1.png

    Error Context: test-results/oauth-empty-referrer-OAuth-82beb-ashed-next-→-next-path-not--chromium/error-context.md

    test-results/oauth-empty-referrer-OAuth-82beb-ashed-next-→-next-path-not--chromium/trace.zip

  57) [chromium] › e2e/oauth-empty-referrer.spec.ts:121:5 › OAuth on /auth with empty document.referrer › apple: RETURNING user with stashed next → next path (not "/")

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/trainers(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
    Timeout: 15000ms

    Call log:
      - Expect "toHaveURL" with timeout 15000ms
        6 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/auth"
        3 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
        24 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/feed?q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"

      129 |         await emitOAuthSignedIn(page, provider);
      130 |
    > 131 |         await expect(page).toHaveURL(/\/trainers(?:[?#/].*)?$/, { timeout: 15_000 });
          |                            ^
      132 |         await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
      133 |         await expect(page).not.toHaveURL(/^https?:\/\/[^/]+\/?$/);
      134 |       } finally {
        at e2e/oauth-empty-referrer.spec.ts:131:28

    test-results/oauth-empty-referrer-OAuth-9ef16-ashed-next-→-next-path-not--chromium/test-failed-1.png

    Error Context: test-results/oauth-empty-referrer-OAuth-9ef16-ashed-next-→-next-path-not--chromium/error-context.md

    test-results/oauth-empty-referrer-OAuth-9ef16-ashed-next-→-next-path-not--chromium/trace.zip

  58) [chromium] › e2e/oauth-from-auth-referrer.spec.ts:81:5 › OAuth from /auth with referrer '/' → onboarding picker › google: new user lands on /onboarding/account-type with pending state preserved

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/onboarding\/account-type(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/feed?src=auth-referrer-e2e&q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
    Timeout: 15000ms

    Call log:
      - Expect "toHaveURL" with timeout 15000ms
        5 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/auth?next=%2Ffeed%3Fsrc%3Dauth-referrer-e2e"
        5 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/auth?next=%2Ffeed%3Fsrc%3Dauth-referrer-e2e"
        3 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/feed?src=auth-referrer-e2e&q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
        20 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/feed?src=auth-referrer-e2e&q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"

      116 |         }, provider);
      117 |
    > 118 |         await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          |                            ^
      119 |           timeout: 15_000,
      120 |         });
      121 |
        at e2e/oauth-from-auth-referrer.spec.ts:118:28

    test-results/oauth-from-auth-referrer-O-ff54c-ith-pending-state-preserved-chromium/test-failed-1.png

    Error Context: test-results/oauth-from-auth-referrer-O-ff54c-ith-pending-state-preserved-chromium/error-context.md

    test-results/oauth-from-auth-referrer-O-ff54c-ith-pending-state-preserved-chromium/trace.zip

  59) [chromium] › e2e/oauth-from-auth-referrer.spec.ts:81:5 › OAuth from /auth with referrer '/' → onboarding picker › apple: new user lands on /onboarding/account-type with pending state preserved

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/onboarding\/account-type(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/feed?src=auth-referrer-e2e&q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
    Timeout: 15000ms

    Call log:
      - Expect "toHaveURL" with timeout 15000ms
        6 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/auth?next=%2Ffeed%3Fsrc%3Dauth-referrer-e2e"
        5 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/auth?next=%2Ffeed%3Fsrc%3Dauth-referrer-e2e"
        3 × locator resolved to <html lang="en" class="dark" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
          - unexpected value "http://localhost:8080/feed?src=auth-referrer-e2e&q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"
        19 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/feed?src=auth-referrer-e2e&q=&sport=&sort=&dist=null&pos=&view=&density=&tab=upcoming"

      116 |         }, provider);
      117 |
    > 118 |         await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          |                            ^
      119 |           timeout: 15_000,
      120 |         });
      121 |
        at e2e/oauth-from-auth-referrer.spec.ts:118:28

    test-results/oauth-from-auth-referrer-O-69afb-ith-pending-state-preserved-chromium/test-failed-1.png

    Error Context: test-results/oauth-from-auth-referrer-O-69afb-ith-pending-state-preserved-chromium/error-context.md

    test-results/oauth-from-auth-referrer-O-69afb-ith-pending-state-preserved-chromium/trace.zip

  60) [chromium] › e2e/oauth-no-signin-flash-on-navigation.spec.ts:76:3 › no auth loader flash while navigating after google login

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByLabel('Available Players', { exact: true }).first()

      88 |
      89 |     for (const label of TAB_HOPS) {
    > 90 |       await page.getByLabel(label, { exact: true }).first().click();
         |                                                             ^
      91 |       await page.waitForTimeout(400);
      92 |
      93 |       const flashes = await readFlashes(page);
        at e2e/oauth-no-signin-flash-on-navigation.spec.ts:90:61

    test-results/oauth-no-signin-flash-on-n-12492-vigating-after-google-login-chromium/test-failed-1.png

    Error Context: test-results/oauth-no-signin-flash-on-n-12492-vigating-after-google-login-chromium/error-context.md

    test-results/oauth-no-signin-flash-on-n-12492-vigating-after-google-login-chromium/trace.zip

  61) [chromium] › e2e/oauth-no-signin-flash-on-navigation.spec.ts:76:3 › no auth loader flash while navigating after apple login

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByLabel('Available Players', { exact: true }).first()

      88 |
      89 |     for (const label of TAB_HOPS) {
    > 90 |       await page.getByLabel(label, { exact: true }).first().click();
         |                                                             ^
      91 |       await page.waitForTimeout(400);
      92 |
      93 |       const flashes = await readFlashes(page);
        at e2e/oauth-no-signin-flash-on-navigation.spec.ts:90:61

    test-results/oauth-no-signin-flash-on-n-f4c71-avigating-after-apple-login-chromium/test-failed-1.png

    Error Context: test-results/oauth-no-signin-flash-on-n-f4c71-avigating-after-apple-login-chromium/error-context.md

    test-results/oauth-no-signin-flash-on-n-f4c71-avigating-after-apple-login-chromium/trace.zip

  62) [chromium] › e2e/oauth-non-root-referrer.spec.ts:88:5 › OAuth from /auth with non-root referrer › google: NEW user → /onboarding/account-type with pending state preserved

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "/players"
    Received: "/players?q=&sport=&skill=&dist=0&unknownAge=true&when=any&sort=recent&view=list&density=list&tab=browse&post="

      57 |
      58 |   const referrer = await page.evaluate(() => document.referrer);
    > 59 |   expect(referrer.replace(/^https?:\/\/[^/]+/, "")).toBe(REFERRER_PATH);
         |                                                     ^
      60 | }
      61 |
      62 | async function emitOAuthSignedIn(page: Page, provider: string) {
        at primeAndLandOnAuth (e2e/oauth-non-root-referrer.spec.ts:59:53)
        at e2e/oauth-non-root-referrer.spec.ts:95:9

    test-results/oauth-non-root-referrer-OA-88dee-ith-pending-state-preserved-chromium/test-failed-1.png

    Error Context: test-results/oauth-non-root-referrer-OA-88dee-ith-pending-state-preserved-chromium/error-context.md

    test-results/oauth-non-root-referrer-OA-88dee-ith-pending-state-preserved-chromium/trace.zip

  63) [chromium] › e2e/oauth-non-root-referrer.spec.ts:116:5 › OAuth from /auth with non-root referrer › google: RETURNING user → saved next path (not landing page)

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "/players"
    Received: "/players?q=&sport=&skill=&dist=0&unknownAge=true&when=any&sort=recent&view=list&density=list&tab=browse&post="

      57 |
      58 |   const referrer = await page.evaluate(() => document.referrer);
    > 59 |   expect(referrer.replace(/^https?:\/\/[^/]+/, "")).toBe(REFERRER_PATH);
         |                                                     ^
      60 | }
      61 |
      62 | async function emitOAuthSignedIn(page: Page, provider: string) {
        at primeAndLandOnAuth (e2e/oauth-non-root-referrer.spec.ts:59:53)
        at e2e/oauth-non-root-referrer.spec.ts:123:9

    test-results/oauth-non-root-referrer-OA-97309-next-path-not-landing-page--chromium/test-failed-1.png

    Error Context: test-results/oauth-non-root-referrer-OA-97309-next-path-not-landing-page--chromium/error-context.md

    test-results/oauth-non-root-referrer-OA-97309-next-path-not-landing-page--chromium/trace.zip

  64) [chromium] › e2e/oauth-non-root-referrer.spec.ts:88:5 › OAuth from /auth with non-root referrer › apple: NEW user → /onboarding/account-type with pending state preserved

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "/players"
    Received: "/players?q=&sport=&skill=&dist=0&unknownAge=true&when=any&sort=recent&view=list&density=list&tab=browse&post="

      57 |
      58 |   const referrer = await page.evaluate(() => document.referrer);
    > 59 |   expect(referrer.replace(/^https?:\/\/[^/]+/, "")).toBe(REFERRER_PATH);
         |                                                     ^
      60 | }
      61 |
      62 | async function emitOAuthSignedIn(page: Page, provider: string) {
        at primeAndLandOnAuth (e2e/oauth-non-root-referrer.spec.ts:59:53)
        at e2e/oauth-non-root-referrer.spec.ts:95:9

    test-results/oauth-non-root-referrer-OA-e1d9c-ith-pending-state-preserved-chromium/test-failed-1.png

    Error Context: test-results/oauth-non-root-referrer-OA-e1d9c-ith-pending-state-preserved-chromium/error-context.md

    test-results/oauth-non-root-referrer-OA-e1d9c-ith-pending-state-preserved-chromium/trace.zip

  65) [chromium] › e2e/oauth-non-root-referrer.spec.ts:116:5 › OAuth from /auth with non-root referrer › apple: RETURNING user → saved next path (not landing page)

    Error: expect(received).toBe(expected) // Object.is equality

    Expected: "/players"
    Received: "/players?q=&sport=&skill=&dist=0&unknownAge=true&when=any&sort=recent&view=list&density=list&tab=browse&post="

      57 |
      58 |   const referrer = await page.evaluate(() => document.referrer);
    > 59 |   expect(referrer.replace(/^https?:\/\/[^/]+/, "")).toBe(REFERRER_PATH);
         |                                                     ^
      60 | }
      61 |
      62 | async function emitOAuthSignedIn(page: Page, provider: string) {
        at primeAndLandOnAuth (e2e/oauth-non-root-referrer.spec.ts:59:53)
        at e2e/oauth-non-root-referrer.spec.ts:123:9

    test-results/oauth-non-root-referrer-OA-53e22-next-path-not-landing-page--chromium/test-failed-1.png

    Error Context: test-results/oauth-non-root-referrer-OA-53e22-next-path-not-landing-page--chromium/error-context.md

    test-results/oauth-non-root-referrer-OA-53e22-next-path-not-landing-page--chromium/trace.zip

  66) [chromium] › e2e/pay-approval-gate-flips.spec.ts:44:1 › pay page auto-flips from approval gate to payment picker on approval

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('approval-required-gate')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('approval-required-gate') with timeout 10000ms
      - waiting for getByTestId('approval-required-gate')

      148 |   // Approval gate is visible; payment picker is not.
      149 |   const gate = page.getByTestId("approval-required-gate");
    > 150 |   await expect(gate).toBeVisible({ timeout: 10_000 });
          |                      ^
      151 |   await expect(gate).toContainText(/waiting on host approval/i);
      152 |   await expect(page.getByText(/pay host using/i)).toHaveCount(0);
      153 |
        at e2e/pay-approval-gate-flips.spec.ts:150:22

    test-results/pay-approval-gate-flips-pa-d0541--payment-picker-on-approval-chromium/test-failed-1.png

    Error Context: test-results/pay-approval-gate-flips-pa-d0541--payment-picker-on-approval-chromium/error-context.md

    test-results/pay-approval-gate-flips-pa-d0541--payment-picker-on-approval-chromium/trace.zip

  67) [chromium] › e2e/pay-approval-polling-fallback.spec.ts:43:1 › pay page flips from gate to picker via polling when realtime is unavailable

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('approval-required-gate')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('approval-required-gate') with timeout 10000ms
      - waiting for getByTestId('approval-required-gate')

      153 |   // Approval gate visible, picker not.
      154 |   const gate = page.getByTestId("approval-required-gate");
    > 155 |   await expect(gate).toBeVisible({ timeout: 10_000 });
          |                      ^
      156 |   await expect(page.getByText(/pay host using/i)).toHaveCount(0);
      157 |
      158 |   // Sanity: realtime is truly blocked — no active realtime channel should be
        at e2e/pay-approval-polling-fallback.spec.ts:155:22

    test-results/pay-approval-polling-fallb-a8102-hen-realtime-is-unavailable-chromium/test-failed-1.png

    Error Context: test-results/pay-approval-polling-fallb-a8102-hen-realtime-is-unavailable-chromium/error-context.md

    test-results/pay-approval-polling-fallb-a8102-hen-realtime-is-unavailable-chromium/trace.zip

  68) [chromium] › e2e/pay-approval-realtime-only.spec.ts:49:1 › realtime approval flips pay page from gate to picker (no focus / reload)

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('approval-required-gate')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('approval-required-gate') with timeout 10000ms
      - waiting for getByTestId('approval-required-gate')

      149 |   // Gate is up, picker is not.
      150 |   const gate = page.getByTestId("approval-required-gate");
    > 151 |   await expect(gate).toBeVisible({ timeout: 10_000 });
          |                      ^
      152 |   await expect(page.getByText(/pay host using/i)).toHaveCount(0);
      153 |
      154 |   // Wait for the pay page's realtime channel to be registered.
        at e2e/pay-approval-realtime-only.spec.ts:151:22

    test-results/pay-approval-realtime-only-227fa--to-picker-no-focus-reload--chromium/test-failed-1.png

    Error Context: test-results/pay-approval-realtime-only-227fa--to-picker-no-focus-reload--chromium/error-context.md

    test-results/pay-approval-realtime-only-227fa--to-picker-no-focus-reload--chromium/trace.zip

  69) [chromium] › e2e/pay-blocked-until-approved.spec.ts:48:1 › payment submission is blocked while join request is unapproved

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('approval-required-gate')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('approval-required-gate') with timeout 10000ms
      - waiting for getByTestId('approval-required-gate')

      161 |   // 1. Approval gate is visible.
      162 |   const gate = page.getByTestId("approval-required-gate");
    > 163 |   await expect(gate).toBeVisible({ timeout: 10_000 });
          |                      ^
      164 |   await expect(gate).toContainText(/waiting on host approval/i);
      165 |
      166 |   // 2. Payment picker + submit surfaces are NOT rendered.
        at e2e/pay-blocked-until-approved.spec.ts:163:22

    test-results/pay-blocked-until-approved-61d6b--join-request-is-unapproved-chromium/test-failed-1.png

    Error Context: test-results/pay-blocked-until-approved-61d6b--join-request-is-unapproved-chromium/error-context.md

    test-results/pay-blocked-until-approved-61d6b--join-request-is-unapproved-chromium/trace.zip

  70) [chromium] › e2e/pay-button-navigates.spec.ts:156:1 › Pay host button on a custom (sample) game routes to the pay screen

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /pay host/i }).first()

      167 |
      168 |   const cta = page.getByRole("link", { name: /pay host/i }).first();
    > 169 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      170 |   await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
      171 |   await cta.click();
      172 |
        at e2e/pay-button-navigates.spec.ts:169:21

    test-results/pay-button-navigates-Pay-h-8d365-me-routes-to-the-pay-screen-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Pay-h-8d365-me-routes-to-the-pay-screen-chromium/error-context.md

    test-results/pay-button-navigates-Pay-h-8d365-me-routes-to-the-pay-screen-chromium/trace.zip

  71) [chromium] › e2e/pay-button-navigates.spec.ts:180:1 › Pay host still renders when optional status lookups hang

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /pay host/i }).first()

      243 |
      244 |   const cta = page.getByRole("link", { name: /pay host/i }).first();
    > 245 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      246 |   await cta.click();
      247 |
      248 |   await assertPayScreenRendered(page, CUSTOM_GAME_ID);
        at e2e/pay-button-navigates.spec.ts:245:21

    test-results/pay-button-navigates-Pay-h-30cdf-ptional-status-lookups-hang-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Pay-h-30cdf-ptional-status-lookups-hang-chromium/error-context.md

    test-results/pay-button-navigates-Pay-h-30cdf-ptional-status-lookups-hang-chromium/trace.zip

  72) [chromium] › e2e/pay-button-navigates.spec.ts:258:1 › Pay screen exits payment-options loading when payment settings hang

    Error: expect(locator).toBeVisible() failed

    Locator: locator('h1').first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" locator('h1').first() with timeout 10000ms
      - waiting for locator('h1').first()

      151 |   await expect(page.getByText(/game not found/i)).toHaveCount(0);
      152 |   // Title heading is rendered on the pay screen.
    > 153 |   await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
          |                                            ^
      154 | }
      155 |
      156 | test("Pay host button on a custom (sample) game routes to the pay screen", async ({
        at assertPayScreenRendered (e2e/pay-button-navigates.spec.ts:153:44)
        at e2e/pay-button-navigates.spec.ts:291:3

    test-results/pay-button-navigates-Pay-s-1c2fd--when-payment-settings-hang-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Pay-s-1c2fd--when-payment-settings-hang-chromium/error-context.md

    test-results/pay-button-navigates-Pay-s-1c2fd--when-payment-settings-hang-chromium/trace.zip

  73) [chromium] › e2e/pay-button-navigates.spec.ts:302:1 › Pay host button remains a pay link when local joined state is stale

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /pay host/i }).first()

      317 |
      318 |   const cta = page.getByRole("link", { name: /pay host/i }).first();
    > 319 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      320 |   await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
      321 |   await cta.click();
      322 |
        at e2e/pay-button-navigates.spec.ts:319:21

    test-results/pay-button-navigates-Pay-h-e291f-local-joined-state-is-stale-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Pay-h-e291f-local-joined-state-is-stale-chromium/error-context.md

    test-results/pay-button-navigates-Pay-h-e291f-local-joined-state-is-stale-chromium/trace.zip

  74) [chromium] › e2e/pay-button-navigates.spec.ts:329:1 › Payment status button with a pending submission still routes to the pay screen

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /payment pending|pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /payment pending|pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /payment pending|pay host/i }).first()

      347 |
      348 |   const cta = page.getByRole("link", { name: /payment pending|pay host/i }).first();
    > 349 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      350 |   await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
      351 |   await cta.click();
      352 |
        at e2e/pay-button-navigates.spec.ts:349:21

    test-results/pay-button-navigates-Payme-00166-ll-routes-to-the-pay-screen-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Payme-00166-ll-routes-to-the-pay-screen-chromium/error-context.md

    test-results/pay-button-navigates-Payme-00166-ll-routes-to-the-pay-screen-chromium/trace.zip

  75) [chromium] › e2e/pay-button-navigates.spec.ts:360:1 › Payment rejected button routes back to the pay screen without deleting the attempt

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /payment rejected|pay again|pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /payment rejected|pay again|pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /payment rejected|pay again|pay host/i }).first()

      378 |
      379 |   const cta = page.getByRole("link", { name: /payment rejected|pay again|pay host/i }).first();
    > 380 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      381 |   await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
      382 |   await cta.click();
      383 |
        at e2e/pay-button-navigates.spec.ts:380:21

    test-results/pay-button-navigates-Payme-308d3-ithout-deleting-the-attempt-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Payme-308d3-ithout-deleting-the-attempt-chromium/error-context.md

    test-results/pay-button-navigates-Payme-308d3-ithout-deleting-the-attempt-chromium/trace.zip

  76) [chromium] › e2e/pay-button-navigates.spec.ts:391:1 › Pay host button on a hosted game routes to the pay screen

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /pay host/i }).first()

      451 |
      452 |   const cta = page.getByRole("link", { name: /pay host/i }).first();
    > 453 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      454 |   await expect(cta).toHaveAttribute("href", new RegExp(`/games/${HOSTED_GAME_ID}/pay`));
      455 |   await cta.click();
      456 |
        at e2e/pay-button-navigates.spec.ts:453:21

    test-results/pay-button-navigates-Pay-h-ff67f-me-routes-to-the-pay-screen-chromium/test-failed-1.png

    Error Context: test-results/pay-button-navigates-Pay-h-ff67f-me-routes-to-the-pay-screen-chromium/error-context.md

    test-results/pay-button-navigates-Pay-h-ff67f-me-routes-to-the-pay-screen-chromium/trace.zip

  77) [chromium] › e2e/pay-cta-reaches-success-or-retry.spec.ts:115:1 › Pay CTA reaches the ready pay screen when the backend responds

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /pay host/i }).first()

      126 |
      127 |   const cta = page.getByRole("link", { name: /pay host/i }).first();
    > 128 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      129 |   await cta.click();
      130 |
      131 |   await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}/pay`, {
        at e2e/pay-cta-reaches-success-or-retry.spec.ts:128:21

    test-results/pay-cta-reaches-success-or-5876b-n-when-the-backend-responds-chromium/test-failed-1.png

    Error Context: test-results/pay-cta-reaches-success-or-5876b-n-when-the-backend-responds-chromium/error-context.md

    test-results/pay-cta-reaches-success-or-5876b-n-when-the-backend-responds-chromium/trace.zip

  78) [chromium] › e2e/pay-cta-reaches-success-or-retry.spec.ts:142:1 › Pay CTA surfaces retry affordance when the payment service hangs

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('link', { name: /pay host/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('link', { name: /pay host/i }).first() with timeout 10000ms
      - waiting for getByRole('link', { name: /pay host/i }).first()

      153 |
      154 |   const cta = page.getByRole("link", { name: /pay host/i }).first();
    > 155 |   await expect(cta).toBeVisible({ timeout: 10_000 });
          |                     ^
      156 |   await cta.click();
      157 |
      158 |   await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}/pay`, {
        at e2e/pay-cta-reaches-success-or-retry.spec.ts:155:21

    test-results/pay-cta-reaches-success-or-78d88-n-the-payment-service-hangs-chromium/test-failed-1.png

    Error Context: test-results/pay-cta-reaches-success-or-78d88-n-the-payment-service-hangs-chromium/error-context.md

    test-results/pay-cta-reaches-success-or-78d88-n-the-payment-service-hangs-chromium/trace.zip

  79) [chromium] › e2e/pay-only-after-approval-no-duplicates.spec.ts:42:1 › pay is blocked while pending; after approval exactly one submission is created

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('approval-required-gate')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('approval-required-gate') with timeout 10000ms
      - waiting for getByTestId('approval-required-gate')

      194 |   // Approval gate is up, picker is not.
      195 |   const gate = page.getByTestId("approval-required-gate");
    > 196 |   await expect(gate).toBeVisible({ timeout: 10_000 });
          |                      ^
      197 |   await expect(page.getByText(/pay host using/i)).toHaveCount(0);
      198 |   await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);
      199 |
        at e2e/pay-only-after-approval-no-duplicates.spec.ts:196:22

    test-results/pay-only-after-approval-no-0475d-y-one-submission-is-created-chromium/test-failed-1.png

    Error Context: test-results/pay-only-after-approval-no-0475d-y-one-submission-is-created-chromium/error-context.md

    test-results/pay-only-after-approval-no-0475d-y-one-submission-is-created-chromium/trace.zip

  80) [chromium] › e2e/pay-realtime-delayed-polling-no-duplicates.spec.ts:96:1 › delayed realtime: polling flips gate once, late frames create no duplicate submissions

    Error: expect(locator).toBeVisible() failed

    Locator: getByTestId('approval-required-gate')
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByTestId('approval-required-gate') with timeout 10000ms
      - waiting for getByTestId('approval-required-gate')

      253 |
      254 |   const gate = page.getByTestId("approval-required-gate");
    > 255 |   await expect(gate).toBeVisible({ timeout: 10_000 });
          |                      ^
      256 |   await expect(page.getByText(/pay host using/i)).toHaveCount(0);
      257 |
      258 |   // No realtime channel should have joined (WS blocked).
        at e2e/pay-realtime-delayed-polling-no-duplicates.spec.ts:255:22

    test-results/pay-realtime-delayed-polli-43a3f-te-no-duplicate-submissions-chromium/test-failed-1.png

    Error Context: test-results/pay-realtime-delayed-polli-43a3f-te-no-duplicate-submissions-chromium/error-context.md

    test-results/pay-realtime-delayed-polli-43a3f-te-no-duplicate-submissions-chromium/trace.zip

  81) [chromium] › e2e/pay-rejected-confirmation.spec.ts:43:1 › payment rejected by host updates pay screen to rejected state

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /e2e-host|venmo/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /e2e-host|venmo/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /e2e-host|venmo/i }).first()

      201 |
      202 |   const methodButton = page.getByRole("button", { name: /e2e-host|venmo/i }).first();
    > 203 |   await expect(methodButton).toBeVisible({ timeout: 10_000 });
          |                              ^
      204 |   await methodButton.click();
      205 |
      206 |   await page.locator("#paid-amount").fill("15");
        at e2e/pay-rejected-confirmation.spec.ts:203:30

    test-results/pay-rejected-confirmation--c8c92-ay-screen-to-rejected-state-chromium/test-failed-1.png

    Error Context: test-results/pay-rejected-confirmation--c8c92-ay-screen-to-rejected-state-chromium/error-context.md

    test-results/pay-rejected-confirmation--c8c92-ay-screen-to-rejected-state-chromium/trace.zip

  82) [chromium] › e2e/pay-screen-no-cross-host-leak.spec.ts:91:1 › Pay screen for HOST_A never renders or requests HOST_B's payment methods

    Error: expect(locator).toBeVisible() failed

    Locator: getByText('Host A Venmo').first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText('Host A Venmo').first() with timeout 15000ms
      - waiting for getByText('Host A Venmo').first()

      170 |
      171 |   // HOST_A's method must be rendered.
    > 172 |   await expect(page.getByText(HOST_A_LABEL).first()).toBeVisible({ timeout: 15_000 });
          |                                                      ^
      173 |
      174 |   // HOST_B's data must never appear anywhere on the pay screen.
      175 |   const bodyText = await page.locator("body").innerText();
        at e2e/pay-screen-no-cross-host-leak.spec.ts:172:54

    test-results/pay-screen-no-cross-host-l-8100c-ts-HOST-B-s-payment-methods-chromium/test-failed-1.png

    Error Context: test-results/pay-screen-no-cross-host-l-8100c-ts-HOST-B-s-payment-methods-chromium/error-context.md

    test-results/pay-screen-no-cross-host-l-8100c-ts-HOST-B-s-payment-methods-chromium/trace.zip

  83) [chromium] › e2e/pay-screen-rpc-and-empty-state.spec.ts:77:1 › Pay screen uses host-scoped RPC and renders empty state when no methods

    Error: expect(locator).toBeVisible() failed

    Locator: getByText(/host hasn't configured payment yet/i).first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText(/host hasn't configured payment yet/i).first() with timeout 15000ms
      - waiting for getByText(/host hasn't configured payment yet/i).first()

      132 |   await expect(
      133 |     page.getByText(/host hasn't configured payment yet/i).first(),
    > 134 |   ).toBeVisible({ timeout: 15_000 });
          |     ^
      135 |
      136 |   // "Pay host using" list heading must not render when there are no methods.
      137 |   await expect(page.getByText(/pay host using/i)).toHaveCount(0);
        at e2e/pay-screen-rpc-and-empty-state.spec.ts:134:5

    test-results/pay-screen-rpc-and-empty-s-54a51-empty-state-when-no-methods-chromium/test-failed-1.png

    Error Context: test-results/pay-screen-rpc-and-empty-s-54a51-empty-state-when-no-methods-chromium/error-context.md

    test-results/pay-screen-rpc-and-empty-s-54a51-empty-state-when-no-methods-chromium/trace.zip

  84) [chromium] › e2e/pay-submission-confirmation.spec.ts:40:1 › submitting mocked payment shows the post-payment confirmation UI

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /e2e-host|venmo/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /e2e-host|venmo/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /e2e-host|venmo/i }).first()

      195 |   // Pick the Venmo method — the row's primary button (label/username area).
      196 |   const methodButton = page.getByRole("button", { name: /e2e-host|venmo/i }).first();
    > 197 |   await expect(methodButton).toBeVisible({ timeout: 10_000 });
          |                              ^
      198 |   await methodButton.click();
      199 |
      200 |   // Proof form is now visible.
        at e2e/pay-submission-confirmation.spec.ts:197:30

    test-results/pay-submission-confirmatio-d3686-ost-payment-confirmation-UI-chromium/test-failed-1.png

    Error Context: test-results/pay-submission-confirmatio-d3686-ost-payment-confirmation-UI-chromium/error-context.md

    test-results/pay-submission-confirmatio-d3686-ost-payment-confirmation-UI-chromium/trace.zip

  85) [chromium] › e2e/pay-submission-declined.spec.ts:40:1 › declined submission shows actionable error and stays on the pay screen

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /e2e-host|venmo/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /e2e-host|venmo/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /e2e-host|venmo/i }).first()

      208 |
      209 |   const methodButton = page.getByRole("button", { name: /e2e-host|venmo/i }).first();
    > 210 |   await expect(methodButton).toBeVisible({ timeout: 10_000 });
          |                              ^
      211 |   await methodButton.click();
      212 |
      213 |   await page.locator("#paid-amount").fill("15");
        at e2e/pay-submission-declined.spec.ts:210:30

    test-results/pay-submission-declined-de-79412-and-stays-on-the-pay-screen-chromium/test-failed-1.png

    Error Context: test-results/pay-submission-declined-de-79412-and-stays-on-the-pay-screen-chromium/error-context.md

    test-results/pay-submission-declined-de-79412-and-stays-on-the-pay-screen-chromium/trace.zip

  86) [chromium] › e2e/pay-verified-confirmation.spec.ts:42:1 › payment verified by host updates pay screen to confirmed state

    Error: expect(locator).toBeVisible() failed

    Locator: getByRole('button', { name: /e2e-host|venmo/i }).first()
    Expected: visible
    Timeout: 10000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByRole('button', { name: /e2e-host|venmo/i }).first() with timeout 10000ms
      - waiting for getByRole('button', { name: /e2e-host|venmo/i }).first()

      202 |   // Pick the mocked Venmo method.
      203 |   const methodButton = page.getByRole("button", { name: /e2e-host|venmo/i }).first();
    > 204 |   await expect(methodButton).toBeVisible({ timeout: 10_000 });
          |                              ^
      205 |   await methodButton.click();
      206 |
      207 |   await page.locator("#paid-amount").fill("15");
        at e2e/pay-verified-confirmation.spec.ts:204:30

    test-results/pay-verified-confirmation--9b494-y-screen-to-confirmed-state-chromium/test-failed-1.png

    Error Context: test-results/pay-verified-confirmation--9b494-y-screen-to-confirmed-state-chromium/error-context.md

    test-results/pay-verified-confirmation--9b494-y-screen-to-confirmed-state-chromium/trace.zip

  87) [chromium] › e2e/player-orgs-realtime.spec.ts:48:1 › player profile Organizations section updates in real time

    Test timeout of 60000ms exceeded.

    test-results/player-orgs-realtime-playe-20474-ection-updates-in-real-time-chromium/test-failed-1.png

    Error Context: test-results/player-orgs-realtime-playe-20474-ection-updates-in-real-time-chromium/error-context.md

    test-results/player-orgs-realtime-playe-20474-ection-updates-in-real-time-chromium/trace.zip

  88) [chromium] › e2e/roster-realtime-reconnect.spec.ts:114:1 › roster stays consistent across INSERT, DELETE, and reconnect

    Error: expect(locator).toBeVisible() failed

    Locator: getByText(/Roster \(\d+\/\d+\)/).first()
    Expected: visible
    Timeout: 15000ms
    Error: element(s) not found

    Call log:
      - Expect "toBeVisible" getByText(/Roster \(\d+\/\d+\)/).first() with timeout 15000ms
      - waiting for getByText(/Roster \(\d+\/\d+\)/).first()

      134 |
      135 |     // Wait for A's roster to hydrate.
    > 136 |     await expect(aDetail.getByText(/Roster \(\d+\/\d+\)/).first()).toBeVisible({
          |                                                                    ^
      137 |       timeout: 15_000,
      138 |     });
      139 |     const baselineHeader = await readRosterHeader(aDetail);
        at e2e/roster-realtime-reconnect.spec.ts:136:68

    test-results/roster-realtime-reconnect--d8fa4-INSERT-DELETE-and-reconnect-chromium/test-failed-1.png

    test-results/roster-realtime-reconnect--d8fa4-INSERT-DELETE-and-reconnect-chromium/test-failed-2.png

    Error Context: test-results/roster-realtime-reconnect--d8fa4-INSERT-DELETE-and-reconnect-chromium/error-context.md

    test-results/roster-realtime-reconnect--d8fa4-INSERT-DELETE-and-reconnect-chromium/trace.zip

  89) [chromium] › e2e/social-login-identity-cases.spec.ts:159:5 › social login: identity-present vs identity-missing › identity-present (google): new user lands on onboarding with state preserved

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/onboarding\/account-type(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/auth"
    Timeout: 20000ms

    Call log:
      - Expect "toHaveURL" with timeout 20000ms
        44 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/auth"

      171 |         await signIn(page, { pending: "player", next: NEXT_PATH, provider });
      172 |
    > 173 |         await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          |                            ^
      174 |           timeout: 20_000,
      175 |         });
      176 |
        at e2e/social-login-identity-cases.spec.ts:173:28

    test-results/social-login-identity-case-0f53e-arding-with-state-preserved-chromium/test-failed-1.png

    Error Context: test-results/social-login-identity-case-0f53e-arding-with-state-preserved-chromium/error-context.md

    test-results/social-login-identity-case-0f53e-arding-with-state-preserved-chromium/trace.zip

  90) [chromium] › e2e/social-login-identity-cases.spec.ts:159:5 › social login: identity-present vs identity-missing › identity-present (apple): new user lands on onboarding with state preserved

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/onboarding\/account-type(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/auth"
    Timeout: 20000ms

    Call log:
      - Expect "toHaveURL" with timeout 20000ms
        44 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/auth"

      171 |         await signIn(page, { pending: "player", next: NEXT_PATH, provider });
      172 |
    > 173 |         await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          |                            ^
      174 |           timeout: 20_000,
      175 |         });
      176 |
        at e2e/social-login-identity-cases.spec.ts:173:28

    test-results/social-login-identity-case-a1f22-arding-with-state-preserved-chromium/test-failed-1.png

    Error Context: test-results/social-login-identity-case-a1f22-arding-with-state-preserved-chromium/error-context.md

    test-results/social-login-identity-case-a1f22-arding-with-state-preserved-chromium/trace.zip

  91) [chromium] › e2e/social-login-identity-cases.spec.ts:191:5 › social login: identity-present vs identity-missing › identity-missing (google): provider marker without a linked identity still routes to onboarding

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/onboarding\/account-type(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/auth"
    Timeout: 20000ms

    Call log:
      - Expect "toHaveURL" with timeout 20000ms
        44 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/auth"

      203 |         await signIn(page, { pending: null, next: NEXT_PATH, provider });
      204 |
    > 205 |         await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          |                            ^
      206 |           timeout: 20_000,
      207 |         });
      208 |
        at e2e/social-login-identity-cases.spec.ts:205:28

    test-results/social-login-identity-case-1615c--still-routes-to-onboarding-chromium/test-failed-1.png

    Error Context: test-results/social-login-identity-case-1615c--still-routes-to-onboarding-chromium/error-context.md

    test-results/social-login-identity-case-1615c--still-routes-to-onboarding-chromium/trace.zip

  92) [chromium] › e2e/social-login-identity-cases.spec.ts:191:5 › social login: identity-present vs identity-missing › identity-missing (apple): provider marker without a linked identity still routes to onboarding

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/onboarding\/account-type(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/auth"
    Timeout: 20000ms

    Call log:
      - Expect "toHaveURL" with timeout 20000ms
        44 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/auth"

      203 |         await signIn(page, { pending: null, next: NEXT_PATH, provider });
      204 |
    > 205 |         await expect(page).toHaveURL(/\/onboarding\/account-type(?:[?#/].*)?$/, {
          |                            ^
      206 |           timeout: 20_000,
      207 |         });
      208 |
        at e2e/social-login-identity-cases.spec.ts:205:28

    test-results/social-login-identity-case-87a35--still-routes-to-onboarding-chromium/test-failed-1.png

    Error Context: test-results/social-login-identity-case-87a35--still-routes-to-onboarding-chromium/error-context.md

    test-results/social-login-identity-case-87a35--still-routes-to-onboarding-chromium/trace.zip

  93) [chromium] › e2e/social-login-identity-cases.spec.ts:247:5 › social login: identity-present vs identity-missing › identity-present (apple), onboarding complete: saved next path is consumed

    Error: expect(page).toHaveURL(expected) failed

    Expected pattern: /\/feed(?:[?#/].*)?$/
    Received string:  "http://localhost:8080/auth"
    Timeout: 20000ms

    Call log:
      - Expect "toHaveURL" with timeout 20000ms
        44 × locator resolved to <html lang="en" class="dark" data-debug="0" data-theme="dark" data-theme-pref="dark" data-tsd-source="/src/routes/__root.tsx:267:5">…</html>
           - unexpected value "http://localhost:8080/auth"

      260 |         await signIn(page, { pending: null, next: NEXT_PATH, provider });
      261 |
    > 262 |         await expect(page).toHaveURL(/\/feed(?:[?#/].*)?$/, { timeout: 20_000 });
          |                            ^
      263 |         await expect(page).not.toHaveURL(/\/onboarding\/account-type/);
      264 |
      265 |         // Consumed on success so a later sign-in doesn't re-navigate.
        at e2e/social-login-identity-cases.spec.ts:262:28

    test-results/social-login-identity-case-7dca7-saved-next-path-is-consumed-chromium/test-failed-1.png

    Error Context: test-results/social-login-identity-case-7dca7-saved-next-path-is-consumed-chromium/error-context.md

    test-results/social-login-identity-case-7dca7-saved-next-path-is-consumed-chromium/trace.zip

  94) [chromium] › e2e/team-post-create.spec.ts:48:1 › team-post composer publishes a post end-to-end

    Test timeout of 60000ms exceeded.

    test-results/team-post-create-team-post-cf079-publishes-a-post-end-to-end-chromium/test-failed-1.png

    Error Context: test-results/team-post-create-team-post-cf079-publishes-a-post-end-to-end-chromium/error-context.md

    test-results/team-post-create-team-post-cf079-publishes-a-post-end-to-end-chromium/trace.zip

  95) [chromium] › e2e/trainers-venue-filter-bookmark.spec.ts:48:1 › bookmarked venue+radius URL persists across tabs, profile, and booking sheet

    Test timeout of 60000ms exceeded.

    Error: locator.click: Test timeout of 60000ms exceeded.
    Call log:
      - waiting for getByRole('button', { name: 'Filters' })
        - locator resolved to <button aria-label="Filters" aria-expanded="false" data-tsd-source="/src/components/FilterBar.tsx:67:9" class="relative grid h-11 w-11 shrink-0 place-items-center rounded-full border bg-surface border-border">…</button>
      - attempting click action
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
        - waiting 20ms
        2 × waiting for element to be visible, enabled and stable
          - element is visible, enabled and stable
          - scrolling into view if needed
          - done scrolling
          - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
        - retrying click action
          - waiting 100ms
        28 × waiting for element to be visible, enabled and stable
           - element is visible, enabled and stable
           - scrolling into view if needed
           - done scrolling
           - <div role="dialog" aria-modal="true" aria-label="Updated legal documents" data-tsd-source="/src/components/legal/LegalReacceptGate.tsx:62:5" class="fixed inset-0 z-[100] flex items-end justify-center bg-background/90 p-3 backdrop-blur sm:items-center">…</div> intercepts pointer events
         - retrying click action
           - waiting 500ms

      34 |   await page.goto("/trainers", { waitUntil: "domcontentloaded" });
      35 |   await page.waitForLoadState("networkidle").catch(() => {});
    > 36 |   await page.getByRole("button", { name: "Filters" }).click();
         |                                                       ^
      37 |   const anyVenue = page.getByRole("button", { name: "Any venue" });
      38 |   await anyVenue.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      39 |   const chips = page.locator("button[title]");
        at discoverVenue (e2e/trainers-venue-filter-bookmark.spec.ts:36:55)
        at e2e/trainers-venue-filter-bookmark.spec.ts:53:17

    test-results/trainers-venue-filter-book-84d63-s-profile-and-booking-sheet-chromium/test-failed-1.png

    Error Context: test-results/trainers-venue-filter-book-84d63-s-profile-and-booking-sheet-chromium/error-context.md

    test-results/trainers-venue-filter-book-84d63-s-profile-and-booking-sheet-chromium/trace.zip

  96) [chromium] › e2e/trainers-venue-filter.spec.ts:49:1 › venue filter narrows feed and persists across profile navigation

    Test timeout of 60000ms exceeded.

    Error: locator.click: Target page, context or browser has been closed

      28 |
      29 | async function openFiltersAndPickVenue(page: Page): Promise<string | null> {
    > 30 |   await page.getByRole("button", { name: "Filters" }).click();
         |                                                       ^
      31 |   const anyVenue = page.getByRole("button", { name: "Any venue" });
      32 |   await anyVenue.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      33 |   // Venue chips are siblings of "Any venue" and carry a `title` attribute
        at openFiltersAndPickVenue (e2e/trainers-venue-filter.spec.ts:30:55)
        at e2e/trainers-venue-filter.spec.ts:60:23

    test-results/trainers-venue-filter-venu-98058-s-across-profile-navigation-chromium/test-failed-1.png

    Error Context: test-results/trainers-venue-filter-venu-98058-s-across-profile-navigation-chromium/error-context.md

    test-results/trainers-venue-filter-venu-98058-s-across-profile-navigation-chromium/trace.zip

  97) [chromium] › e2e/trainers-venue-filter.spec.ts:95:1 › book session sheet opens with sticky venue from the feed

    Test timeout of 60000ms exceeded.

    Error: locator.click: Target page, context or browser has been closed

      28 |
      29 | async function openFiltersAndPickVenue(page: Page): Promise<string | null> {
    > 30 |   await page.getByRole("button", { name: "Filters" }).click();
         |                                                       ^
      31 |   const anyVenue = page.getByRole("button", { name: "Any venue" });
      32 |   await anyVenue.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
      33 |   // Venue chips are siblings of "Any venue" and carry a `title` attribute
        at openFiltersAndPickVenue (e2e/trainers-venue-filter.spec.ts:30:55)
        at e2e/trainers-venue-filter.spec.ts:100:23

    test-results/trainers-venue-filter-book-e175b--sticky-venue-from-the-feed-chromium/test-failed-1.png

    Error Context: test-results/trainers-venue-filter-book-e175b--sticky-venue-from-the-feed-chromium/error-context.md

    test-results/trainers-venue-filter-book-e175b--sticky-venue-from-the-feed-chromium/trace.zip
```
