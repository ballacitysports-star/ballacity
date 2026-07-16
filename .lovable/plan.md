## Fix

Make every "approval banner" — the ad-hoc panels that today say variations of "You're approved" / "Approved — you can pay now" — render **"Payment due"** for paid games until the host verifies the payment. Presentation only, no store/DB changes.

### Rule (one source of truth)

For a viewer on a paid game (`entry_fee > 0`), the approval banner's copy is chosen from `useMyFlowStatus(gameId).status`, not from `join_request.status`:

| Flow status         | Approval banner copy                                              |
| ------------------- | ----------------------------------------------------------------- |
| `requested`         | "Waiting for host approval" (unchanged)                           |
| `rejected`          | "Request declined" (unchanged)                                    |
| `payment_pending`   | **"Payment due — submit payment to lock your spot"** + Pay CTA    |
| `payment_submitted` | **"Payment sent — waiting on host to confirm"**                   |
| `payment_rejected`  | **"Payment declined — resubmit to keep your spot"** + Pay CTA     |
| `payment_verified`  | "Payment confirmed — you're on the roster"                        |
| `confirmed` (free)  | "You're approved — see you there!" (unchanged, free games only)   |

Never show "Approved — you can pay now" or "You're on the roster" for a paid game whose latest submission is not `verified`.

### Files

1. **`src/routes/games.$gameId.index.tsx`** — Approval status banner (~line 936–990):
   - Replace the current `myReq.status`-driven copy with a switch on `myFlowStatus` (already computed in this file via `useMyFlowStatus`).
   - Free game path (no `entry_fee`) keeps today's approved copy.
   - Paid game: render "Payment due" (or the matching row above) whenever `payment_verified` hasn't been reached.
   - Keep the existing icon tokens (Clock / Check / X) but pick them from the flow status too.

2. **`src/routes/games.$gameId.pay.tsx`** — `approval-status-indicator` (~line 502–528):
   - Same switch. When paid and `status !== "payment_verified"`, render "Payment due" instead of "Approved — you can pay now". Keep the `data-testid="approval-status-indicator"` and `data-status` attributes so existing e2e specs still match, but set `data-status` from the flow status (`payment_pending` / `payment_submitted` / `payment_verified` / `payment_rejected` / `requested` / `rejected`).

3. **`src/routes/games.$gameId.index.tsx`** — "Compact your-status strip for paid games" (~line 992–1020):
   - Same switch, so this strip and the approval banner never disagree. Drive copy off `myFlowStatus`; keep the strip visible whenever `myFlowStatus` is any paid-flow state, not just when `latestSub` exists (so an approved-but-unpaid player also sees "Payment due" here).

### Out of scope

- No changes to `game-flow-status.ts`, `PlayerFlowPill`, `PaymentRequiredBanner`, `PaymentStatusTimeline`, or business logic.
- The false "Try again" on the pay page is a separate issue — not touched here.

## Verification

- Paid game, host approves → both surfaces show "Payment due" (never "You're approved").
- Player submits proof → both surfaces flip to "Payment sent — waiting on host".
- Host verifies → both flip to "Payment confirmed".
- Host rejects payment → both show "Payment declined — resubmit".
- Free game, host approves → unchanged "You're approved — see you there!".
- Existing pay-page e2e specs continue to find `data-testid="approval-status-indicator"` with a valid `data-status`.
