# Restore the stuck preview

## Goal
Restore the current preview so the app loads normally and signed-in users can reach the feed.

## Confirmed diagnosis
- The latest browser error says the preview is missing its Lovable Cloud URL and publishable connection key.
- The hosted backend itself is online and responding normally.
- The app build is currently successful, so this is a preview environment binding problem rather than a page or sign-in logic failure.

## Plan
1. Re-bind the project’s managed backend connection settings to the preview environment.
2. Restart the preview service once so it receives the refreshed settings.
3. Open the app in a clean browser and confirm the initial page renders instead of remaining stuck.
4. Sign in with a fixture account and verify the complete transition from `/auth` to `/feed`.
5. Check browser, runtime, and server-function logs for any remaining failures.
6. Only if the refreshed binding is still unavailable, add a recoverable connection-error screen instead of allowing an indefinite loading state; do not hardcode credentials or alter authentication rules.

## Technical details
- Use the managed backend re-bind operation; do not edit generated connection files or environment files.
- Preserve the existing bounded post-sign-in checks and navigation fallback.
- Success means a clean browser loads the app, authentication reaches the feed, and current logs contain no missing-configuration or server-function errors.
