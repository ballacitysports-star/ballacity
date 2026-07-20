# Streamline OpenRun — Ideas

Goal: reduce cognitive load, cut taps, and unify patterns across the app while keeping every existing feature reachable.

## 1. Consolidate the tab bar (7 → 5)
Current tabs: Feed, Discover, Create, Notifications, Profile, Teams, Trainers, Reels, Players.
- Merge into: **Play** (Feed+Discover+Map toggle), **Community** (Teams+Trainers+Players via segmented control), **Create** (center FAB), **Inbox** (Messages+Notifications, already unified), **Profile**.
- Reels moves into Play as a top pill filter.
- Benefit: one-thumb reach on mobile, less tab-switching.

## 2. Universal Create FAB
Replace the Create tab with a floating "+" that opens a bottom sheet with contextual actions based on current route (Game / Team / Trainer / Post / Reel). Uses the existing wizards; only the entry point changes.

## 3. Unified filter bar
Feed, Teams, Players, Trainers each have their own filter UI today. Introduce a shared `<FilterBar>` component:
- Sport chips + search + sort + density toggle in one sticky row.
- Persists to URL (already implemented) and localStorage.
- Removes duplicate code across four routes.

## 4. Game detail: collapse the pay flow
Today: Game → Pay → Payment-setup → Return. Combine into a single sheet with steps (approve → pay → confirm) so users never leave the game context. Deep-links still work.

## 5. Profile section polish
- Replace the color-coded Pending / Hosting / Pickup blocks with a single segmented control + one list. Same data, half the vertical space.
- Move "My Teams / Gyms / Trainer profiles" under a collapsible "Organizations" accordion.

## 6. Inbox refinements
- Single list with type icons (message, follow, join request, payment) instead of tab-switching.
- Swipe-to-archive; long-press for actions.
- Notification prefs moves into Settings (one less top-level surface).

## 7. Onboarding shortcut
First-run: 3-question setup (sport, home area, skill) → drops user straight into a pre-filtered Play feed. Skippable.

## 8. Trainer / Team / Org unification
Trainer profile, Team profile, Org profile are 90% the same layout. Extract one `<OrgProfileView>` with role-based sections. Reduces bug surface (edit flow, avatar, cover, posts, members).

## 9. Empty & loading states
Standardize skeletons (already have `GameCardSkeleton`, `RequestGameCardSkeleton`) into a shared `<ListSkeleton kind="game|player|team|trainer" />`. One import everywhere.

## 10. Command palette (desktop) / quick actions (mobile)
`⌘K` on desktop, long-press logo on mobile → jump to any game, team, trainer, or action. Power-user shortcut, zero UI cost.

## 11. Design token cleanup
Audit remaining hardcoded colors (`text-white`, `bg-black` occurrences) and route them through semantic tokens so dark/light + future themes stay consistent.

## 12. Micro-optimizations
- Sticky "Join" CTA on game cards when scrolled past the hero.
- Optimistic UI on follow, join, RSVP (mutation + rollback on error).
- Reduce datetime inputs to a single native picker with quick chips (Tonight, Tomorrow, This weekend).

---

## Suggested rollout order
1. Tab consolidation + universal Create FAB (biggest perceived simplification)
2. Unified FilterBar + shared skeletons (code-debt win)
3. Profile segmented control + Inbox merge polish
4. Org/Team/Trainer view unification (refactor)
5. Pay flow collapse + optimistic mutations
6. Onboarding + command palette (delighters)

Tell me which items to build (or reorder) and I'll produce an implementation plan for that slice.