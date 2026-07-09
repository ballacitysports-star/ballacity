## Plan

1. **Fix Google sign-in handling**
   - Restore Google OAuth to the supported managed flow with `redirect_uri: window.location.origin`.
   - Add the missing `if (result.redirected) return;` branch so the app does not try to refresh/navigate before the OAuth redirect finishes.
   - Keep the direct `lovable.auth.signInWithOAuth("google", ...)` call from the button.

2. **Make post-login routing reliable**
   - Store a safe intended destination such as `/profile` before Google sign-in.
   - After auth is confirmed, route to that destination with TanStack navigation.
   - If OAuth returns to the public home page already signed in, have the home page detect the session and open the app content instead of leaving the user on the landing/login surface.

3. **Tighten auth-state initialization**
   - Keep the session restore path based on `getSession()` first, then validate with `getUser()`.
   - Avoid awaited work inside `onAuthStateChange`; use it only to update local auth state immediately.
   - Prevent the login screen from staying rendered when a session exists but `getUser()` validation is delayed.

4. **Verify the behavior**
   - Check the auth page loads.
   - Confirm the login button logic has the correct redirect branch.
   - If a managed preview session is available, verify that a signed-in session navigates to `/profile` or `/feed` and no longer stays on `/auth`.