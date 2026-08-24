Add a “Free” plan card to the subscription page and reels page so users can see what comes with a standard free account.

## Plan

1. Define a canonical free tier in `src/lib/catalog.ts`.
   - Add a `FREE_TIER` `PlanTier` with `priceId="free"`, `priceLabel="Free"`, and a features list that reflects the standard free account:
     - Create your player profile & availability
     - Browse and request to join games
     - Discover players, teams, trainers, and gyms
     - 3 free AI highlight reels
     - Messaging & push notifications
   - Keep the existing `PLAN_TIERS` array unchanged; the free tier will be rendered separately or inserted first, depending on the page.

2. Render the free tier on `/plans` (`src/routes/plans.tsx`).
   - Insert the free plan card as the first card in the plan grid.
   - Reuse the existing card styling (border/border-border bg-surface), no highlight.
   - The free card’s button is disabled and shows “Included” instead of a checkout CTA.
   - Guard `handleSubscribe` so it never tries to open checkout for `priceId === "free"`.

3. Render free-account benefits on `/reels` (`src/routes/_tabs.reels.tsx`).
   - Below the current subscription/free-trial section, add a compact “Free account includes” card using the same free features list.
   - Keep the existing “Subscribe” / “Free trial” / “Manage billing” UI intact.

4. Verify in preview.
   - Check `/plans` shows the free card first, disabled, with the listed features.
   - Check `/reels` shows the free benefits card when the user is not on an active subscription.

## Technical notes
- No checkout flow or server function changes are needed.
- No Data API/RLS changes are needed.
- Uses existing Tailwind design tokens and `PlanTier` shape.
