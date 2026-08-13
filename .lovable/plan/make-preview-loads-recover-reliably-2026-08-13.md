# Make preview loads recover reliably

## Verified current state

- The app server is responding normally: `/` returns a complete page with HTTP 200, and a clean browser renders the OpenRun home page with the client marked as booted.
- The clean load has no browser errors or failed requests, and the hosted backend is healthy.
- At the time of the reported failure, the preview server optimized new client dependencies and reloaded open tabs. The existing boot watchdog waits up to 30 seconds before attempting recovery, leaving a stale tab looking broken for a long time.
- The authenticated gate also has a branch that can retain its full-screen loader indefinitely when local session data exists but session hydration never completes.

## Plan

1. **Shorten and strengthen stale-preview recovery**
   - Update the pre-React boot watchdog to recover promptly after a failed client-module load or preview rebuild.
   - Keep the existing one-reload limit so recovery cannot create a reload loop.
   - Preserve a manual “Try again” / “Go home” fallback when automatic recovery does not succeed.

2. **Bound authentication loading**
   - Replace the indefinite “stored session exists, keep waiting” branch with a bounded final verification.
   - After the bound expires, route to a recoverable sign-in state rather than leaving the user on a permanent spinner.
   - Preserve valid late-hydrating sessions and the existing onboarding redirect behavior.

3. **Add regression coverage**
   - Cover a failed/stale client boot and verify it reloads once, then presents recovery controls if needed.
   - Cover a protected route with unusable persisted session data and verify the auth loader exits instead of waiting forever.

4. **Verify both paths in a real browser**
   - Confirm a normal public load remains unchanged and error-free.
   - Confirm protected-page refresh still works with a valid persisted session.
   - Confirm stale boot and invalid-session simulations always end in usable content or an actionable recovery screen.

## Technical scope

Primary changes will remain in the root startup/auth gate and the existing refresh E2E coverage. No page redesign, route restructuring, or backend schema change is included.