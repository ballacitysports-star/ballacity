Goal: Remove the inline reviews section from the profile page and open it in a modal dialog when the user taps the review count.

Changes:

1. Add a controlled reviews dialog to the profile route
   - Keep `useState` for `reviewsOpen` in `src/routes/_tabs.profile.tsx`.
   - Wrap the existing `<ReviewsSection revieweeId="me" revieweeKind="player" revieweeName={me.name} isOwner />` inside a `Dialog` from `src/components/ui/dialog.tsx`.
   - Remove the inline `<ReviewsSection />` from the page body.

2. Make the reputation badge clickable
   - Update `src/components/ReputationBadge.tsx` to accept an optional `onClick` prop.
   - When `onClick` is provided, render the badge as a button with hover/active affordance and add `cursor-pointer`.
   - Wire the badge's `onClick` to `setReviewsOpen(true)` in the profile route.

3. Add a "Reviews" stat tile to the stats grid
   - In the 4-column grid on the profile, add a tile showing `myRep.count` + "Reviews".
   - Make the tile clickable and wire it to the same `setReviewsOpen(true)` handler.

4. Keep the dialog content identical
   - Reuse the current `ReviewsSection` and `ReputationCard` inside the dialog without changing their content or filters.

Outcome: The profile page loses its long inline reviews block; tapping either the reputation badge's review count or the new stats-grid Reviews tile opens the same reviews popup.