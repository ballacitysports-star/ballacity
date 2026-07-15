## Plan: Fix payment service error on Pay screen

**Likely cause**
- The recent security hardening made `game_payment_settings` and host payment methods readable only to hosts or already-linked players.
- The Pay screen currently tries to read payment settings before the player has a linked row for that game, so the lookup can fail/timeout and shows “Couldn’t reach the payment service.”

**What I’ll change**
1. **Add a safe payment-access path**
   - Update the database policy/function so a signed-in player can read payment settings and enabled host payment methods for the specific game they are trying to pay for.
   - Keep anonymous users blocked.
   - Keep host payment methods scoped to that game/host only.

2. **Avoid RLS recursion / slow lookups**
   - Replace policies that self-query the same table where needed with security-definer helper functions.
   - This prevents permission checks from timing out or recursively evaluating.

3. **Make the Pay UI handle permission errors clearly**
   - Preserve the retry UI for true network/backend failures.
   - If payment hasn’t been configured, show the existing “Host hasn’t configured payment yet” state instead of a scary service error.

4. **Verify the targeted flow**
   - Re-run or inspect the pay flow for `/games/g2/pay` so the screen reaches either payment options or the configured empty state.
   - Ensure no unrelated security findings are changed or ignored.

**Files/areas expected to change**
- A new database migration for the RLS/function correction.
- `src/lib/payments.ts` and/or `src/routes/games.$gameId.pay.tsx` only if needed for clearer error handling.

**Not included**
- No provider switch.
- No Stripe checkout rewrite.
- No unrelated security finding changes.