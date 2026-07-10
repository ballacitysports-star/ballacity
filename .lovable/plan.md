## Fix Google sign-in returning to /auth on iOS Chrome

### Root causes

**A. OneSignal service worker intercepts OAuth broker paths.**
`public/OneSignalSDKWorker.js` is registered at scope `/`, so on iOS Chrome it can catch navigations to `/~oauth/initiate` and `/~oauth/callback` (the Lovable OAuth proxy paths). Lovable's OAuth docs require SWs to exclude those paths, or the round-trip breaks silently.

**B. `/auth` only redirects via `useAuth().user`, which can race the session write.**
The Lovable helper uses a popup + `postMessage`. On iOS Chrome the popup can be closed before the message is delivered, so `setSession()` never runs in this tab. Even when it does run, `useAuth` may not have re-fetched by the time the user is looking at the screen. There is no direct listener to `SIGNED_IN` on `/auth` to catch late/other-tab session writes.

### Fix

1. **Exclude `/~oauth/*` from the OneSignal service worker.**
   Register OneSignal at a narrower scope (or add a passthrough `fetch` handler that skips the OAuth paths). Simplest: register the SW with `scope: '/onesignal/'` and move the worker file so it does not claim `/`. If OneSignal init doesn't support scope narrowing cleanly, add a top-level `public/OneSignalSDKWorker.js` wrapper that early-returns for any request whose URL pathname starts with `/~oauth`.

2. **On `/auth`, subscribe to `supabase.auth.onAuthStateChange` and navigate on `SIGNED_IN`/`INITIAL_SESSION` (with a session).**
   This catches the case where the session lands via popup postMessage, storage event from another tab, or late useAuth refresh. Use `navigate({ to: "/profile", replace: true })` so Back doesn't return to `/auth`.

3. **Also handle the full-page redirect fallback.**
   If the popup was blocked on iOS Chrome, the helper falls back to a full-page redirect and returns to `window.location.origin` (i.e. `/`). Ensure the root route already renders normally for signed-in users (it does). Add a small `useEffect` on `/auth` that, on mount, calls `supabase.auth.getSession()` once — if a session exists, redirect immediately (covers the case where the user lands back on `/auth` with a hydrated session but stale `useAuth` state).

4. **Add a toast when sign-in appears to hang** (>8s with no session and no error) so users on locked-down browsers/in-app webviews get actionable feedback instead of a silent bounce.

### Files to touch

- `src/routes/auth.tsx` — add `onAuthStateChange` listener + one-shot `getSession()` check + timeout toast.
- `public/OneSignalSDKWorker.js` — add pass-through for `/~oauth/*` (or replace with a narrow-scope wrapper).
- `src/lib/onesignal.ts` — if it calls `OneSignal.init`, ensure `serviceWorkerParam.scope` / `serviceWorkerPath` do not claim `/` more broadly than needed, and confirm registration order (register AFTER any OAuth return).

### Out of scope

- Do not modify `src/integrations/lovable/index.ts` (auto-generated).
- Do not switch providers or add new OAuth clients.
- No backend/auth config changes — Google is already working server-side (logs show 200s).

### Verification

- Reproduce on iOS Chrome (Playwright can't fully emulate iOS Chrome's popup behavior, but we can verify: (a) SW does not match `/~oauth/*`, (b) `/auth` navigates away as soon as a session exists via a scripted `supabase.auth.setSession` call).
- Manually confirm on the actual device after deploy.
