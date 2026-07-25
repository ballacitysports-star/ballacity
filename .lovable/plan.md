## Plan: fix Google/Apple sign-in rejection for new users

### Goal
Make Google and Apple sign-in work reliably for brand-new users and route them to `/onboarding/account-type` instead of showing a provider/vendor rejection or falling back to the landing page.

### What I verified
- The auth page currently calls the managed Google/Apple helper with `redirect_uri: window.location.origin`, which is the correct public callback shape.
- New social users are intended to have `profiles.account_type = null`, then get redirected to `/onboarding/account-type`.
- The root auth listener already tries to send Google/Apple users without an account type to onboarding.
- There are no fresh browser console logs for the OAuth rejection, so I will treat this as a flow hardening task rather than claiming a single confirmed root cause.

### Changes to make
1. **Reconfigure managed Google and Apple sign-in**
   - Refresh the managed provider settings for both Google and Apple so the backend auth broker and current app origins are aligned.

2. **Make OAuth start safer for mobile/new-user signup**
   - Ensure Google/Apple sign-in is started directly from the button click with no pre-work that can break popup/web-message handling.
   - Preserve onboarding intent and account type state in `sessionStorage` around the OAuth attempt.
   - Keep `redirect_uri` public and same-origin, never pointing to a protected route.

3. **Harden post-OAuth routing**
   - After any social sign-in, re-check the signed-in user profile.
   - If `account_type` is missing, force `/onboarding/account-type`.
   - If `account_type` exists, continue to the saved destination or `/feed`.
   - Avoid the landing page winning the race during OAuth returns.

4. **Improve user-facing failure behavior**
   - If Google/Apple still returns a vendor/provider rejection, show an actionable retry toast and keep the user’s onboarding state saved.
   - Keep lightweight diagnostic logging for the raw OAuth failure reason.

5. **Verify with existing E2E coverage**
   - Run the OAuth vendor rejection test.
   - Run the new-user Google/Apple onboarding redirect test.
   - Adjust tests only if they are flaky because they inherit an already-signed-in E2E session.

### Technical notes
- No database schema changes are planned.
- No new secrets are needed; existing auth/provider setup will be reused.
- I will only touch the auth flow files and related E2E tests if needed.