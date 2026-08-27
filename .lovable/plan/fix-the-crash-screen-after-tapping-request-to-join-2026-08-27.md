# Fix the crash screen after tapping "Request to join"

Tapping the CTA on a game page currently drops you onto the generic error screen instead of sending the request.

## What the logs show

The preview console captured, at the moment of the tap:

- `Maximum update depth exceeded` — a render loop thrown from inside a Radix ref-composition path (`setRef` → `composeRefs`), i.e. inside a dialog/overlay that opens from the CTA.
- The error was caught by the router's catch boundary for the `/games/$gameId` route, which is why the page is replaced by the error screen.

The exact component that loops is not yet confirmed — the built bundle hides it — so step 1 is reproduction, not a blind fix.

## Plan

1. **Reproduce and pinpoint (first step, before any code change).**
   Drive the game page in a headless browser against the dev server (unminified stack), tap the CTA, and capture the component stack for the "Maximum update depth exceeded" error. The tap path is: CTA → `handleJoin()` → either the availability prompt dialog (`AvailabilityPromptDialog`) or the join/leave confirm `AlertDialog`, so the stack will name which overlay owns the loop.

2. **Fix the loop at its source.**
   Expected shapes of the bug, resolved according to what step 1 shows:
   - a state update in an effect whose dependency is recreated on every render (object/array literal), re-firing forever once the overlay mounts; fix by memoising the dependency or comparing values before setting state, or
   - an inline callback ref / unstable child passed into a Radix overlay so ref composition re-runs each commit; fix by stabilising the ref or child element.

3. **Keep the request flow working end to end.**
   After the fix, verify the same tap produces the pending state ("Request pending · Tap to cancel") and one `join_requests` row, with no console errors and no catch-boundary screen.

4. **Guard against a repeat.**
   Add a focused regression test that mounts the game page CTA path and asserts the join request fires without a render-loop error, alongside the existing invite/request e2e specs.

## Technical notes

- Files in scope: `src/routes/games.$gameId.index.tsx` (CTA branch around the sticky action bar, `handleJoin`, and the effects between lines 360–620), `src/components/availability/AvailabilityPromptDialog.tsx`, and `src/components/ui/dialog.tsx` / `alert-dialog.tsx` only if the loop turns out to live in the shared overlay wrappers.
- No database, RLS, or payments changes — the request insert path itself is not implicated by the logs.
