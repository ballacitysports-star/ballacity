## Plan

1. **Add a public auth callback route**
   - Create `/auth/callback` as a loading screen that runs after Google returns to the app.
   - It will refresh the session, wait briefly for the auth token to be available, then navigate to the intended content screen (`/profile` by default).
   - If no session appears, it will send the user back to `/auth` with a clear error toast/state instead of silently staying stuck.

2. **Route Google through the callback**
   - Keep using the managed `lovable.auth.signInWithOAuth("google", ...)` helper.
   - Set `redirect_uri` to the public same-origin callback URL: `${window.location.origin}/auth/callback`.
   - Preserve the intended destination separately in session storage, not in the protected URL.
   - Keep the `result.redirected` branch so full-page OAuth exits cleanly while preview popup/token flows still navigate after session refresh.

3. **Make auth readiness race-proof**
   - Update the auth hook so session restoration starts from `getSession()` and does not let an early empty `INITIAL_SESSION` permanently mark the user signed out.
   - Keep `onAuthStateChange` synchronous and only use it to update local auth state.
   - Add a helper that waits/polls briefly for a restored session after OAuth/email sign-in before navigating.

4. **Update public-route gating**
   - Add `/auth/callback` to the public route list so the callback can run before the auth gate redirects.
   - Keep protected content routes unchanged; once the callback confirms a session, navigation will open `/profile` normally.

5. **Verify**
   - Confirm `/auth` and `/auth/callback` render.
   - Confirm Google sign-in code uses the managed helper and handles both `redirected` and inline-token flows.
   - If a session is present in the preview, verify the app leaves `/auth`/`/` and opens `/profile`.