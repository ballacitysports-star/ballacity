## Plan

1. **Reproduce the loading failure**
   - Check the live preview state again once it is reachable.
   - Inspect recent console/dev-server output for route, auth, or runtime errors.
   - Identify whether the app is stuck on `/index`, `/auth`, `/oauth/callback`, a protected route spinner, or a blank/error page.

2. **Fix the likely auth loading loop**
   - Review the route guard in `src/routes/__root.tsx` and the auth store in `src/hooks/use-auth.ts`.
   - Ensure restored Google sessions move protected routes out of the loading spinner and redirect to `/profile` or `/onboarding` reliably.
   - Prevent duplicate/racing redirects between `/auth`, `/oauth/callback`, `/index`, and protected app routes.

3. **Harden post-sign-in routing**
   - Keep `/onboarding` for users without usernames.
   - Default completed sign-ins to `/profile` when no safe saved destination exists.
   - Make failures/timeouts fall back to app content instead of leaving the user on a permanent loading screen.

4. **Validate**
   - Verify the preview renders instead of blank/loading.
   - Test the route path that currently fails, especially `/index` redirect and authenticated landing behavior.
   - Run the relevant auth-routing tests if code changes touch those utilities.