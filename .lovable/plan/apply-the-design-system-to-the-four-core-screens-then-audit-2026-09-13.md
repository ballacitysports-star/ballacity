# Apply the design system to the four core screens, then audit the rest

Presentation only. No changes to data, rules, permissions, payments, routes, or what any button does. Nothing is removed — controls keep their place, only their framing, spacing, wording and grouping change.

## Stage A — Feed

- One compact top area: brand, location, notifications, messages, avatar. Same icon size and tap target for every action, so no single control shouts louder than the rest.
- Sport chips: consistent height, spacing and active state, comfortable to tap, smooth horizontal scroll with no clipped edge.
- Search, filters, sort and distance sit in one row that reads as a single control group. When filters are on, a clear count is shown with a way to clear.
- Upcoming / Archive and the list / grid / map switches use one shared segmented-control look with an unmistakable selected state.
- Cards, posts and section blocks share one gap, one page padding and one card frame, so the feed reads as one surface. Posts stay visually distinct from games.
- Skeletons match the real card size so nothing jumps while loading; empty states say what is missing, why, and the one existing action to take.

## Stage B — Game cards

- One structure used by both grid and list: sport/status row, title, key details (when, where, distance, skill, spots), host, then the existing action or status area.
- Long titles, long venue names, long host names and unusual price or status labels all wrap or truncate instead of stretching the card. No fixed heights where content varies.
- In grid mode cards align to a consistent height without clipping; list rows keep the same visual language, tuned for scanning.
- Every existing state — available, full, joined, hosted, free, paid, urgent, in progress, finished, restricted — keeps its exact meaning and gets one consistent pill treatment.

## Stage C — Player profiles

- Header hierarchy: photo, name, handle, verification/status, sport line, then actions. Existing actions all stay, arranged as one primary plus quieter secondary ones.
- Profile details grouped into a few labelled sections with subtle dividers instead of many look-alike cards.
- Sports and skill levels shown as one scannable block; stats shown as they exist, none invented.
- Highlights, reels and images use one aspect ratio and gap. Video behaviour untouched.
- Active profile context stays visible without dominating; the switcher behaves exactly as today.
- Narrow-screen check: long names, action buttons, media grid, section spacing.

## Stage D — Messaging

- Conversation list: avatar, name, last message, time, unread — one row rhythm, less decoration.
- Conversation header: who you are talking to, back control, existing actions, nothing new.
- Message bubbles: one padding, radius, type size, timestamp and attachment treatment; sent vs received clearly different by shape and tone, not colour alone.
- Composer: consistent field and send button, clear sending and disabled states, sits above the keyboard and the home bar on iOS and Android, and scrolls to the newest message.
- Restricted conversations read as an intentional explanation with a way back, never as an error screen. The permission check itself is untouched.
- Consistent states for no conversations, loading, sending, failed send, unavailable and restricted, using the shared loading/empty/error pieces.

## Stage E — Shared pieces, then a whole-app audit

Fix repeats at the shared level, not page by page: buttons, cards, inputs, badges, avatars, icon sizing, spacing scale, page widths, header behaviour and bottom-bar clearance. Then walk the remaining routes for leftover one-off widths, heading sizes, duplicate button/card styles, mismatched loading and empty states, and horizontal overflow.

## Stage F — Verification

- Checks at 320 / 375 / 390 / 414 / 430 / 768 / 1024 / 1280+, with dynamic viewport heights and safe-area padding, including Safari behaviour and the on-screen keyboard.
- Accessibility: tap-target sizes, visible focus, screen-reader labels, headings, contrast, states not signalled by colour alone, reduced motion.
- Full existing test suite, type check and build; then a manual walk of feed, game open/join, profile view/edit/follow/message, and messaging including a restricted conversation.

## Technical notes

- Shared components touched: `GameCard`, `GameListRow`, `GameCardSkeleton`, `PostCard`, `SportChips`, `FilterBar`/`FilterSheet`, `PageHeader`/`BackHeader`, `BottomNav`, `MessageAttachment`, `PrimaryCTA`, avatar/badge/input/button primitives, `empty-state` / `error-state` / `loading-state`.
- Routes touched for layout only: `_tabs.feed`, `_tabs.players`, `players.$userId`, `_tabs.profile`, `messages.index`, `messages.$conversationId`, game detail.
- Widths use the existing `page-shell*` tiers in `src/styles.css` / `src/lib/page-shell.ts`; type uses the existing `page-title` / `section-title` / metadata steps. No new geometry or new token systems.
- No migrations, no policy/grant changes, no server-function signature changes, no route additions or deletions.
- Anything needing a product decision (for example which single action should be primary on a profile) is flagged in the final report rather than decided here.

## Final report

Core UI changes, shared components updated, inconsistencies found, global fixes, responsive/Safari fixes, accessibility, performance, functional verification, remaining issues.
