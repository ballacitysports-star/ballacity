## Plan

1. **Make every paid-game CTA a real payment link**
   - On the game detail screen, render paid/unverified states as a TanStack `<Link>` to `/games/$gameId/pay` instead of a button that goes through join/cancel logic.
   - Cover these states explicitly: unpaid paid game, pending payment, rejected payment, and approved-but-unpaid approval-gated game.
   - Keep only true non-payment states in the button handler: request to join, cancel pending approval, leave confirmed/free games, waitlist/full states.

2. **Fix stale joined/pending state interference**
   - Stop local `joined` state or pending payment state from changing the paid CTA into “tap to leave/withdraw.”
   - Only allow withdrawal/deletion from the pay screen where the user can see the payment status, not from the main game CTA.

3. **Make game lookup wait for hosted games before showing not found**
   - On `/games/$gameId`, use the same hosted-game fallback behavior as the pay route so hosted/custom games don’t flash or stick on “Game not found” before backend lookup completes.

4. **Update E2E coverage for the actual broken behavior**
   - Add/adjust pay-button tests so they click the visible CTA for:
     - normal paid sample game
     - stale local joined state
     - pending payment submission
     - rejected payment submission
     - hosted paid game loaded from backend mocks
   - Assert the CTA is a link to `/games/:id/pay`, clicking it lands there, and no join/cancel/delete/write request fires from that click.

5. **Verify the fix**
   - Run the focused pay-button E2E tests with the injected signed-in session path.
   - If any test still fails, inspect the rendered DOM and network writes to identify whether the problem is CTA rendering, route navigation, or pay-page loading.