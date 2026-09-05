# Restore the preview link

## Goal
Make the preview open reliably again without changing account, onboarding, or database behavior.

## Confirmed diagnosis
- The live preview cannot currently be contacted, and direct requests to the local preview connection are reset.
- Lovable Cloud, including authentication and the database, is healthy and reachable.
- The preview process has repeatedly exited while compiling the app; its logs include a stopped compiler service, broken-pipe errors, and a previous server-render failure.
- The current process spends an extended period recompiling a very large module graph and does not become reliably reachable.

## Plan
1. Capture the first complete fatal error from a clean preview start, separating the actual failure from the large volume of deprecation warnings.
2. Trace that error to the route or import chain that is forcing the failing startup work.
3. Make the smallest code change needed to keep that work out of initial preview startup; preserve all onboarding and authentication behavior.
4. Restart the preview once and wait for an actual successful page response, not only a “ready” log line.
5. Open the preview in a clean browser and verify `/`, `/auth`, and the signed-in `/create` path render normally.
6. Check browser, runtime, and server-function logs for fresh startup failures, then run the focused boot/auth regression checks.

## Technical details
- Do not edit generated backend connection files or environment files.
- Do not change database policies or fixture-account state; current evidence rules out the backend as the outage source.
- Prefer lazy or route-local loading if a root-level import is pulling unnecessary server modules into startup.
- Success means the preview URL returns a page consistently after a cold start and remains available while navigating through sign-in and `/create`.
