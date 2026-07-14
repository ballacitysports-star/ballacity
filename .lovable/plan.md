## Problem

On mobile, tapping **Pay host** lands on `/games/:id/pay` and gets stuck at `Loading… (fetch)` indefinitely. The screen is fully blocked until `getGamePaymentSettings` + `listPaymentMethodsForHost` both resolve (or 8s timeout fires). On flaky mobile networks the user only sees a blank loader with no context.

## Fix

Stop blocking the whole screen on payment data. Render the pay screen shell (back button, game title, fee from `game.price`) as soon as the game object is available, and load payment settings/methods inline with their own small loading + empty/error states.

### Changes to `src/routes/games.$gameId.pay.tsx`

1. **Remove the full-screen `(fetch)` gate.**
   - Keep the `loading` (auth) and `!game && !lookupTimedOut` (game lookup) loaders.
   - Once `game` exists, always render the pay page shell (header, fee card) regardless of `fetching`.

2. **Inline payment-methods loading state.**
   - Where the payment method picker renders, show:
     - a small skeleton/spinner while `fetching` is true,
     - the existing empty state ("host hasn't configured payment yet") when settings loaded but no methods,
     - the existing Retry button (small, inline — not full-screen) when `fetchTimedOut` is true.

3. **Reduce the timeout from 8s to 6s** so users see the inline retry sooner on slow connections.

4. **Keep behavior unchanged for:**
   - Host-scoped RPC (`listPaymentMethodsForHost` → `get_host_payment_methods`).
   - Optional lookups via `Promise.allSettled` (submissions, join request).
   - Approval-gate UI, realtime subscriptions, submission flow.

### Regression coverage

Add an E2E case to `e2e/pay-button-navigates.spec.ts` where `game_payment_settings` GET hangs indefinitely: the pay screen shell (h1 with game title, fee) must still render, and no full-screen "Loading… (fetch)" text should be visible after a short wait.

### Verify

- Run the pay-screen E2E tests.
- Manually load `/games/g2/pay` on mobile viewport in the preview and confirm the header + fee render immediately, with the methods area showing its own loading/empty state.
