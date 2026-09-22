# Verify Stripe is working end to end

Goal: confirm the existing Stripe integration (already enabled and wired) actually works — plans, shop checkout, subscriptions, billing portal, and the webhook — without changing how anything works.

## Current state (confirmed by code review)

- Checkout, billing portal, and the webhook handler are fully built and route through Lovable's built-in Stripe gateway.
- Four subscription plans and three shop items are defined in the app and referenced by price keys (`plan_*`, `merch_*`).
- The publishable key present in the project is a **live** key (`pk_live_…`), which means the app currently bills in the live environment, not test mode.

## Verification steps

1. **Price catalog check** — confirm every price key in the app (4 plans + 3 merch items) exists in Stripe with the expected amount, so no button can fail with "Price not found".
2. **Checkout smoke test** — in the preview, signed in, click Subscribe on a plan and Buy on a shop item; confirm the embedded Stripe checkout opens and a test purchase completes.
3. **Webhook check** — confirm the purchase/subscription appears in the app's own records (subscriptions / purchases tables), proving the Stripe → webhook → database path delivers.
4. **Billing portal check** — with an active subscription, open "Manage billing & cancel" and confirm the portal loads.
5. **Entitlement check** — confirm the subscribed plan unlocks its features (plan page shows "Current plan", reel limits reflect the tier).

## One decision for you

The project currently carries a **live** Stripe key, so any checkout charge is real money. The verification can run either way:

- **Test mode (recommended first):** use the sandbox/test environment so no real charges occur, or
- **Live:** verify against the real account directly (a real charge would need refunding).

I'll default to test-mode verification unless you say otherwise.

## Technical notes

- Verification uses the existing `createCheckoutSession` / `createPortalSession` server functions and the `/api/public/payments/webhook` endpoint — no new payment code.
- Sandbox runs need the sandbox claimed (Step 1 in the Payments tab); if it isn't claimed yet, that step is done first.
- No changes to prices, plans, webhook logic, or P2P game-fee flows (which deliberately never touch Stripe).
