## Remaining core-join-flow work

Three of the four deliverables from the approved plan already landed (pay auto-select, host-gated payment notice, Discover card quick-join CTA). This plan finishes the two remaining pieces.

### 1. Sticky action bar + status strip on `games/$gameId`

- Add a **`StickyActionBar`** rendered at the bottom of the details page (mobile-first, `fixed bottom-0` above `BottomNav`, safe-area padded). It shows exactly one primary action derived from the viewer's current state:
  - Not signed in → `Sign in to join`
  - Host → `Manage` (scrolls to / opens existing host controls; no new sheet, keeps scope tight)
  - Joined + game scheduled → `You're in` (secondary `Leave`)
  - Approval required, no request → `Request to join`
  - Request pending → `Awaiting approval` (disabled)
  - Request approved / no-approval + unpaid + `price > 0` → `Pay $X` (deep-links to `/games/$gameId/pay`)
  - Payment submitted, awaiting host verify → `Payment pending review` (disabled)
  - Free + open + not joined → `Join free`
  - Full / completed / live / closed → disabled label matching current copy
- Add a compact **"Your status"** strip near the top of the page (above the fold) that summarizes request → payment → roster in a single row for the current viewer. It reuses data already fetched by the page; no new queries. Existing `RequestStatusPanel` stays as the source of truth for detail — the strip is a one-line summary that links to it.
- Add bottom padding to the page's scroll container so the sticky bar never covers the last section.
- No route changes, no accordion collapse this pass (was optional polish; deferred to keep the diff small and low-risk for the e2e suite).

### 2. Shared `PrimaryCTA` component

- New `src/components/PrimaryCTA.tsx`: single button primitive with `variant` (`primary` lime-gradient, `secondary` outlined, `disabled` muted), `loading`, `icon`, and `asChild`-style support for wrapping `<Link>`. Height/radius/typography match the current lime CTA on the Discover card.
- Refactor call sites to use it:
  - `GameCard.tsx` quick-join button + fallback pill
  - `games.$gameId.index.tsx` primary Join/Request/Pay button and the new sticky bar
  - `games.$gameId.pay.tsx` `Submit payment` button
- No visual redesign beyond consistency — same colors, same states.

### Out of scope
- Accordion collapse of About / Reviews / Payment summary sections.
- Host `Manage` sheet (host controls stay in place).
- Any route, RLS, or data-layer changes.

### Verification
- Manual tap-count walkthrough for the four viewer states (free, approval-only, paid-only, approval+paid). Target: ≤2 taps Discover → advancing action; ≤1 screen approved → submit payment.
- `tsgo --noEmit` clean.
- Existing `e2e/invite-*`, `e2e/pay-*`, `e2e/join-*` specs still pass (selectors on primary CTAs are label-based, so `PrimaryCTA` swap must preserve accessible names — verified in the refactor).
