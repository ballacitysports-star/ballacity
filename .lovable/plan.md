Goal: Hide the inline reviews section on player/game/team pages and open it in a popup when the user taps the reputation badge.

The profile page already uses this pattern (`ReputationBadge onClick -> Dialog with ReviewsSection`). I will replicate the same pattern across the three public-facing routes that currently show inline reviews.

Changes:

1. Player profile (`src/routes/players.$userId.tsx`)
   - Import `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`.
   - Add `reviewsOpen` / `setReviewsOpen` state.
   - Add `onClick={() => setReviewsOpen(true)}` to the existing `<ReputationBadge rep={rep} />`.
   - Remove the inline `<ReviewsSection>` block near the bottom of the page.
   - Add a `<Dialog open={reviewsOpen} onOpenChange={setReviewsOpen}>` at the end of the component, containing the `<ReviewsSection>` with the same props (revieweeId, revieweeKind, revieweeName, isOwner).

2. Game detail (`src/routes/games.$gameId.index.tsx`)
   - Import the same Dialog primitives.
   - Add `reviewsOpen` / `setReviewsOpen` state.
   - Add `onClick={() => setReviewsOpen(true)}` to `<ReputationBadge rep={hostRep} />`.
   - Remove the inline host `<ReviewsSection>` block below the reputation badge.
   - Add a Dialog containing the host `<ReviewsSection>` with the same props.

3. Team page (`src/routes/teams.$teamId.tsx`)
   - Import the same Dialog primitives.
   - Add `reviewsOpen` / `setReviewsOpen` state.
   - Add `onClick={() => setReviewsOpen(true)}` to `<ReputationBadge rep={orgRep} />`.
   - Remove the dedicated `reviews` tab from the tab bar and the associated `tab === "reviews"` branch.
   - Add a Dialog containing the team `<ReviewsSection>` with the same props.

4. Styling / consistency
   - Reuse the same Dialog styling as the profile page (`max-h-[90dvh] overflow-y-auto p-0 sm:max-w-xl`, with a screen-reader-only `DialogHeader`).
   - Keep the existing `isOwner` flags (they gate private reviews) unchanged.

Outcome: Tapping the reputation badge on any profile, game host, or team page opens a popup with the full reviews section; the inline reviews section is removed from the page layout.