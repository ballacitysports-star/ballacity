## UX Audit — top problems

**1. Bottom nav is overloaded (6 tabs).**
Pickup / Players / Teams / Host / Map / Profile. "Host" (a primary action) sits between browse and destination tabs. Players + Teams overlap. Map (`/discover`) duplicates Feed (`/feed`). Six equal-weight icons at 402px wide crowd labels and hurt thumb reach.

**2. Discover / Feed / Map — three surfaces for "find a game".**
`/feed` = list + filters. `/discover` = map. `/pickup` also exists. New users can't tell them apart; internal state (filters, sport chip) doesn't survive switching.

**3. Game detail file is 2,799 lines.**
One route holds view, edit, roster, waitlist, payment settings, host approvals, join, share, delete. CTA hierarchy is diluted; the primary "Join / Pay" action competes with 6+ secondary controls.

**4. Host form asks too much upfront.**
Sport, title, when, location, skill, size, price, indoor/private toggles, description, approval toggle, cover image, per-position needs — all required on one screen before publishing. Most fields have obvious defaults.

**5. Settings / Profile / Account sprawl.**
`/settings`, `/account/notifications`, `/account/security`, `/profile/edit`, `/reset-password`, `/plans`, `/admin`, `/payments` — all reachable from different entry points, inconsistent headers, "My card" links back into a tab.

**6. Onboarding is thin.**
`/auth` → straight to `/profile`. No sport preference, no location prompt, no first-game nudge. Empty states in Feed just show "no games" without a next step.

**7. Design system inconsistency.**
Some pages use `PrimaryCTA`, others hand-roll buttons; card radii, header patterns, and back-arrow placement vary route-to-route.

---

## Structural changes to implement (prioritized)

### P0 — Navigation reshape
- Collapse bottom nav from **6 → 5 tabs**: `Play` (merged Feed+Map with a list/map toggle) · `Players` · **Host (center FAB, elevated)** · `Messages` · `Profile`.
- Fold `Teams` under `Players` as a top segmented control (People / Teams).
- Delete `/pickup` as a nav entry (keep route as redirect → `/play`).
- Center Host FAB uses primary gradient so the main create action is unmistakable.

### P0 — Merge Discover + Feed → `/play`
- Single route with a sticky **List ⇄ Map** toggle at the top.
- Shared filter/sport state persists across the toggle.
- Redirect `/feed` and `/discover` → `/play`.
- Preserve all filter, search, and realtime roster behavior.

### P1 — Game detail slimdown
- Extract host-only panels (edit meta, payment settings, approvals, delete) into `/games/$gameId/manage` route.
- Player view keeps: hero, when/where, roster + SpotsPill, description, single sticky primary CTA (Join / Pay / Full / Requested).
- Move Share/Bookmark into an overflow menu; keep only CTA + back in the sticky bar.

### P1 — Host form: progressive disclosure
- Step 1 (required): Sport, When, Where. Publish enabled after these three.
- Step 2 (optional, collapsed "More options"): title (auto-generated default: "{Sport} at {Neighborhood}"), size (default 10), price (default Free), skill (default All Levels), indoor, private, approval, cover, positions.
- Smart defaults: location prefilled from GPS/profile; when defaults to next Saturday 10am.

### P1 — Settings hub consolidation
- `/settings` becomes the single account root. Move `/profile/edit`, `/account/notifications`, `/account/security`, `/plans`, `/payments` under it with a consistent header component.
- Remove "My card" link (redundant with Profile tab).
- Add a `SettingsHeader` component used by every sub-page (back arrow, title, optional action).

### P2 — Onboarding polish
- Post-signup: 2-step sheet — pick sports (chips), confirm city (autocomplete + "Use current location"). Skippable.
- Feed empty state: illustration + "Host the first game" primary + "Widen your search" secondary.
- First-time Play visit: brief coach-mark on the List/Map toggle.

### P2 — Design system pass
- Replace ad-hoc buttons on join/pay/host/settings pages with `PrimaryCTA`.
- Extract `PageHeader` (sticky, back arrow, title, optional trailing action) and adopt on all sub-pages.
- Standardize card: `rounded-2xl border bg-card` — audit and normalize.
- Mobile-first: verify all tap targets ≥44px, safe-area padding on all sticky bars.

---

## Technical notes

- New routes: `src/routes/_tabs.play.tsx` (merged), `src/routes/games.$gameId.manage.tsx` (host tools).
- New components: `src/components/PageHeader.tsx`, `src/components/BottomNav.tsx` refactor for center FAB, `src/components/HostFormMore.tsx` (collapsible advanced section), `src/components/OnboardingSheet.tsx`.
- Redirects: `/feed`, `/discover`, `/pickup` → `/play` via `beforeLoad: () => redirect(...)`.
- `BottomNav` `PUBLIC_PATHS` unchanged; add safe-area on the new FAB.
- No DB/RLS changes. No changes to realtime, payments, invite, or messaging logic — presentation only, except route splits which move JSX between files.
- Preserve all e2e selectors: keep button labels ("Join", "Pay", "Request to join", "Cancel request", "Leave") verbatim. Run the invite/pay/join e2e suite after each P0/P1 chunk.

---

## Execution order

1. Bottom nav + `/play` merge + redirects (single PR-sized chunk).
2. Host form progressive disclosure.
3. Game detail → extract `/manage`.
4. Settings hub consolidation + `PageHeader`.
5. Onboarding sheet + empty-state polish.
6. Design system sweep (`PrimaryCTA` adoption, card normalization).

Each chunk ships independently; e2e runs between chunks.
