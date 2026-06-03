# Demo-Ready Stability Pass

Scope you picked: fix the known hydration crash, walk every route end-to-end and repair anything that's broken, and enable Lovable Cloud so we have a real backend to migrate to next. Treating this as **Phase 1** of a multi-phase production push — backend migration of stores (reviews, joins, teams, orgs) is Phase 2.

## Phase 1 — what I'll do this turn

### 1. Fix the hydration crash (Critical)
- Error: server rendered `52`, client rendered `50` inside the sports grid on `/`.
- Cause: `SPORTS` counts in `src/lib/sample-data.ts` are derived from `Math.random()` or `Date.now()` at module init, so SSR and client compute different numbers.
- Fix: make the count either a static seeded value, or render it client-only via `useHydrated()` / `<ClientOnly>` fallback.

### 2. Route + interaction audit (every page)
For each route I'll click every button, link, form, and tab in the browser tool at 390×844 (mobile) and note + fix anything broken. Routes to cover:
- `/` (Landing)
- `/feed`, `/discover`, `/create`, `/notifications`, `/profile`, `/teams`
- `/games/$gameId`
- `/teams/$teamId`, `/teams/$teamId/edit`, `/teams/create`
- `/reviews`, `/review/new`
- 404 / not-found fallback

Specific things I'll verify and repair:
- All `<Link to=...>` targets resolve (no dead routes).
- Bottom nav highlights match the active route.
- Join / Leave game (already fixed — re-verify).
- Write review flow from trainer, team, game host, player profile pre-fills correctly and submits.
- Create team / edit team / delete team round-trip.
- Profile reputation badge + reviews hub render with zero reviews (empty states).
- No console errors or hydration warnings on any route.

### 3. Mobile polish (light)
- Confirm sticky CTAs don't cover content on iPhone-sized viewports.
- Tap targets ≥44px on icon-only buttons.
- Fix any obvious overflow / clipped text spotted during the audit.

### 4. Enable Lovable Cloud (foundation only)
- Turn on Cloud so Phase 2 can migrate stores.
- No schema or data migration yet — purely provisioning + verifying the integration files land cleanly.

## Phase 2 — next turn (not this one)
Once you approve Phase 1's result, I'll:
- Add auth (email/password + Google), profiles table, RLS.
- Migrate `games-store`, `org-store`, `reviews`, joined-games from in-memory `Set`/arrays into Postgres tables with `createServerFn` + `requireSupabaseAuth`.
- Wire the protected `_authenticated` subtree for create/edit flows.
- Replace `sample-data.ts` reads with real queries (keep seed data as a one-time insert).

## Out of scope for this pass
Payments, notifications, email, analytics, real search, performance profiling, full a11y audit, security scan. Those come after the data layer is real — auditing them on in-memory mocks would be wasted work.

## Deliverable at end of Phase 1
- Hydration error gone.
- Every visible button/link/form on every route either works or has a clear "coming soon" state.
- Cloud enabled and reachable.
- A short checklist in chat: ✅ fixed / ⚠️ needs Phase 2 / ⛔ blocked, plus a Production Readiness Score for where we are after Phase 1.

Approve and I'll execute Phase 1.