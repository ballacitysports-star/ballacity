## Context

Google's account-picker page on `accounts.google.com` is a required stop in the OAuth redirect flow — the browser HAS to visit Google's domain so Google can verify the user. There's no way to complete Google OAuth without at least a brief redirect through google.com.

However, we can make that redirect **silent** for returning users, so Google doesn't ask them to pick an account — the page flashes through and returns straight to the app.

## Approach

Two complementary changes in `src/routes/auth.tsx`, all inside the existing `google()` handler.

### 1. Add `prompt: "none"` for returning Google users

When we already have a stored `lastGoogleEmail` (returning user), pass both:
- `login_hint: <email>` (already there)
- `prompt: "none"` (new)

`prompt=none` tells Google: don't show any UI — if the user is already signed into Google in this browser, just redirect back with tokens. This eliminates the account picker AND the "Signing in as…" screen for returning users. The user experiences a brief blank flash then lands back in the app signed in.

### 2. Silent-retry fallback when `prompt=none` fails

`prompt=none` fails (returns `login_required` or `interaction_required`) if:
- the user signed out of Google in that browser
- their Google session expired
- they cleared cookies

Handle this in the existing `promise.then((result) => …)` block: if `result.error` message matches `/login_required|interaction_required|consent_required/i`, clear `lastGoogleEmail` from localStorage and automatically retry the sign-in **once** without `prompt=none` (falling back to the normal picker). No error toast shown to the user — the retry is transparent.

### 3. First-time users unchanged

When no `lastGoogleEmail` is stored, keep the current `prompt: "select_account"` behavior so first-time users see the picker.

## Result

- **First sign-in**: normal Google picker (unchanged).
- **Returning sign-in**: brief redirect through google.com with no prompt shown, straight back to `/profile`.
- **Returning user who signed out of Google elsewhere**: transparent one-time fallback to the normal picker; no visible error.

## Alternative (not proposed)

A truly in-page, no-redirect experience would require Google Identity Services (One Tap / GSI) instead of the Lovable OAuth helper. That's a bigger refactor, requires publishing a Google Client ID, and would not integrate cleanly with the Lovable-managed Supabase Google provider you're already using. I'd only pursue this if you explicitly want it.
