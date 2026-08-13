# Fix the whole-app loading deadlock

## Verified diagnosis

- A live preview tab was observed showing only **“Loading…”** with the client boot marker unset; the same tab eventually rendered the profile after startup resources finished.
- The latest cold preview compilation ran for roughly 13 seconds, while the current boot watchdog reloads after 8 seconds. That recovery can interrupt a valid cold start and restart the work it is waiting for.
- A warmed clean-browser load succeeds, so this is a startup/recovery deadlock rather than a broken `/profile` route or unavailable backend.
- After React starts, two render-blocking operations remain unbounded: the primary session hydration in `use-auth.ts` and the onboarding-status request in the root auth gate. Either can retain the full-screen account loader indefinitely.

## Plan

1. **Stop interrupting valid cold starts**
   - Keep immediate one-time recovery for explicit module/chunk load errors.
   - Change elapsed-time handling so a slow compilation does not trigger an automatic reload while startup is still progressing.
   - Always transition to actionable recovery controls after a bounded wait instead of leaving the plain loading placeholder indefinitely.

2. **Create one bounded authentication startup state**
   - Bound the primary session hydration that owns `useAuth().loading`, not only the later second-chance check.
   - Resolve timed-out or unusable sessions to a recoverable signed-out state while preserving valid late-hydrating mobile sessions.
   - Remove duplicated waiting branches that can disagree about whether authentication is ready.

3. **Bound onboarding verification**
   - Give the onboarding-status request a deadline.
   - On connectivity/server timeout, render the requested page and retry in the background; redirect only when a completed check confirms onboarding is missing.

4. **Add regression coverage for the actual failures**
   - Simulate a client entry delayed beyond 8 seconds and confirm startup is not reloaded mid-compile.
   - Simulate a primary auth hydration promise that never settles and confirm the screen exits the loader.
   - Simulate a hanging onboarding check and confirm `/profile` remains usable.
   - Retain coverage for explicit failed scripts: one recovery attempt followed by visible manual actions.

5. **Verify cold and authenticated loads**
   - Test `/`, `/profile`, and another protected route from a cold browser with the signed-in session restored.
   - Confirm no reload loop, no permanent spinner, correct route/session preservation, and no new console or request errors.

## Technical scope

Changes stay within the root startup/auth gate, the shared auth store, and targeted Playwright tests. No page redesign, route restructuring, profile logic, or database change is included.