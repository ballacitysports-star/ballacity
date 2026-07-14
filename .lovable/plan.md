## Problem

On `/games/:gameId/pay`, tapping the pay CTA lands on the pay screen, which then sticks on `Loading…` forever. Console has no errors and no request is pending, so the hang is state-level, not network-level.

The pay page renders `Loading…` while ANY of these are true:

```ts
loading                        // auth store still bootstrapping
|| (!game && !lookupTimedOut)  // game lookup not finished
|| (game && fetching)          // payment-settings/methods/subs/req fetch running
```

There is no timeout, no error surfacing for the fetch phase, and no way for the user (or us) to see which of the three branches is stuck. If any single `await` inside the "fetch phase" resolves oddly (a Supabase call that never throws and never returns, an auth-store race, a query for a hosted-game id that never completes), `fetching` stays `true` forever with zero visible signal.

I want to (a) fix that class of hang, (b) surface which branch is stuck, and (c) never leave the user staring at a blank spinner.

## Plan

1. **Instrument the pay page's three loading branches**
   - In `src/routes/games.$gameId.pay.tsx`, add a small `stage` state (`"auth" | "lookup" | "fetch" | "ready"`) and log transitions with `console.info("[pay] …")` including `gameId` and elapsed ms.
   - Render the current stage under the `Loading…` text so the user sees "Loading… (fetch)" instead of a blank spinner. Purely diagnostic UI — no design change.

2. **Guarantee the fetch phase always resolves**
   - Wrap the `getGamePaymentSettings` / `listPaymentMethodsForHost` / `listMySubmissionsForGame` / `getMyJoinRequest` awaits in `Promise.race([fetch, timeout(8000)])`.
   - On timeout: log a warning, set `fetching = false`, toast "Couldn't reach the payment service — retry?", and render an inline `Retry` button that re-runs the effect. This kills the infinite spinner in the worst case and gives a recovery path.

3. **Same treatment for the hosted-game lookup**
   - `fetchHostedGame(gameId)` is already wrapped in `.finally(setLookupTimedOut(true))`, but if the awaited promise itself never settles the finally never runs. Add the same 8s race so `lookupTimedOut` always flips.

4. **Auth branch guard**
   - If `loading` from `useAuth()` is still `true` after 5s on this route, log `[pay] auth-stuck` with the current `authState` snapshot so we can tell "auth store never hydrated" apart from "payments call hung". No behavior change unless it fires.

5. **Verify**
   - Load `/games/g2/pay` signed-out → still redirects to `/auth` (regression check).
   - Load `/games/g2/pay` signed-in → stage moves `auth → lookup → fetch → ready` in the console and the page renders (either the payment picker or "Host hasn't configured payment yet").
   - Force a hang by mocking `getGamePaymentSettings` to a never-resolving promise → after 8s the timeout toast + Retry button appear instead of an infinite spinner.
   - Re-run `e2e/pay-button-navigates.spec.ts` to confirm nothing regressed on the happy paths.

## Technical notes

- No changes to routing, join logic, sample data, or the CTA on the detail page — this is scoped to the pay screen's loading lifecycle.
- New `stage` state and timeout wrappers live entirely in `src/routes/games.$gameId.pay.tsx`; no shared util changes.
- Timeout values (`5s` for auth stall warning, `8s` for data-fetch recovery) are chosen so a slow mobile network still succeeds normally but a genuine hang recovers within ~10s.
- The added `console.info` lines are the primary diagnostic signal: on the next report the logs will pinpoint which branch is stuck, at which point we can remove the instrumentation and land the real root-cause fix.
