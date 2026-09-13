# ballaCity UX consistency pass

Presentation-only refinement. No changes to data, rules, permissions, age/consent gates, payments, or what any button does — only how pages are framed, labelled, and navigated.

The app has ~85 pages, so the work is staged. Each stage ends with the full test suite and build passing.

## Stage 1 — Shared building blocks (nothing user-visible removed)

- Add three small shared pieces that already exist informally in the app so every page can look the same:
  - **EmptyState**: one icon + what's empty + why + one action button.
  - **ErrorState**: plain-language message + "Try again" / "Go back" — never raw error text on screen.
  - **LoadingState / list skeletons**: reuse the existing game-card skeleton style for players, teams, trainers, messages, notifications instead of bare spinners.
- Extend the existing page header so every page shows: back control (when it's not a tab), title, one short line of context, optional single action. No new header systems.
- Keep `PrimaryCTA` as the only prominent button per screen; downgrade competing buttons on the same screen to outline/text styling.

## Stage 2 — Onboarding as one continuous flow

Pages: welcome, account type, who it's for, age, child setup, player setup.

- One shared shell: same title placement, same spacing, same bottom button, same validation and loading behaviour.
- "Step X of Y" only where the number of steps is actually known; otherwise no counter.
- Back always steps to the previous step of the flow, never out to the marketing page or a stale tab.
- Each required question gets a one-line reason ("We need your birthday to apply the right safety rules").
- Whatever destination the user arrived for is preserved and returned to after the gate, exactly as today.

## Stage 3 — Core journeys

- **Discover → game → join**: reorder the game page so the answer to "can I play?" is at the top (sport, date/time, place, distance, spots, cost, approval needed, age requirement). Blocked reasons state what happened, whether it's temporary, and the one useful next step. No eligibility, approval, payment, or waitlist rule changes.
- **Create a game**: group fields into What / When / Where / Who / Cost, required before optional, and end on a clear confirmation with a link to the new game. All existing fields stay.
- **Messages**: consistent empty, pending, and blocked states that explain the situation in plain words; back returns to where the conversation was opened from.
- **Notifications**: every tap lands on the right object; a deleted object shows a graceful "this is no longer available" state instead of a blank page.

## Stage 4 — App-wide consistency

- Page widths normalised onto the existing tiers (app shell / standard / narrow form / map-media). One-off widths removed.
- Bottom bar: consistent icon size and tap targets, safe-area padding, and every page reserving space so no button hides behind it.
- Active profile shown clearly wherever it changes what an action does; the existing switcher is reused, its logic untouched.
- Forms: same label, required marker, error position, and save/cancel placement everywhere.
- Dialogs vs sheets: focused decisions in dialogs, contextual actions in sheets, always closable, keyboard and screen-reader labelled, focus returned on close.
- Wording unified where the underlying state is the same (Game, Host, Player, Team, Request to join, Message, Follow). Different states keep different words.
- Checked at 320 / 375 / 390 / 414 / 768 / desktop, with dynamic viewport heights so nothing gets trapped on mobile Safari.

## Stage 5 — Verification

Existing Playwright suite, typecheck, and build; plus a manual walk of new user, returning user, host, messaging, family/consent, profile edit, and notification journeys at mobile width.

## Technical notes

- New files: `src/components/ui/empty-state.tsx`, `error-state.tsx`, `loading-state.tsx`; small additions to `src/components/layout/PageHeader.tsx` and `BackHeader.tsx`.
- Width work uses the existing `page-shell*` utilities in `src/styles.css` and `src/lib/page-shell.ts` — no new geometry.
- No migrations, no policy or grant changes, no server-function signature changes, no route deletions. Route additions only if a flow currently dead-ends.
- Anything that would need a product decision (e.g. collapsing onboarding steps that map to real requirements) is flagged in the final report rather than changed.
