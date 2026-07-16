## Add a Payments tab to the game page

Add a dedicated **Payments** tab on `/games/$gameId` for both host and player views, keeping existing details/roster UI intact.

### Tab shell
- In `src/routes/games.$gameId.index.tsx`, wrap the page body in a lightweight tab switcher: **Overview** (current content) and **Payments**. Tab state via `useState`, defaulting to Overview. Payments tab shows a badge with the pending count (host: pending submissions to review; player: my current status if not verified).
- Only render the Payments tab when the game has payment settings enabled (paid game). For free games, hide it entirely.

### Host view — Payments tab
- Header: game fee, payment method summary, counts (Pending N · Verified N · Rejected N).
- **Pending queue** (default section): list of `payment_submissions` with `status = 'pending'`, newest first. Each row shows player avatar/name, submitted amount, timestamp, note, and thumbnail/link to proof. Actions: **Approve** and **Decline** (with optional reason prompt). Reuses existing `setPaymentStatusAction` logic (extracted from the current per-player popover) — server-side call plus optimistic update and `payment_verified` / `payment_rejected` notifications.
- **All submissions** section below: filterable (All / Verified / Rejected / Pending) table of every submission with same actions available on non-pending rows (re-verify, reject).
- Realtime: subscribe once per game to `payment_submissions` changes (already present per-player; broaden to game scope) so approvals/new submissions update the list live.
- Empty state: "No payment submissions yet — players will appear here once they send proof."

### Player view — Payments tab
- Status card at top with a clear state pill:
  - **Not submitted** → CTA "Send payment proof" (links to `/games/$gameId/pay`).
  - **Pending review** → "Your payment is being reviewed by the host." Show submitted amount, when, and proof thumbnail.
  - **Verified** → "Payment verified — your spot is locked in." Timestamp + verified-by.
  - **Declined** → Reviewer note (if any) + CTA "Resubmit payment proof".
- **My history** section: list of my previous submissions for this game (status, amount, date, proof link).
- Realtime: reuses existing per-player `payment_submissions` channel so status flips instantly on host action.

### Shared bits
- Extract two components into the same route file (keep the file self-contained, matching existing patterns): `HostPaymentsPanel` and `PlayerPaymentsPanel`.
- Reuse existing helpers: `reviewJoinRequest`, `setPaymentStatusAction`, `payment_submissions` query shape from the current host popover code (~line 2856+).
- No schema changes required — all needed columns (`status`, `amount`, `proof_url`, `note`, `reviewer_notes`, `verified_at`) exist on `payment_submissions`.

### Verification
- `bunx tsgo --noEmit`
- Manual: as host on a paid game, submit a payment as a second account → Payments tab shows badge → Approve → player's tab flips to Verified live.
