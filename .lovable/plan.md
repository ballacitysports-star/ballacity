
## Goal

Make roster status feel alive at every step of the join flow. Users should see spots ticking down in real time on browse surfaces, on the details header, while they're paying, and immediately after they join — with an escalating urgency signal when the game is nearly full.

## What changes

### 1. Shared urgency helper — `src/lib/spots-urgency.ts` (new)
Small pure helper `getSpotsUrgency(spotsLeft, maxPlayers)` returning `"full" | "critical" | "low" | "normal"`:
- `full` — 0 left
- `critical` — 1–3 left
- `low` — ≤20% of capacity (and >3)
- `normal` — otherwise

Unit tests in `src/lib/spots-urgency.test.ts`.

### 2. Upgrade `SpotsPill` — `src/components/SpotsPill.tsx`
- Accept optional `maxPlayers` prop.
- Coral background + soft `animate-pulse` ring at `critical`.
- Amber tint at `low`.
- Keep existing lime for `normal`, destructive for `full`.
- Preserve existing `role="status"` / `aria-live` politeness rules; escalate to `assertive` at `critical` as well as `full` (label reads e.g. "Only 2 spots left — filling fast").
- Existing consumer (Discover bottom card) keeps working; new callers can pass `maxPlayers`.

### 3. Discover + Feed card counters — `src/components/GameCard.tsx`
- Already renders a static `joined/max` badge; wire it to `useLiveParticipantCount(game.id)` with fallback to `game.joined`.
- Swap the plain badge for `SpotsPill` (compact variant) so urgency styling is consistent with the details header.
- No layout change beyond color/pulse.

### 4. Game details header — `src/routes/games.$gameId.index.tsx`
- The "Roster (X/Y)" header already reads live count. Add a `SpotsPill` next to the header showing `spotsLeft` with urgency styling, so users see the same signal above the roster list they see on the cards.
- Compact live avatar strip (first 5 participants + "+N") already exists via `useLiveParticipants`; unchanged.

### 5. Pay screen live roster — `src/routes/games.$gameId.pay.tsx`
- Add a compact live roster strip at the top of the pay screen:
  - `SpotsPill` with urgency (from `useLiveParticipantCount` + game max).
  - Avatar row of current joiners (from `useLiveParticipants`, capped at 6 + overflow count).
  - If spots hit 0 while the user is on this screen, show an inline warning banner: "This game just filled up while you were paying — your spot is not guaranteed. Contact the host before submitting." (Does NOT disable the submit button; host still resolves manually.)
- Placement: directly above the payment method picker, below the existing header.

### 6. Post-join confirmation feedback — details page
- After a successful join on `games.$gameId.index.tsx`, briefly surface a lime toast-style strip: "You're in — spot X of Y locked" using the freshly incremented live count. Reuse the existing "Your status" strip slot for paid games; for free games render a transient (5s) confirmation strip.
- No new toast lib; use a local dismissible element with `role="status"` `aria-live="polite"`.

### 7. Sample-data path (`g1` etc.)
`useLiveParticipantCount` only counts real Supabase `game_participants` rows; sample games have none, so `liveCount` stays `undefined` and static `game.joined` is used — matching current behavior. No change needed.

## Technical details

- No schema changes. `game_participants` is already in the realtime publication (existing `useLiveParticipantCount` / `useLiveParticipants` subscriptions work).
- Urgency helper is pure, tree-shakeable, and unit tested; no runtime deps.
- `SpotsPill` change is backward compatible (`maxPlayers` optional). All existing selectors used by e2e specs (`text=/\d+\/\d+/`, "Full", "N spots") remain intact — we only add classes and refine the aria-label.
- Reduced-motion: pulse ring wrapped in a `motion-safe:` variant so users with `prefers-reduced-motion` see the color change without animation.
- No changes to join/leave RPCs, RLS, or business logic — presentation layer only.

## Files touched

- new `src/lib/spots-urgency.ts`
- new `src/lib/spots-urgency.test.ts`
- edit `src/components/SpotsPill.tsx`
- edit `src/components/GameCard.tsx`
- edit `src/routes/games.$gameId.index.tsx`
- edit `src/routes/games.$gameId.pay.tsx`

## Out of scope

- Waitlist auto-promotion, push notifications on fill, or map-marker recoloring by fill state (can follow in a separate pass).
