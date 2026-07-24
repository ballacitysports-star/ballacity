# Instagram-Style UI Redesign Plan

Scope: presentation layer only. No changes to server functions, Supabase schema, RLS, routing structure, auth, or business logic. All existing features stay reachable.

## 1. Design system refresh (`src/styles.css`)

- Repoint tokens to an Instagram-inspired palette:
  - Light default: near-white background (`oklch(0.99 0 0)`), ink text, `--border` at ~8% black, subtle surface `oklch(0.97 0 0)`.
  - Dark variant (`html.dark`): true black `#000` background, `#121212` surfaces, `#262626` borders — matches IG Direct.
  - Accent: keep current PS blue as brand accent, plus IG-style gradient (`#f09433 → #e6683c → #dc2743 → #cc2366 → #bc1888`) exposed as `--gradient-brand` for the Create tab, story rings, and active states only.
- Typography: swap display to **Inter** (or keep Sora) + tighter tracking; establish scale `text-[11px]` meta / `text-sm` body / `text-base` captions / `text-lg` names / `text-xl` headers.
- Radii: cards `rounded-2xl`, avatars circular, media edge-to-edge (`rounded-none` inside feed cards).
- Utility additions: `.ig-card`, `.ig-divider`, `.story-ring` (gradient border for unseen), `.tap-target` (min 44px).

## 2. Bottom navigation (`src/components/BottomNav.tsx`)

Reduce 6 tabs → 5 Instagram tabs while preserving reachability:

| IG tab | Route | Notes |
|---|---|---|
| Home | `/feed` | unchanged |
| Search | `/discover` | promote existing discover route; add search entry |
| Create | opens Create sheet → routes to `/create` | center tab, gradient icon |
| Notifications | `/notifications` | split back out of Inbox (heart icon) |
| Profile | `/profile` | avatar, ring when active |

Messages moves to a top-right paper-plane icon in the Home header (IG pattern). Teams / Players / Trainers move into Search tab as segmented filters (no route removal — links remain valid).

Visual: flat white/black bar, no pill background, thin top border, filled-vs-outline icon states, no labels (IG style) except on tablet/desktop.

## 3. Home feed (`src/routes/_tabs.feed.tsx`, `PostCard`, `GameCard`)

- Header: logo left, activity heart + paper-plane right.
- Optional Stories rail (reuse existing "From teams & clubs" data as circular avatars with gradient ring; tap → PostDetailsDialog). No new data source.
- Feed card layout (unify `PostCard`, `GameCard`, `RequestGameCard`):
  1. Header row: avatar (40px circle) · name/handle · timestamp · `⋯` menu
  2. Edge-to-edge media (square 1:1 default, respects existing images; fallback gradient with sport icon)
  3. Action row: like, comment, share, save (right-aligned)
  4. Like count · caption with `name` prefix · "View all N comments" · timestamp
  5. Event/RSVP CTA moves into caption footer for game posts (preserves all existing actions)
- Density toggle preserved; grid variant becomes IG-style 3-col tile grid.
- Infinite scroll + skeleton states already present — keep, restyle skeletons to IG shimmer.

## 4. Profile (`src/routes/_tabs.profile.tsx`, `players.$userId`, `teams.$teamId`, `trainers.$trainerId`)

Unified IG profile shell:
- Cover strip (optional, existing team covers) + circular avatar (88px) overlapping.
- Row: `posts | followers | following` counts (tap → existing FollowSheet).
- Name, bio, links, sport chips.
- Action buttons: `Edit profile` / `Share profile` (self) or `Follow` / `Message` (others) — all existing handlers.
- Tabs bar (icons only): Posts grid · Tagged · Saved (self only) · Hosted games · Reviews. Keeps every current section, just re-homed as tabs instead of stacked panels.
- Pending / Hosting / Pickup sections from recent redesign collapse into the "Hosted" tab with the same color-coded groupings.

## 5. Search / Explore (`src/routes/_tabs.discover.tsx`)

- Sticky search input at top → routes through existing FilterBar logic.
- Segmented control: `All · Players · Teams · Trainers · Games`.
- Masonry/mosaic grid of media (game covers, team covers, trainer venues) — reuses existing lists; no new endpoints.
- Trending / Suggested rails powered by existing "recent" queries.

## 6. Create (`src/routes/_tabs.create.tsx`)

Restructure current create form into an IG-style 3-step flow inside the existing route (no new server logic):
1. Media step (existing ImageUploader).
2. Caption + tag players/teams + sport + location (existing fields).
3. Review & publish (existing mutation).

"Host as" gate stays exactly as-is — surfaced in step 3.

## 7. Notifications (`src/routes/_tabs.notifications.tsx`)

- Chronological single list grouped by Today / This week / Earlier.
- Row: avatar · rich text (`X liked your post`, `Y requested to join`) · thumbnail · action button.
- All existing notification types render through one row component.

## 8. Messaging (`src/routes/messages.*`)

Keep existing functionality; restyle to IG Direct:
- Conversation list: avatar, name, snippet, timestamp, unread dot.
- Search bar on top.
- Thread view: bubbles with rounded-3xl, sender-right gradient, receiver-left neutral, media previews inline, existing reactions/quote reply/typing preserved.

## 9. Shared components

New/updated (presentational only):
- `src/components/ig/IGCard.tsx` — unified post card shell.
- `src/components/ig/IGHeader.tsx` — avatar + name + timestamp + menu.
- `src/components/ig/IGActionRow.tsx` — like/comment/share/save (wires to existing PostEngagement + share handlers).
- `src/components/ig/StoriesRail.tsx`.
- `src/components/ig/ProfileHeader.tsx`.
- `src/components/ig/SegmentedTabs.tsx`.
Existing components (`PostCard`, `GameCard`, `RequestGameCard`, `UserAvatar`, `BottomNav`, `FollowSheet`, `NotificationsPanel`, thread UI) are restyled in place — no deletions.

## 10. Performance & a11y

- Keep infinite scroll + skeletons; add `loading="lazy"` and `decoding="async"` to every `<img>` in feed/grid.
- Ensure 44×44 tap targets on nav + action row.
- Semantic tokens only — no hardcoded colors — so contrast holds in dark mode.
- Keyboard focus rings via `focus-visible:ring-2 ring-ring`.

## 11. Verification

- Typecheck (`tsgo`) + build must stay green.
- Existing e2e specs (filterbar-persistence, team-post-create, player-orgs-realtime, invite/pay flows) must still pass unchanged — they assert behavior, not markup.
- Manual pass on mobile viewport (402×725) for feed, profile, discover, create, notifications, DM thread.

## Out of scope (explicit)

- No changes to `src/lib/*.functions.ts`, `src/integrations/supabase/*`, migrations, RLS, storage buckets.
- No route additions or removals; only cosmetic re-homing of sections inside existing routes.
- No feature flags, no data reshaping, no auth changes.

## Rollout

Single branch, incremental commits per section (design tokens → nav → feed → profile → search → create → notifications → messages → polish) so each step is independently reviewable and revertible.
