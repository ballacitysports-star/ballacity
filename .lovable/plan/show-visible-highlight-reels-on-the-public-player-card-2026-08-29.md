# Show visible highlight reels on the public player card

## Goal
When someone views a player's public profile card (`/players/:userId`), their non-hidden highlight reels should be visible — the same way they already appear on your own `/profile` page.

## Current state (verified)
- The profile page (`_tabs.profile.tsx`) fetches the viewer's **own** reels through an authenticated server function, so it only works for the owner.
- The public player card (`src/routes/players.$userId.tsx`) has no reel section at all.
- Database access rules for `highlight_reels` only allow a user to read their **own** reels (plus admins). Other users — signed in or anonymous — currently cannot read anyone's reels.

## Changes

### 1. Database access (migration)
- Add a read rule on `highlight_reels` allowing anyone (including anonymous visitors) to read reels where:
  - `hidden_at IS NULL` (not hidden by the owner), and
  - `status = 'completed'` (only finished reels).
- Owners keep full control of their own reels (existing rule unchanged); hidden and in-progress/failed reels stay private.

### 2. Fetch helper (`src/lib/reels.functions.ts`)
- Add `listPublicReels(userId)` — a public server function (no sign-in required) that returns the visible, completed reels for the given user with safe columns only (RECAP_COLUMNS: title, thumbnail, video path, sport, game info, AI caption/hashtags, created date).

### 3. Public player card UI (`src/routes/players.$userId.tsx`)
- Add a **Highlight reels** section (below the About section) that loads via `useQuery` + `listPublicReels(userId)`.
- Render each reel as a read-only card: thumbnail, title, sport chip, caption/hashtags, and inline playback using the existing `InlineVideoPlayer`.
- No manage controls (no hide/delete/attach) — those stay owner-only on `/profile`.
- If the player has no visible reels, the section is hidden entirely (no empty state clutter).

## Verification
- Confirm the migration applies cleanly and the typecheck/build pass.
- Verify an anonymous/another user's view of `/players/:userId` shows visible reels and respects hidden/deleted ones.
