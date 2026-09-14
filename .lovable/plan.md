# Remove the "ballaCity Pro" upgrade card from profile settings

The coral "ballaCity Pro — AI highlight reels, unlimited hosting … Upgrade · $7.99 / mo" block on the profile settings page goes away entirely.

## What changes

- That whole section, including its heading, promo text and the "Upgrade · $7.99 / mo" button, is deleted from the profile settings page.
- Nothing else on the page moves: the "AI Highlight Reels" row above it and the "Plans & subscriptions" row below it stay exactly as they are, so people can still reach reels and plans.
- No pricing, plan or billing logic is touched — this card was display-only and its button did nothing.

## Technical notes

- Delete lines 583-600 of `src/routes/profile.edit.tsx` (the `<Section title="ballaCity Pro">` block).
- Drop the now-unused `framer-motion` `motion` import from that file; keep the `Video` icon import, still used by the AI Highlight Reels row.
- No other files, routes, or config change.
