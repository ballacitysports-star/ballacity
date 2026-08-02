# Fix the "Signing you in…" flash between page loads

## What's happening

Every in-app navigation briefly replaces the whole screen with the full-page spinner that reads "Signing you in…". It looks like the app signs you in again on each page.

Cause (confirmed in `src/routes/__root.tsx`): the onboarding/account-type guard effect lists `pathname` in its dependencies and calls `setTypeStatus("unknown")` at the start of each run. So on every route change the gate resets to "not yet verified", re-runs the `getOnboardingStatus()` server call, and while that request is in flight the guard returns the full-screen fallback with `pending={true}` — which renders the "Signing you in…" copy.

## The fix

1. Check account-type/onboarding status once per signed-in user, not once per route change.
   - Key the check on the user id, cache the result, and skip it entirely if that user was already confirmed in this session.
   - Remove `pathname` from the effect deps; leaving a protected route no longer invalidates the result.
2. Don't blank the page for a re-check. If the user was already confirmed, keep the current page mounted while any revalidation happens in the background.
3. Only show the loading screen on a genuine cold start (no session resolved yet), and correct the copy: "Signing you in…" only while an OAuth/sign-in attempt is actually pending; otherwise "Loading your account…".

## Technical notes

- File: `src/routes/__root.tsx` (`AuthGate` area, the `typeStatus` effect around lines 445-490, and the fallback branches at lines 505-513).
- Cache shape: module-level `Set<string>` (or ref keyed by user id) of users already known to have completed onboarding, so navigations and remounts don't refetch.
- The redirect-to-`/onboarding/account-type` behavior for users who truly need onboarding stays unchanged.
- No change to `src/hooks/use-auth.ts`, the session hydration logic, or the Safari OAuth polling window.

## Verification

Sign in with the test account and navigate between Feed → Players → Profile → Settings while watching for any full-screen spinner; confirm the page content stays mounted and no repeated onboarding-status request fires per navigation. Confirm a hard refresh on a protected route still shows one loader and lands on the right page, and that a user without an account type still gets redirected to onboarding.
