# Make the app recover when the preview tab fails to boot

## Root cause (confirmed)

The screen you saw was not `/players` — it was the app's pre-startup placeholder: an unlabeled spinner on an empty page.

Dev-server logs show what happened at the exact moment:

```text
12:51:40 AM [vite] (client) new dependencies optimized: @tanstack/router-core, seroval, @tanstack/history, ...
12:51:40 AM [vite] (client) optimized dependencies changed. reloading
```

The dev server re-bundled dependencies and asked open tabs to reload. Your tab was mid-load with the previous build's URLs, so its startup module request died — that is the reported `Failed to fetch dynamically imported module: .../@tanstack/react-start/dist/plugin/default-entry/client.tsx`, alongside two `Failed to fetch` calls to `getOnboardingStatus`. React never took over the page, so the placeholder stayed forever.

Loading `/players` in a fresh browser against the same running app works: it renders correctly and, signed out, redirects to the sign-in screen as designed. So the Players route is fine — the defect is that a failed boot leaves a dead, silent spinner with no recovery.

## The fix

1. Replace the bare boot placeholder in `src/routes/__root.tsx` (the `ClientOnly` fallback around line 663) with a labeled, self-recovering one:
   - Shows "Loading…" copy instead of a naked spinner.
   - If the app has not started within ~5 seconds, reload the page once automatically, guarded by a `sessionStorage` flag so it can never loop.
   - If it still has not started after that single retry, show "We couldn't finish loading" with "Try again" and "Go home" buttons.
2. React to the failure directly instead of only timing out: listen for the window `error`/`unhandledrejection` signal that names a failed dynamic import of the app's startup module, and go straight to the retry step.
3. Clear the retry flag as soon as the app boots, so a normal subsequent visit is unaffected.
4. Close the matching stall in the onboarding guard (same file, effect around lines 462-507): when both `getOnboardingStatus()` and the fallback profile read fail — exactly what happened here — the state stays `"unknown"` and the loader holds the page indefinitely. On a hard network failure, let the requested page render and retry the check in the background instead of blocking.

Nothing about the Players route, its layout, or its filters changes.

## Technical notes

- Only `src/routes/__root.tsx` is edited.
- The auto-reload is bounded to one attempt per tab session (`sessionStorage`), so a genuinely broken build surfaces the manual retry UI rather than reload-looping.
- Item 4 touches the failure branch only; the redirect to `/onboarding/account-type` for users who genuinely lack an account type is unchanged.
- This condition is specific to a long-lived tab surviving a dependency re-bundle; the recovery path also covers flaky-network boot failures on the published app.

## Verification

Reload your preview tab — `/players` should render the Players screen immediately. Then confirm recovery by blocking the startup module in devtools and loading a protected route: the placeholder should announce loading, retry once, and then offer "Try again" instead of spinning silently.
