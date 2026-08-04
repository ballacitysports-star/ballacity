# Remove GameCard CTA action pill

## Goal
Remove the selected "Request to join" action pill from the `GameCard` component so the card no longer shows a call-to-action button at the bottom.

## What to change
- **File**: `src/components/GameCard.tsx`
- Remove the bottom CTA `<div>` (lines 258–276) that renders the "Request to join" / "Pay" / "You're in" / "Full" / etc. pill.
- Remove now-unused imports: `Check` and `CreditCard` from `lucide-react` (confirm `CreditCard` is not used elsewhere in the file before deleting).
- Leave the rest of the card intact: image, sport badges, host info, participant count, progress bar, and `PlayerFlowPill`.

## Verification
- Run a TypeScript/build check to ensure no removed variables are still referenced.
- Spot-check a feed or games list in the preview to confirm the card no longer shows the bottom action pill.
