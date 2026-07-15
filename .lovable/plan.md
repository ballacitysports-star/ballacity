## Goal

Make `/games/$gameId/pay` obviously scannable in one glance: player sees the amount, picks a method, pays, uploads proof. No behavior changes — same server calls, same states, same guards, same tests.

## What's confusing today

Reading `src/routes/games.$gameId.pay.tsx` (1,499 lines), the current screen stacks 7+ visually similar rounded cards, each competing for attention:

1. Back arrow + title
2. Big lime "Game fee" card
3. Live roster strip
4. Payment status timeline (once submitted)
5. Approval badge pill
6. Approval gate card OR loading OR error OR "no methods" OR method list OR proof form
7. Refund policy card
8. Legal notice

There's no visible sense of "where am I in this flow", the fee card and roster card look the same weight, and the method → proof transition just swaps content in place with no step indicator.

## New shape — 3 clear steps, one visible at a time

Fixed structure, mobile-first, same max-w-md container:

```text
┌─────────────────────────────────────────┐
│  ← Sunday pickup soccer                 │  compact header
│    Dolores Park · Sun 6pm               │
├─────────────────────────────────────────┤
│  ● ── ○ ── ○     Step 1 of 3            │  slim stepper
│  Amount   Pay    Confirm                │
├─────────────────────────────────────────┤
│                                          │
│  $15.00                                  │  hero amount
│  Entry fee · pay by Sun 5pm              │
│                                          │
│  Roster 4/10 · 🟢🟢🟢🟢 +0 open         │  inline, one line
│                                          │
│  [ Continue to payment  → ]              │
└─────────────────────────────────────────┘
```

Step 2 (method + external launch):
```text
Step 2 of 3 — Pay the host
$15.00 due to @sam_venmo

┌─ Venmo ────────  [ Open Venmo ↗ ] ─┐
├─ Cash App ─────  [ Open Cash App ↗]│
└─ Zelle ────────  [ Copy details   ]┘

Already paid? [ I've sent it → ]
```

Step 3 (proof + submit) — same fields as today, just laid out as one card with clearer labels, inline error text, and a sticky submit bar at the bottom.

Post-submit and "waiting on host" become a **single status card** at the top that replaces the stepper, showing verified / pending / rejected with the existing 3-step timeline logic — same component, just visually reduced (no second heading, no double status pill).

Special states get their own single-purpose screens (still one card, no competing chrome):
- Approval-required (approval gate)
- Host hasn't configured payment
- Couldn't reach payment service (retry)
- Game just filled while paying

## Visual language

- One accent color for progress (lime). Warnings coral. Everything else neutral border/surface. No more cards fighting each other with lime backgrounds + coral badges + border tints in the same viewport.
- Typography: keep existing `font-display` for the amount and step titles; drop it from every subhead so the amount is unambiguously the loudest thing on screen.
- Spacing: consistent `space-y-4` between the stepper, the current step, and the footer. Remove the double borders where a card sits inside a bordered region.
- Icons: keep the current lucide set, but only one per row (today some rows have two).

## Implementation

Everything is presentation-only inside `src/routes/games.$gameId.pay.tsx`. No changes to:

- `src/lib/payments.ts` (RPC calls, submission logic, validation)
- Server functions, RLS, migrations
- Data fetching, realtime subscriptions, polling
- `data-testid` attributes used by the pay-flow e2e tests (`pay-live-roster`, `approval-status-indicator`, `approval-required-gate`, `payment-status-timeline`, submit button, etc.) — these stay on the same DOM nodes so the 13 pay e2e specs keep passing without changes.

Concretely:

1. Extract three small internal components inside the same file:
   - `PayHeader` (back + title + subtitle)
   - `PayStepper` (three dots + labels, driven by a `step: "amount" | "method" | "proof"` local state derived from `picked` and `mySubs`)
   - `PayStatusCard` (wraps existing `PaymentStatusTimeline` with the simplified header)
2. Rewrite the main `PayPage` return block to render:
   - `PayHeader`
   - Either `PayStatusCard` (if a submission exists) **or** `PayStepper`
   - Exactly one step body: amount summary, method picker, or proof form
   - Footer: refund policy (collapsed `<details>` when present) + `LegalNotice`
3. Keep `PaymentStatusTimeline` and `PaymentInstructionsAndProof` as-is internally; only their outer wrappers change.
4. Preserve all existing `role="status"`, `aria-live`, and `data-testid` attributes on the same semantic elements.
5. Add a small `useMemo` derivation for the current step so the stepper stays in sync with the existing state machine — no new source of truth.

## Files touched

- `src/routes/games.$gameId.pay.tsx` — presentation refactor only (~200 line diff, mostly JSX)

No new dependencies. No CSS token changes (reusing existing `lime`, `coral`, `surface`, `border` tokens from `src/styles.css`).

## Verification

- Manual: walk through each state in the preview (method picker, method with external URL, proof form, pending, verified, rejected, approval gate, no-methods empty state, retry state).
- Automated: `bunx playwright test e2e/pay-*.spec.ts` should pass unchanged since selectors and `data-testid`s are preserved.

## Out of scope

- Changing which fields the proof form collects
- Changing the approval/verification flow or database
- Redesigning the host's payment-review screen (separate surface)
- Dark/light-mode token changes

Ping me if you'd rather I open the current pay screen in the preview first and generate 3 rendered design directions to pick from — I couldn't capture it this pass because the preview session isn't signed in.
