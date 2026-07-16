## Goal

After a player joins a game, notify them if payment is required and reflect the full join → payment flow inline everywhere player-facing.

## Flow states (single source of truth)

Compute a `PlayerFlowStatus` per (game, user) from existing data — no schema changes:

```text
none → requested → approved → payment_pending → payment_submitted → payment_verified → confirmed
                 ↘ rejected                    ↘ payment_rejected
```

- `requested` = pending `join_requests` row
- `approved` = approved `join_requests` row, game requires payment, no submission yet → `payment_pending`
- `approved` + no fee → `confirmed`
- `payment_submitted` = latest `payment_submissions.status = 'pending'`
- `payment_verified` = latest submission verified → `confirmed`
- `payment_rejected` = latest submission rejected → back to `payment_pending`
- `rejected` = join_request rejected

Add `src/lib/game-flow-status.ts` with:
- `type PlayerFlowStatus` and `FlowStep` metadata (label, tone, icon)
- `computePlayerFlowStatus({ joinRequest, submissions, settings, isJoined })`
- `useMyFlowStatus(gameId)` hook that subscribes to join_requests + payment_submissions realtime and returns the derived status

## Post-join payment notification

In `src/lib/games-store.ts` `joinGame` (or its call sites in `games.$gameId.index.tsx` and the invite deep-link handler), after successful join:

1. Read `getGamePaymentSettings(gameId)`.
2. If `entry_fee > 0` and no verified submission:
   - `toast.success("You're in — payment required", { description: "$X due by <deadline>", action: { label: "Pay now", onClick: () => navigate({ to: "/games/$gameId/pay", params: { gameId } }) }, duration: 10000 })`
3. Render a persistent inline banner (new `src/components/PaymentRequiredBanner.tsx`) at the top of the roster/status card whenever `status === "payment_pending" | "payment_rejected"`. Banner shows amount, deadline countdown, "Pay now" primary CTA, and dismiss-per-session.

## Inline roster status pills

New `src/components/PlayerFlowPill.tsx` — small pill with icon + label + tone:

| Status              | Label            | Tone     |
| ------------------- | ---------------- | -------- |
| requested           | Requested        | muted    |
| approved            | Approved         | info     |
| payment_pending     | Payment due      | warning  |
| payment_submitted   | Awaiting review  | info     |
| payment_verified    | Paid             | success  |
| confirmed           | Confirmed        | success  |
| payment_rejected    | Payment declined | destruct |
| rejected            | Not approved     | destruct |

Wire it into every player-facing surface:

- **`src/routes/games.$gameId.index.tsx`** roster list — pill next to each participant. Host sees every player's full status (host-scoped fetch); non-host players see their own real status inline and other players show as `Confirmed`. Also show the pill in the current user's own "your status" card, replacing the ad-hoc badges already there.
- **`src/components/GameCard.tsx`** — status chip in the corner using `useMyFlowStatus(game.id)` when signed in and the user has any relationship to the game (join request or participant).
- **`src/routes/games.$gameId.pay.tsx`** — header pill + step indicator (Requested → Approved → Pay → Verified) using the same status. Replace the current bespoke "Awaiting host approval" / "Submitted" copy with the shared component.
- **`src/routes/_tabs.notifications.tsx`** / host join-request review list — show the same pill for consistency.

## Realtime

`useMyFlowStatus` subscribes to:
- `join_requests` filtered by `player_id=eq.<uid>` and `game_id=eq.<gid>`
- `payment_submissions` filtered by `player_id=eq.<uid>` and `game_id=eq.<gid>`

so every surface using the hook auto-updates when the host approves, or when a submission is verified/rejected, without a reload.

## Files

Create:
- `src/lib/game-flow-status.ts`
- `src/components/PlayerFlowPill.tsx`
- `src/components/PaymentRequiredBanner.tsx`

Edit:
- `src/routes/games.$gameId.index.tsx` (post-join toast, banner, roster pills, replace own-status badges)
- `src/routes/games.$gameId.pay.tsx` (header pill + step indicator)
- `src/components/GameCard.tsx` (status chip)
- `src/lib/games-store.ts` (surface payment-required signal from `joinGame`, or leave to caller — decide during impl based on existing return type)

No DB migrations. No changes to business logic — only presentation and post-join notification.
