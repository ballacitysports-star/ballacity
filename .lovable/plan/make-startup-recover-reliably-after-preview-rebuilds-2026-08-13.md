# Make startup recover reliably after preview rebuilds

## Verified current state

- The app is not globally broken: a clean browser request to `/` returns HTTP 200 and renders the complete OpenRun home page without a page exception.
- The current failure coincides with a preview-server restart: the latest server startup took about 27.6 seconds, and the clean-browser trace showed two Vite reconnects plus many aborted module requests before the page recovered.
- The boot watchdog currently waits 20 seconds and then only displays recovery controls. It automatically reloads only when an error message matches a narrow dynamic-import pattern, so aborted module requests during a preview rebuild can leave an existing tab on the loading shell.
- The React auth/onboarding gates now have bounded waits, so they should expose recovery actions rather than retain a silent spinner indefinitely. The remaining unverified path is an authenticated cold load after a preview rebuild.

## Plan

1. **Make the pre-React recovery state authoritative**
   - Track whether the client entry actually marks the app as booted.
   - Treat a startup timeout or interrupted module graph as one recoverable boot failure, not only errors whose text matches “dynamic import.”
   - Perform at most one automatic reload, then always replace the spinner with working “Try again,” “Sign in again,” and “Go home” actions.

2. **Remove competing startup recovery paths**
   - Consolidate the inline watchdog and React chunk-reload handling around one timestamped retry guard.
   - Ensure a successful boot clears the guard, while a failed rebuild cannot trigger a reload loop.
   - Keep slow but progressing cold compilation from being repeatedly interrupted.

3. **Verify authenticated startup separately**
   - Restore the managed signed-in session before opening `/profile` and `/feed`.
   - Confirm auth hydration and onboarding verification either render the route or reach an actionable recovery/sign-in screen within a fixed bound.
   - Capture the final route, visible state, browser errors, and failed requests so any remaining protected-route defect is fixed at its actual gate.

4. **Add regression coverage for the rebuild failure**
   - Simulate aborted startup-module requests without a matching dynamic-import exception.
   - Verify one reload maximum and a manual fallback after the retry.
   - Retain the slow-client test and protected-session tests to prevent reintroducing reload loops or indefinite auth loading.

5. **Validate the real preview behavior**
   - Test `/`, `/profile`, and `/feed` from fresh and long-lived tabs.
   - Confirm normal loads are unchanged, rebuild-interrupted tabs recover, and no permanent loading-only state remains.

## Technical scope

Changes stay within the root startup watchdog/recovery UI and targeted Playwright coverage. Auth, onboarding, route behavior, page design, database schema, and the recent bundle split remain unchanged unless authenticated reproduction identifies a concrete fault in one of those paths.