Plan to fix the new-user Google/Apple sign-in flow:

1. **Reconfigure managed social sign-in**
   - Enable/refresh the Lovable Cloud Google and Apple sign-in provider setup so the auth broker and backend agree on allowed providers and redirect origins.
   - Keep using the existing Lovable auth helper; do not replace it with raw provider calls.

2. **Harden the `/auth` OAuth handler**
   - Keep `redirect_uri` as the public same-origin app origin.
   - Preserve the intended destination in session storage instead of sending protected routes to Google/Apple.
   - Improve vendor-rejection handling so users get a clear retry path and new-user onboarding state is not lost.

3. **Guarantee new social users go to onboarding**
   - Ensure Google/Apple sign-ins with no saved `account_type` always route to `/onboarding/account-type` after the session is established.
   - Preserve any saved `next` route so onboarding can return the user to the right app screen afterward.

4. **Add/adjust E2E coverage**
   - Cover Google and Apple provider rejection from new-user signup.
   - Cover successful mocked Google/Apple returns for brand-new users and confirm they land on `/onboarding/account-type`, not the landing page.

Technical details:
- Files likely involved: `src/routes/auth.tsx`, `src/routes/__root.tsx`, and the existing OAuth E2E specs.
- Backend/auth configuration will be updated through the managed auth provider tool, not by editing generated integration files.