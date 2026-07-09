## Problem

The auth logs confirm your Google logins are actually succeeding on the server (multiple `status:200` responses on `/token` in the last few minutes). Yet the UI still shows **"Sign-in is taking longer than expected."**

The bug is in `src/routes/auth.tsx` in the `oauth()` function. After Google returns tokens, the code:

1. Races the OAuth call against a 20s `waitForAuthSession`.
2. When `lovable.auth.signInWithOAuth` resolves with `redirected: false` (the popup / `web_message` path used inside the Lovable preview), it does a **second, separate** `waitForAuthSession({ timeoutMs: 4_000 })`.
3. That second wait uses a fresh subscription and 4s can easily miss the session write on slower mobile networks (you're on a 402px viewport).
4. When it returns `null`, the UI flips to `timeout` — even though the session is already in `localStorage` and the top-level `useEffect` is about to navigate.

The `finishAuthenticatedSession` effect eventually runs and redirects, but the alert has already flashed and — if the user taps "Check session" or "Try again" — kicks off a redundant flow.

## Fix

Simplify `oauth()` in `src/routes/auth.tsx` so the timeout UI only appears when there is genuinely no session:

- Drop the second `waitForAuthSession(4_000)` after `redirected: false`. The top-level `useEffect` (which listens to `onAuthStateChange` + `useAuth().session`) already handles navigation as soon as the session lands.
- Keep the initial race only for the redirect-flow case (where `lovable.auth` may never resolve because the page navigated away).
- When `result.redirected === true`, just return — full-page redirect in flight.
- When `result.redirected === false` and no error, set `googleStatus` back to `waiting` and let the shared session listener finish; only escalate to `timeout` after a longer grace window (e.g. 15s) if `useAuth().session` is still null.
- Guard against the timeout alert appearing once `completingAuth` is true or `session` exists — if either is set, force `googleStatus` back to `idle`.

## Technical detail

In `src/routes/auth.tsx`:

- Remove lines ~205–212 (the second `waitForAuthSession` + navigate). Replace with `setGoogleStatus({ kind: "waiting" })` and start a single 15s timer that only fires `setGoogleStatus({ kind: "timeout" })` if `completingRef.current` is still false.
- Clear that timer inside `finishAuthenticatedSession` so a successful session always cancels the pending "timeout" flip.
- In the JSX (lines ~284–330), gate the timeout/error alert with `!completingAuth && !session`.

No changes to `oauth-session.ts`, `post-sign-in-destination.ts`, or the root route.

## Verification

1. Load `/auth` in the preview, click **Continue with Google**, complete the popup — the button should progress `Opening → Finishing sign-in…` and navigate without ever showing the red alert.
2. Cancel the Google popup — after ~15s the timeout alert appears with "Try again" / "Check session" working as today.
3. Auth logs continue to show `status:200` on `/token` with no extra retries.
