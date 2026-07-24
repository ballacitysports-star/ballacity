# Fix Google sign-in "failed to sign in with vendor" error

## What's happening

"Failed to sign in with vendor" is the error the Lovable Cloud auth helper surfaces when the Google OAuth round-trip is rejected. Two likely causes in this project — both worth addressing in one pass:

1. **Non-public `redirect_uri`.** In `src/routes/auth.tsx` the Google click handler passes
   `redirect_uri: next ? ${window.location.origin}${next} : window.location.origin`.
   When someone lands on `/auth?next=/feed?...`, the redirect URI becomes a full protected app URL with query params. Lovable's guidance is that `redirect_uri` must be a plain same-origin public URL (`window.location.origin` or `/auth/callback`) — never a protected route with search params. A protected `redirect_uri` is a common trigger for the vendor to reject the callback, and even when it succeeds it lands the browser on `/feed` before the session is set, causing intermittent bounces.

2. **Managed Google provider state.** The OAuth server itself is enabled (verified), but the managed Google provider on this project may not currently be active. We should re-run the social-auth configuration to make sure Google is enabled with Lovable-managed credentials.

## Fix

### 1. Sanitize `redirect_uri` (frontend)

In `src/routes/auth.tsx`:

- Always pass `redirect_uri: window.location.origin` to `lovable.auth.signInWithOAuth("google", …)`.
- Before starting OAuth, store the sanitized `next` path in `sessionStorage` (e.g. key `openrun:oauth-next`) so it survives the round-trip.
- Do the same for the email/password `emailRedirectTo` on line 103 — keep it at `window.location.origin`.

### 2. Consume the saved destination after the session lands

In `src/routes/__root.tsx`, inside the existing `onAuthStateChange` `SIGNED_IN` branch (which already reconciles `account_type`):

- After confirming `account_type` is present (or after routing to onboarding when it isn't), read `openrun:oauth-next` from `sessionStorage`, validate it with the existing `sanitizeNextPath` helper, clear the key, and `router.navigate({ to: dest, replace: true })` if a valid path is present.
- If `account_type` is missing, the redirect to `/onboarding/account-type` still wins; the saved `next` stays in `sessionStorage` and is consumed after onboarding completes (already navigates on completion — we'll pick it up there too, or just clear it).

### 3. Re-enable the managed Google provider

Call `supabase--configure_social_auth` with `providers: ["google", "apple"]` (keep email enabled — no `disable_providers`) to make sure both Google and Apple are active with Lovable-managed credentials. This is a no-op if they're already correctly enabled and repairs the config if not.

### 4. Better error surfacing

Where `promise.then((result) => { if (result?.error) … })` currently shows `msg || "Google sign-in failed"`, add a specific branch:

- If `msg` contains `vendor` or the error code indicates a provider failure, show:
  "Google sign-in was rejected by the provider. Please try again — if it keeps failing, sign in with email/password instead."
- Log `result.error` to the console so future occurrences leave a diagnosable trail.

## Verification

- Reproduce: sign in with Google from `/auth?next=/feed`. Confirm the popup completes and the app lands on `/feed` without the vendor error.
- Deep-link path: open `/auth` directly, click Google — should land on `/profile`.
- New-user path: sign up as a new Google user, confirm `/onboarding/account-type` still gates before any saved `next` is consumed.
- Signed-out redirect allow-list is unchanged; no auth-config migration needed.

## Files touched

- `src/routes/auth.tsx` — `redirect_uri`, `emailRedirectTo`, saved-`next` write, error message.
- `src/routes/__root.tsx` — read/consume saved-`next` in the SIGNED_IN branch.
- No new tables, no migration.
- One tool call: `supabase--configure_social_auth` for Google + Apple.
