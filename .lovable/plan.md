## Fix: Stuck on `/auth` after Google login in the Lovable mobile app

### What the logs show

Server side, Google sign-in succeeds — auth logs show 6 back-to-back `POST /token` responses with status 200 and `grant_type: id_token` for user BallaCity, all from `LovableApp/1.1.0` (Android webview). So tokens ARE being exchanged and Supabase considers the user signed in.

Client side, the user stays on `/auth`. This means `supabase.auth.setSession(tokens)` finishes inside the OAuth helper, but the follow-up client-side `navigate({ to: "/profile" })` never actually leaves the page — most likely a webview timing issue between the popup closing, `onAuthStateChange` firing, and TanStack Router picking it up.

### The fix

In `src/routes/auth.tsx`, when the `lovable.auth.signInWithOAuth("google", …)` promise resolves with **no error and no `redirected` flag** (meaning tokens were returned and `setSession` was called), do a hard navigation instead of a client-side one:

```ts
if (!result?.error && !result?.redirected) {
  trackSigninEvent("success");
  // Hard reload bypasses any router/state race in the mobile webview.
  window.location.replace("/profile");
  return;
}
```

Why a hard reload works: it forces the whole app to remount, `useAuth` re-initializes from scratch, `supabase.auth.getUser()` reads the freshly-set session from storage, and the `_tabs.profile` route renders. No dependency on `onAuthStateChange` firing before the router evaluates the redirect effect.

### Also keep

- The synchronous `signInWithOAuth` call as the first statement in the click handler (iOS Chrome popup-gesture fix).
- The existing `onAuthStateChange` + mount-time `getSession` redirect — those still cover desktop and non-webview mobile where they work fine.
- The popup-blocked toast for real errors from the OAuth promise.
- The telemetry events (`attempt`, `success`, `failure`, `popup_blocked`, `retry_clicked`, `copy_link_clicked`).

### Out of scope

- No backend / provider / migration changes.
- No changes to `src/integrations/lovable/index.ts` (auto-generated).
- No new routes.

### Verification

- Lovable mobile app (Android webview): tap Continue with Google → complete Google flow → land on `/profile` (no more stuck `/auth`).
- Desktop Chrome / Safari: still works the same — the hard-reload path only runs after tokens are returned in-window, and it lands on `/profile` just like the old client-side nav did.
- iOS Chrome: popup fix + hard-reload both apply; same happy path.
