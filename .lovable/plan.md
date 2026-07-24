## Plan

1. **Make onboarding the first OAuth destination for new users**
   - Update the `/auth` post-sign-in redirect logic so Google/Apple sessions go directly to `/onboarding/account-type` instead of falling back to `/feed` or the landing-page referrer.
   - Preserve `openrun:oauth-next` and any pending account type so onboarding can continue correctly after the user chooses their permanent account type.

2. **Harden the landing-page signed-in redirect**
   - Update `/` so if a signed-in user has no `profiles.account_type`, it routes to `/onboarding/account-type` instead of restoring `/feed` or another last-visited page.
   - Keep existing behavior for users who already have an account type.

3. **Keep the root auth gate as the backstop**
   - Leave the existing `AuthGate` profile check in place so protected routes still redirect users with missing account type to onboarding.
   - Ensure `/onboarding/account-type` remains allowed and does not bounce back to the landing page.

4. **Add/adjust regression coverage**
   - Extend the existing OAuth E2E tests to cover the actual failure path: returning to `/` from Google/Apple as a brand-new user with `account_type = null` must end on `/onboarding/account-type`, not stay on `/` or `/feed`.
   - Verify pending onboarding state remains preserved in session storage.

## Technical details

- Files to change: `src/routes/auth.tsx`, `src/routes/index.tsx`, and one existing OAuth onboarding E2E spec.
- The confirmed weak spot is that `/auth` currently calls `goPostAuth()` on any session and defaults to `/feed`, while `/` redirects signed-in users based on last visited without first checking whether onboarding is required.