## Plan

1. **Make payment loading fail closed instead of hanging**
   - Update the pay screen so any slow or failed payment settings/methods request always leaves the `Loading payment options…` state and shows either retry or the host-not-configured message.
   - Clear old payment state at the start of each retry so stale partial data does not keep the UI ambiguous.

2. **Decouple the payment fetch from unstable page state**
   - Prevent the fetch effect from restarting just because the `game` object or auth user object changes identity.
   - Key the payment fetch on stable values only: `gameId`, the resolved host id, and retry attempt.

3. **Show retry sooner and clearer on mobile**
   - Keep the pay screen shell visible.
   - Replace the indefinite inline loader with a timed inline error/retry state when payment options do not load promptly.
   - Keep the existing empty state when the host has no configured methods.

4. **Add regression coverage**
   - Add an E2E test where the payment settings request hangs forever.
   - Assert the page does not stay on `Loading payment options…` and shows the inline retry/empty state instead.

5. **Verify**
   - Run the targeted pay-screen E2E coverage.
   - Manually check `/games/g2/pay` on a mobile viewport and confirm the payment section exits loading.