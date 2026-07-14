## Scope
Optimize the **core join flow** only. Redesign three screens with the single goal of **fewer taps to join a game**. Preserve every current feature and route.

Screens in scope:
1. `_tabs.discover.tsx` — game list card
2. `games.$gameId.index.tsx` — game details (currently ~2700 lines, dense)
3. `games.$gameId.pay.tsx` — pay screen (currently ~1400 lines, two-step picker)

Out of scope: create, teams, profile, admin, messages, notifications, settings. No route renames. No color-palette overhaul (kept lime/coral). No DB changes.

---

## Current friction (measured in taps)

Free game: card → details → Join = **3 taps**. Fine.
Paid + approval: card → details → Request → wait → details → Pay → pick method → mark paid + upload → submit = **~7 taps** across 2 sessions. This is the target.

Other pain points observed on details:
- Primary action (Join/Request/Pay) is not visually dominant; competes with sport chips, host card, roster, reviews, payment-summary card, host-only controls.
- "Requires approval" vs "requires payment" are shown as separate states; users read them as one gate.
- Pay screen has a separate step just to pick a method before entering proof.

---

## Changes

### 1. Discover card → one-tap intent
- Move the price + "spots left" + sport into a single meta row under the title (currently stacked).
- Add a **primary CTA on the card itself** ("Join" / "Request" / "Pay $X" / "Full"), driven by existing `spots-left` and `game_payment_settings`. Tapping the CTA deep-links straight to the correct destination (details for free/approval, `/pay` for paid-already-approved). Tapping the card body still opens details.
- Result: signed-in users who trust a game can go **card → action = 2 taps**.

### 2. Game details → sticky action bar + collapsed sections
- Add a **sticky bottom action bar** (mobile-first) that always shows the single primary action for the viewer's state:
  - `Join` (free, not joined)
  - `Request to join` (approval required, no request)
  - `Awaiting approval` (disabled, with subtle spinner)
  - `Pay $X` (approved or no-approval-required, unpaid)
  - `Payment pending review` (disabled)
  - `You're in` + `Leave` secondary
  - Host: `Manage` (opens edit modal)
- Collapse "Payment settings summary", "About the run", and "Reviews" into accordion sections (default-open only for the one relevant to the current state). Reduces scroll before the CTA is reachable.
- Merge the approval + payment status panels into one **"Your status"** strip at the top of the page (single row: request state → payment state → in roster). Replaces `RequestStatusPanel` + duplicate messaging.
- Host-only controls (End game, Joining closed, etc.) move behind a single `Manage` sheet.

### 3. Pay screen → one screen, one submit
- Collapse the two-step "pick method → enter proof" into a single scrollable screen: methods render as a compact radio list at the top, proof form directly below, one `Submit payment` button at the bottom.
- Auto-select the host's default / only-enabled method so single-method games are zero-tap on the picker.
- Move refund policy + host instructions into a collapsible "Details" strip (open by default when non-empty, but out of the primary path).
- Keep `PaymentStatusTimeline` unchanged.

### 4. Shared polish (only where it supports the flow)
- Standardize the primary CTA button to one component (`PrimaryCTA`) used on card, details bar, and pay submit — same height, radius, `lime-gradient`, disabled/loading states.
- Consistent 16px page padding, 12px vertical rhythm between cards on the three screens.
- Empty-state copy on details when not signed in: single "Sign in to join" CTA instead of two competing prompts.

---

## Not doing
- No renaming or removing routes.
- No changes to `joinGame`, `createJoinRequest`, `reviewSubmission`, RLS, or realtime plumbing.
- No changes to host verify queue (`/payments`) — already redesigned last turn.
- No global nav / bottom-tab changes.
- No new dependencies.

## Verification
- Manual tap-count walkthrough for the four viewer states (free, approval-only, paid-only, approval+paid) — target ≤2 taps from Discover to the action that advances state, and ≤1 screen between "approved" and "submit payment".
- Regression: existing e2e specs under `e2e/invite-*`, `e2e/pay-*`, `e2e/join-*` must still pass.
- Typecheck (`tsgo`) and existing vitest suites green.

## Deliverable order
1. Sticky action bar + status strip on details (biggest single win).
2. Pay screen collapse to one submit.
3. Discover card inline CTA.
4. Shared `PrimaryCTA` + polish sweep across the three screens.
