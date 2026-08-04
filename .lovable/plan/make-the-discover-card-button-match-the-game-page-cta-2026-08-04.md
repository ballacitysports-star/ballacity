# Make the Discover card button match the game page CTA

The game page now treats every game as request-to-join unless the host turned approval off, so its button reads "Request to join · N spots left". The card on Discover/Feed still says "Join free" and joins instantly on tap, which contradicts that.

## What changes

1. **Card label mirrors the game page**
   - Free, open, scheduled games read `Request to join` instead of `Join free`.
   - Paid games keep `Pay $X`, and `You're in` / `Full` / `Live now` / `Completed` / `Sign in to join` stay exactly as they are.

2. **No more instant join from the card**
   - The quick-join tap is removed: tapping the card button opens `/games/:gameId`, where the real request flow (and the host's approval settings) lives. This is the same reason paid and approval-gated games already route there.

3. **Existing request state still shows**
   - The status pill on the card (Requested / Approved / Pay / Confirmed…) keeps working unchanged; when the viewer already has a request, the button shows that state instead of "Request to join".

## Technical notes

- `src/components/GameCard.tsx` only: drop `canQuickJoin` / `quickJoin` (and the now-unused `joinGame` import), and change the free-game branch of `ctaLabel` to `Request to join`. Render the single non-interactive CTA block inside the existing `<Link>` so the whole card navigates.
- Presentation-only; no changes to `games-store`, `payments.ts`, or any migration.
- Existing e2e specs match on game-page labels, not card labels, so no spec updates expected.
