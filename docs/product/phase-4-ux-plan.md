# Phase 4: UX polish

Source: a read-only audit of the core flows at iPhone size (390 px) against the sandbox on 2026-11-19. It produced 15 findings.
Each finding was then checked against the code by an independent verifier whose default was to refute it. All 15 were confirmed,
with corrections; this plan uses the corrected versions.

## Owner decisions (2026-11-19)

| Topic                        | Decision                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "LEGAL REVIEW REQUIRED" tags | Keep them visible until counsel signs off; then flip the flags in `src/lib/legal-review.ts`. No copy changes to the drafts.                                                                                                                                |
| Landing page                 | Basketball-first, availability-first pickup ("post when you're free, get invited"). Keep other sports. Tryouts, trainers and facilities go in one compact section lower down. Also update the SEO title, description, share image and the `/auth` tagline. |
| Joining a free game          | Merge "Join this run?" and the separate "Before you join" risk acknowledgment into one dialog. Keep the same unchecked checkbox, wording, legal tag and per-version recording.                                                                             |
| Create form                  | A venue is required to publish (no "TBD"). The host-responsibility acknowledgment stays mandatory but moves to the Publish step. "Require my approval" stays on by default.                                                                                |
| Terminology                  | Default, unless the owner says otherwise: "game" everywhere in the app; "run" only as basketball flavour in marketing and SEO copy.                                                                                                                        |

## Work packages

### WP 4.0: errors and internal strings (launch blocker)

- **Shared mapper.** Add `userErrorMessage(err, fallback)`, built on one catalog of the database's `CODE: …` errors (`GAME_FULL`,
  `INVITE_NOT_AVAILABLE`, `GROUP_LIMIT`, `LOCATION_IN_PUBLIC_TEXT`, …) and the PostgREST/network shapes. It never returns raw
  text.
  - Today a plain PostgREST error object, which is not an `Error`, falls back to a vague "Couldn't …".
  - Bare `toast.error(e.message)` sites leak codes, e.g. `_tabs.players.tsx:1600` and the host's approve/decline in
    `HostRequestRows.tsx`.
- **Existing mappers.** `gameInviteErrorMessage` and `joinGateErrorMessage` word the same code differently. Fold them, and the
  other per-feature mappers, into the catalog.
- **Lint guard.** A lint rule bans `toast.error(<x>.message)`.
- **Alerts tab (`NotificationsPanel.tsx`).**
  - Members see a "Turn on push" prompt instead of the "Push delivery issue" operations diagnostics.
  - "Mark all read" uses the server's unread count instead of the 100 loaded rows.
- **Invisible profiles.** For a profile the viewer may not see, show "This profile is private or unavailable" instead of
  "may have been removed" (`players.$userId.tsx`, `player-card.$userId.tsx`).
- The legal tags stay, per the owner's decision.

### WP 4.1: availability-first entry

- **"I'm available" on Home.** It opens the quick-post sheet. When the posting check fails, it explains in a dialog instead of
  silently moving the member to Discover › Mine (`AvailabilityHome.tsx:106-109`, and "Add a time" at `:193`). "Complete my
  profile" returns to posting afterwards: `returnTo` on `/profile/edit`.
- **Home layout.** A skeleton of the card's height while the feature switch loads, so Home doesn't jump
  (`AvailabilityHome.tsx:65`).
- **One screen for availability.** A single "My availability & invitations" screen, linked from Home and from Me.
- **Find Players.** The view toggles move into the filter sheet so results start above the fold; Basketball and the member's own
  sports come first in the sport chips.
- **Landing and `/auth`.** Repositioned per the owner's decision.

### WP 4.2: shorter host and join flows

- **Create form.**
  - A quick form (sport, when, where, spots, repeat) plus "More options".
  - Inline validation instead of browser bubbles and one-at-a-time toasts.
  - A required venue, and the acknowledgment at the Publish step.
  - Fix the football hint shown under Basketball, and the fee hint that points at a hidden field.
- **Joining.** The merged join dialog. Reminder copy reads "1 day before", not "All day before", in `GameReminderSettings.tsx`.
- **Host rating.** Use the live rating, or hide it when there are no reviews, instead of the stale snapshot
  (`GameHostSection.tsx`).

### WP 4.3: consistency and touch polish

- **Terminology sweep.** "game"; one request verb; "spot" in payment messages; the "1 games" plural.
- **Tap targets of 44 px or more.**
  - My availability actions.
  - Sheet and dialog close buttons, switches.
  - Game tabs, "Add to calendar", "See all".
  - A confirmation before "Delete group".
- **Help button.** Keep the floating Help button clear of form labels and sticky bars.
- **Contrast.**
  - The Delete game button (4.44:1).
  - Disabled distance-slider labels (2.5:1).
- **Small bugs.**
  - Home's "Needs you now" times use the game's time zone (`needs-action.ts`).
  - "Remove" in My availability uses an in-app confirm with error handling.
  - The Payments tab's realtime re-subscribe error (`GamePaymentsPanel.tsx`).

## Order

1. WP 4.0, first, since it is a launch blocker.
2. Then 4.2 and 4.1. 4.1 includes the landing page.
3. Then 4.3.

Each package ships as its own PR through the usual gates. Packages that touch the database get a migration, SQL tests and a
rehearsed rollback.
