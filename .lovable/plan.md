## Plan

1. **Make the Payment CTA unconditionally navigate for paid games**
   - In the game detail route, route any visible paid-game “Pay host” CTA directly to `/games/$gameId/pay` with the current invite/search context.
   - Avoid routing paid clicks through the join/leave/cancel handler, because that handler can interpret stale local joined/pending state and block navigation.

2. **Tighten CTA state rules**
   - Keep approval-gated games showing “Request to join” until approved.
   - Once approved and unpaid, always show a real pay link/button, even if local joined state is stale.
   - Keep confirmed/verified players in the confirmed state.

3. **Make the pay route resilient for hosted/custom games**
   - Ensure hosted game lookup can render the pay screen even when the game is not in the initial local cache.
   - Preserve the existing “Game not found” fallback only after hosted lookup completes.

4. **Update regression tests**
   - Extend the existing pay-button E2E coverage to catch the actual failure mode: clicking the paid CTA must not call join/cancel behavior and must land on `/games/:id/pay`.
   - Cover both sample/custom games and hosted games with mocked backend data.

5. **Verify**
   - Run the focused pay-button E2E test and inspect the navigation/payment-screen assertions.