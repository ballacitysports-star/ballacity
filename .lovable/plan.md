## What I verified so far

- The player route exists and works: `/players/<uuid>` returns a real rendered "Player profile" page both on the local dev server and on the published site.
- Every player card link I found (`profile` tab game cards, followers/following sheet, players tab, map, messages, game pages) uses the correct typed link `to="/players/$userId"` — none build the URL by hand.
- The "404" screen you saw is the app's own not-found screen in `src/routes/__root.tsx`, which currently shows only a big "404" with no indication of which URL failed.

So the diagnosis is **not confirmed yet**: something is producing a URL the router can't match (most likely a card rendered with a missing/empty user id, so the link resolves to something like `/players/` or `/players/undefined`), but I can't prove which card without seeing the failing URL.

## Plan

1. **Make the 404 page self-diagnosing (and more useful anyway)**
   - Update the not-found component in `src/routes/__root.tsx` to show the attempted path, plus "Go back" and "Go home" buttons.
   - Log the unmatched path to the console so it shows up in preview logs.

2. **Reproduce and identify the failing card**
   - With the path visible, reproduce the click from the Profile tab and capture the exact URL.

3. **Fix the root cause**
   - If the id is missing/empty: guard the card so it renders as non-clickable (or links to the correct target) when there's no user id, at the component that produced it — and apply the same guard to the sibling cards that share the pattern (game host avatar, followers/following rows, roster chips).
   - If the id is present but the route genuinely doesn't match, fix the route/link mismatch instead.

4. **Verify** by clicking through the Profile tab cards (game host, followers, following) and confirming each lands on the player page, and that a card with no linked account no longer navigates anywhere.

## Technical notes

- Files likely touched: `src/routes/__root.tsx` (not-found UI), and whichever of `src/components/GameCard.tsx`, `src/components/FollowSheet.tsx`, `src/components/RequestGameCard.tsx` turns out to emit the bad link.
- No database or backend changes are needed for this.
