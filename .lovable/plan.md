## Direction

Reskin the entire app to feel like the PlayStation mobile app: near-black layered surfaces, a single electric PS-blue accent, generous rounded corners, subtle inner highlights, and a bold icon-first tab bar. This is a **visual/token pass only** — no changes to routes, data, RLS, server functions, or business logic.

### Design tokens (locked)

Palette — **PS Blue on Ink**
- `--background` `#0a0e17` (ink)
- `--surface` `#141b29` (card)
- `--surface-2` `#1f2b44` (elevated / hover)
- `--primary` `#0070f3` (PS blue)
- `--primary-glow` `#4aa8ff`
- `--foreground` near-white, `--muted-foreground` cool gray
- `--border` low-contrast cool tint of surface-2

Typography — **Sora + Manrope**
- Display / headings: **Sora** (600–800), tight tracking on large sizes
- Body / UI: **Manrope** (400–600)
- Loaded via `<link>` in `src/routes/__root.tsx`, referenced in `@theme` — never `@import`ed from a URL

Shape, depth, motion
- Radii: `--radius: 20px` for cards, `28px` for hero tiles, `999px` for pills/tab bar
- Elevation: soft outer shadow + 1px inner top highlight (`inset 0 1px 0 rgba(255,255,255,0.06)`)
- Gradients: `linear-gradient(135deg, var(--primary), var(--primary-glow))` on primary CTAs and active tab indicator
- Motion: 180–220ms ease-out on hover/press; scale 0.98 on tap for cards and tab items

### Scope — what changes

Tokens & base
- Rewrite `src/styles.css` `:root` / `@theme inline` block with the palette above
- Register `--font-display: "Sora"` and `--font-sans: "Manrope"` in `@theme`, add Google Fonts `<link>`s in `__root.tsx`
- Default `body` to `--font-sans`, headings to `--font-display`

Global chrome
- `BottomNav`: floating pill/tab bar, dark surface, active item filled with PS-blue gradient + white icon, inactive icons muted; safe-area padding preserved
- Top page headers: display-weight title, condensed meta row, no drop shadow

Cards & lists (shared)
- `GameCard`, `PostCard`, `OrgCard`, `RosterPlayerRow`, `HostRequestRow`, `MessageAttachment`, `ReputationCard`: unified card shell (surface, radius 20, inner highlight, 16–20px padding), sport chip → small pill in PS blue, price/spots → right-aligned mono numerals

Primary surfaces
- Discover (`_tabs.discover`): PS-app "Explore" feel — hero rail on top (large tile with cover image + gradient scrim), horizontal category rails below (Basketball / Soccer / …), then a card grid
- Feed, Notifications, Players, Teams, Reels, Create tabs: same header + card language
- Profile (`_tabs.profile`): dark avatar block with subtle blue glow, stat pills, reputation card restyled
- Game detail (`games.$gameId.index`): cover image with gradient overlay → sticky glass header on scroll → sectioned dark cards for roster, pickup requests, host info, payment; sticky CTA becomes a full-width PS-blue gradient pill with white text
- Pay / payment-setup screens: same card shell, primary CTA gradient
- Auth, Settings, Account.*, Admin, Messages, Reviews, Plans, Shop, Available Players, Reset Password: reuse the shared shells so no page looks like the old theme

Components
- Buttons: default → PS-blue gradient pill; secondary → surface-2 pill with 1px cool border; ghost → transparent + hover surface-2
- Inputs, Selects, Textareas, Dialogs, Sheets, Tabs, Toasts (shadcn): retheme via CSS tokens only, no structural changes
- `SpotsPill`, `ReputationBadge`, `PrimaryCTA`, `SportChips`: adopt new pill/gradient styles

### Out of scope

- No route additions/removals, no schema or RLS changes, no server-function changes
- No copy changes beyond header/CTA labels where the new layout demands it
- No swap of icon library
- No changes to test files, migrations, or edge functions
- Light mode is not delivered in this pass (app becomes dark-only for now)

### Technical notes

- Tailwind v4: all tokens go in `src/styles.css` under `@theme` / `@theme inline`; no `tailwind.config.js`
- Colors defined as `oklch()` in `:root`, mapped through `@theme inline` so `bg-primary`, `text-foreground`, `border-border`, etc. keep working across every shadcn component
- Fonts: `<link rel="preconnect">` + Google Fonts `<link rel="stylesheet">` for Sora (400,600,700,800) and Manrope (400,500,600,700) added to `head()` in `src/routes/__root.tsx`
- Never hardcode hex/`text-white`/`bg-black` in components — every color reads from tokens so the whole app flips in one place
- shadcn components restyled via variants (`cva`) where a new look is needed (buttons, badges), not by editing component internals

### Verification

- `bun run build` succeeds
- Visual sweep via Playwright screenshots of: `/`, `/_tabs/discover`, `/_tabs/profile`, `/games/host-mrl2wvvn-313q`, `/auth`, `/settings`, `/messages` — confirm consistent tokens, tab bar, card shell, and CTA style
- Existing unit / e2e tests still pass (no logic touched)
