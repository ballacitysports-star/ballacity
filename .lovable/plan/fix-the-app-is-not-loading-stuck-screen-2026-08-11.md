# Fix the "app is not loading" stuck screen

## What I found (verified)

The app itself is healthy: the server answers `/` in ~20ms with full HTML, and loading the home page in a clean browser renders the OpenRun landing page correctly.

What is broken is the safety net meant to rescue a tab that fails to start. The inline boot-watchdog script in `src/routes/__root.tsx` has a string-quoting bug: the failure message `We couldn't finish loading` is built inside a single-quoted JavaScript string, and the apostrophe in "couldn't" ends that string early. The browser reports `Uncaught SyntaxError: Unexpected identifier 't'` — confirmed in a live browser run.

Because the script fails to parse, none of its recovery logic ever installs: no one-time auto-reload, no "Try again" panel. So when a tab's startup does fail (which happens when the dev server restarts underneath a long-lived tab — the logs show exactly such a restart at 11:29 PM), the loading placeholder sits on screen forever with no way out. That matches what you saw.

## The fix

1. Repair the watchdog script in `src/routes/__root.tsx` so it parses: escape the apostrophe correctly in the failure markup (and audit the rest of that inline string for the same hazard).
2. Verify in a real browser that the script now runs — no page error, and the watchdog arms.
3. Verify recovery end to end: block the app's startup module, load a page, and confirm the placeholder reloads once and then shows "Try again" / "Go home" instead of spinning silently.
4. Confirm a normal load is unaffected: home renders, the watchdog stands down when the app boots, and no retry flag is left behind.

Nothing else changes — no routes, layouts, styling, or data logic.

## Technical notes

- Single file edited: `src/routes/__root.tsx` (the `BOOT_WATCHDOG_SCRIPT` template literal, around lines 169-209).
- Root cause is quoting only; the watchdog's design (single bounded reload guarded by `sessionStorage`, error/rejection listeners, 8s timeout) is sound and stays as is.
- To fix your currently stuck tab right now, a hard reload will recover it; the change above is what prevents the dead-end from recurring.
