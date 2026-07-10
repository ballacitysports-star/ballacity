## Fix: "Google popup was blocked" on iOS Chrome

### Cause

The Lovable auth helper opens Google in a popup window. iOS Chrome (and most in-app webviews) block that popup unless it's triggered synchronously from a user gesture with no prior awaits. Our `google()` handler in `src/routes/auth.tsx` does `setBusy(true)` and sets a timer before awaiting `lovable.auth.signInWithOAuth`, so by the time the popup opens, iOS Chrome no longer treats it as a trusted user gesture and blocks it. Result: the popup never opens, no session ever lands, and after 8s the user sees "Sign-in didn't complete / popup blocked".

We can't change `src/integrations/lovable/index.ts` (auto-generated), but we can:
1. Trigger the OAuth call synchronously in the click handler (no awaits, no state updates before the call).
2. Detect mobile/in-app browsers where popups are unreliable and, if the popup path fails, guide the user cleanly.

### Changes

**`src/routes/auth.tsx` — `google()` handler**

- Make the click handler call `lovable.auth.signInWithOAuth(...)` synchronously as the very first statement (no `setBusy` / `setTimeout` before it). Handle the returned promise with `.then/.catch` instead of `await`, so nothing blocks the popup open.
- Move the "hang" timer and `setBusy(true)` to fire immediately after kicking off the call, but AFTER the sync call to `signInWithOAuth`.
- On error whose message includes "popup" / "blocked" (or on the 8s timeout with no session), show a clearer toast:
  - Title: "Google popup was blocked"
  - Description: "Enable popups for this site in iOS Chrome (aA menu → Website Settings → Pop-ups), or open this page in Safari and try again."
  - Include an action button "Copy link" that copies `window.location.href` so the user can paste it into Safari.
- Keep the existing `onAuthStateChange` + `getSession()` listeners so a successful sign-in still redirects.

**No other files changed.** OneSignal SW passthrough, auth listeners, and reset-password flow stay as-is.

### Out of scope

- Not editing `src/integrations/lovable/index.ts` (auto-generated).
- Not switching to a different OAuth library or full-page redirect flow — the Lovable helper controls that internally and only falls back to full-page redirect when it detects the popup was blocked at open time. Making the call synchronous is what enables that detection to succeed.
- No backend/provider changes — Google auth is confirmed working server-side.

### Verification

- On desktop: Google sign-in still opens a popup and completes normally.
- On iOS Chrome: tapping Continue with Google opens the Google account picker (popup no longer blocked because the call runs inside the user gesture). If a user has popups explicitly disabled at the OS/browser level, they now see a clear, actionable toast with a "Copy link" fallback instead of a generic "didn't complete" message.
