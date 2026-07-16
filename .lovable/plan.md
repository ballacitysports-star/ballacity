## Goal
Add a clearly visible "Leave" / "Cancel request" control on every screen of the join flow, so a player can back out at any stage (pending request, approved-awaiting-payment, payment submitted, verified) without hunting for the sticky bar on the game details page.

Today, the only place that exposes cancel/withdraw is the sticky CTA on `/games/$gameId`. Once a player advances to `/games/$gameId/pay` (or is deep-linked there from an invite/notification), there is no exit — they must navigate back and find the sticky bar. This plan fixes that.

## Scope

Frontend / presentation only. No schema or business-logic changes — reuses existing `cancelMyJoinRequest` and `withdrawMyApprovedJoinRequest` in `src/lib/payments.ts`.

## Changes

### 1. New shared control: `LeaveFlowButton`
`src/components/LeaveFlowButton.tsx` — small button + `AlertDialog` confirmation that:
- Reads `useMyFlowStatus(gameId)` to pick the correct action and copy:
  - `requested` (pending) → "Cancel request" → `cancelMyJoinRequest`
  - `approved` / `payment_*` (approved, not yet verified) → "Withdraw from game" → `withdrawMyApprovedJoinRequest` (+ best-effort delete of the latest pending `payment_submissions` row so the pay screen resets)
  - `confirmed` (verified / on roster) → "Leave game" → `withdrawMyApprovedJoinRequest` + `leaveGame(gameId)`
  - `none` / `rejected` → render nothing
- Shows a toast on success/error, then navigates back to `/games/$gameId` (configurable via prop).
- Variants: `"link"` (compact text link for headers/footers) and `"danger"` (full-width `PrimaryCTA` for sticky footers).

### 2. Pay screen (`src/routes/games.$gameId.pay.tsx`)
- Add a compact `LeaveFlowButton variant="link"` in the header row next to `PayFlowPillHeader`, so it's always reachable regardless of stage (waiting for approval, picking method, submitting proof, awaiting verification).
- In the approval-gate card (`approvalGateActive` branch, ~line 524), add a secondary "Cancel request" link under the "Back to game" button when `myReq.status === "pending"`.
- In `PaymentInstructionsAndProof` footer (near the existing `onCancel` "back" link, ~line 1117), keep the current "Back to methods" cancel and add a separate "Withdraw from game" link that triggers the shared button's flow.

### 3. Game details sticky bar (`src/routes/games.$gameId.index.tsx`)
- No behavior change to the existing sticky CTA. Add a small `LeaveFlowButton variant="link"` under the "Payment pending · Tap to withdraw" / "Request pending · Tap to cancel" hint so the leave path is discoverable as its own affordance (some users don't realize tapping the primary CTA cancels).

### 4. Requests list card (`src/components/RequestGameCard.tsx`)
Already exposes Cancel for pending requests. Extend the player-side (`!isHost`) branch to also render a "Withdraw" button when `request.status === "approved"` (currently only pending shows an action). Wire it to a new `onWithdraw` prop; the parent page (requests list in `_tabs.profile.tsx` / wherever this is used) passes `withdrawMyApprovedJoinRequest`.

### 5. Copy & confirmation
Confirmation dialog copy varies by stage:
- Cancel request: "Cancel your request to join {title}? You can request again later."
- Withdraw before payment verified: "Withdraw from {title}? Your spot will be released and any pending payment submission will be cleared."
- Leave confirmed: existing "Leave this game?" copy reused.

## Non-goals
- No refund logic — the withdraw dialog explicitly says "contact the host about refunds" when a verified payment exists (matches current behavior).
- No changes to host-side approve/decline.
- No schema, RLS, or server-function changes.

## Verification
- Typecheck (`bunx tsgo --noEmit`).
- Manual: pending → cancel from pay screen; approved+unpaid → withdraw from pay screen; verified → leave from pay screen; pending → withdraw from requests list card.
- Existing e2e specs (`leave-*`, `pay-*`, `invite-request-*`) should still pass — no changes to selectors or primary CTAs.
