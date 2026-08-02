# Why /players shows a blank spinner instead of the Players screen

## What's actually happening

The screen you're seeing is not the Players page at all — it's the app's pre-startup placeholder: a bare spinner with no text, centered on a black background.

Confirmed from your preview signals and from loading the app directly:

- Your tab reported `Failed to fetch dynamically imported module: .../@tanstack/react-start/dist/plugin/default-entry/client.tsx`, and two `/_serverFn/...getOnboardingStatus` calls failed with "Failed to fetch" at the same moment.
- That module is the app's browser startup entry. When it fails to load, React never takes over the page, so the server-sent placeholder stays on screen forever.
- The Players route itself is healthy: loading `/players` in a clean browser against the running app renders correctly (signed out it redirects to the sign-in screen as designed), with no console or page errors.

So this is a stale preview tab that was left holding a build that no longer exists, not a broken Players layout. Reloading the tab clears it. The real defect is that when startup fails, the app shows an unlabeled spinner forever with no error and no way out.

## The fix

1. Make the pre-startup placeholder self-recovering (`src/routes/__root.tsx`, the `ClientOnly` fallback around line 663):
   - Give it the same copy and affordances as the auth loader: a "Loading…" label, and after ~6 seconds a message plus "Try again" (reload) and "Go home" buttons.
   - Attempt one automatic reload if the app has not started after that window, guarded by a `sessionStorage` flag so it can never loop.
2. Report startup failures instead of swallowing them: listen for the module-load error and surface the retry UI immediately rather than waiting out the timer.
3. Close the related stall in the onboarding guard (same file, effect at lines 462-507): if both `getOnboardingStatus()` and the fallback profile read fail (offline / server restart), the state stays `"unknown"` and the page is held behind the loader indefinitely. On a hard failure, keep the user on the page they asked for rather than blocking it, and retry the check in the background.

No change to the Players route, its layout, or its filters.

## Technical notes

- Files touched: `src/routes/__root.tsx` only.
- The auto-reload guard key (e.g. `openrun:hydrate-retry`) is cleared once the app starts, so a genuinely broken build shows the manual retry UI instead of reload-looping.
- Item 3 changes the failure branch only; the existing redirect to `/onboarding/account-type` for users who really have no account type is unchanged.

## Verification

Reload your preview tab first — `/players` should render the Players list immediately. Then, to confirm the recovery path, simulate a failed startup entry (block that module in devtools) and check the placeholder shows the retry UI and recovers on reload instead of spinning silently.
