# Signup cutoff + in-progress lockout

Games stop accepting new players automatically: once a game is under way it shows **In progress**, and inside a host-chosen blackout window before start it shows **Signup closed**.

## Host setup

- In game create and game edit, a new "Signup cutoff" preset picker: Off (default), 15 min, 30 min, 1 hour, 2 hours, 24 hours before start.
- The manual "Close joins" toggle stays as-is and still wins when the host closes early.

## What players see

- Before the cutoff: current behavior (Request to join / Pay).
- Inside the blackout window: badge and CTA read **Signup closed**, with the reason ("Signups closed 30 min before start"). Button disabled.
- After start time (or host pressed Start): badge and CTA read **In progress**. After the end time: **Ended**.
- Applies consistently on the game detail page, game cards in the feed, and list rows.

## Rules

- Blackout blocks **new** activity only: new join requests, position joins, and waitlist sign-ups. Already-approved players can still submit and complete payment, and hosts can still approve or decline requests that were already pending.
- Pending requests are left pending — nothing is auto-expired.
- Status is derived from real time, not only the host's manual flag, so a game that started without the host tapping "Start game" is still locked.

## Technical notes

- Migration: add `signup_cutoff_min integer not null default 0` to `public.hosted_games`; map it through `src/lib/hosted-games-store.ts` (`signupCutoffMin`) and the `Game` type in `src/lib/sample-data.ts`.
- Extend `src/lib/live-status.ts` with a single resolver, e.g. `resolveJoinGate(game, now)` returning `{ liveStatus, joinState: "open" | "closed_by_host" | "closed_cutoff" | "in_progress" | "completed" | "full", label, reason }`. All surfaces read this instead of ad-hoc `game.status === "in_progress"` checks.
- `src/routes/games.$gameId.index.tsx`: replace the raw `game.status`/`game.joinsClosed` checks in the join handler, the position-join/waitlist `canJoinAs`/`canWaitlist` predicates, and the CTA block with `joinState`; keep payment actions enabled for approved players.
- `src/components/GameCard.tsx` and `src/components/GameListRow.tsx`: render the new badge from `joinState` (replacing the current `joinsClosed`/`in_progress` badges).
- Server-side enforcement: update the `validate_join_request` trigger to reject inserts when the game has started or `now() >= date - signup_cutoff_min` (payment submissions and host approvals untouched), so the lockout can't be bypassed.
- Host controls card copy in the game detail page reflects the cutoff state.
