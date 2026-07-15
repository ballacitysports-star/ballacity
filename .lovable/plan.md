## Goal
Let the host verify or reject a player's payment directly from the roster row in game details, without leaving the page.

## Where
`RosterPlayerRow` in `src/routes/games.$gameId.index.tsx` (~lines 2631–2827). Only shown to the host on paid games (already gated by `feeRequired`).

## Changes

### 1. Track the latest submission, not just its status
In the existing `loadPayment` effect, also capture `id` and `screenshot_path`:
- Replace local `paymentStatus` state with `latestSub: { id, status, screenshot_path } | null`.
- Derive `paymentStatus` from `latestSub?.status ?? "none"` so the existing chip logic is unchanged.
- Realtime channel already refetches on change — keeps action buttons in sync when the player submits/resubmits.

### 2. Add inline action buttons next to the payment chip
Below (or beside) the chip row, render host actions based on current status:
- `pending` → **Verify** (primary/lime) and **Reject** (coral) buttons.
- `rejected` → **Verify** button (allow override).
- `verified` → **Mark unpaid** button (revert to `pending`) — useful if verified by mistake.
- `none` (no submission yet) → **Mark as paid** button (creates a host-recorded submission with `status: "verified"`, `payment_type: null`, `notes: "Marked paid by host"`).

Buttons are compact pill style consistent with existing Remove/Block buttons.

### 3. Wire actions
- Verify / Reject / Mark unpaid → call existing `reviewSubmission(latestSub.id, status, notes?)` from `@/lib/payments`.
- Mark as paid (no submission exists) → insert into `payment_submissions` via a new small helper in the same file (or inline supabase call) with `player_id: req.player_id`, `game_id: req.game_id`, `host_id: req.host_id`, `status: "verified"`, `notes: "Marked paid by host"`, `paid_at: now`.
- After success: optimistic `setLatestSub` update, toast, and send a notification to the player (`createNotification`) — `payment_verified` / `payment_rejected` (reuse existing notification types if present, otherwise `join_approved`-style generic).
- Wrap each action in a `busy` guard reusing the existing `busy` state.

### 4. Optional: "View proof" link
If `latestSub?.screenshot_path`, show a small "View proof" link that calls `getSignedProofUrl` and opens the URL in a new tab.

## Out of scope
- No DB/schema changes (RLS already permits host to update `payment_submissions` — that's how the existing host review screen works).
- No changes to the player-facing pay flow.
- No changes to the payments list route.

## Files touched
- `src/routes/games.$gameId.index.tsx` (RosterPlayerRow only)
