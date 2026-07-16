## Goal
Rework the public player profile follow surface to match Instagram's pattern: inline count row, prominent Follow/Message action row, and a tabbed Followers/Following sheet with search and per-row follow-back.

## UI changes — `src/routes/players.$userId.tsx`

1. **Remove the 4-tile stats grid** (Games, Reliable, Followers, Following).
2. **Add an inline count row** under the name/handle block:
   `Games · Followers · Following` rendered as three tappable inline stats (bold number over lowercase label, IG-style). Followers and Following open the sheet on the matching tab; Games is a static number.
3. **Replace the stacked buttons** next to the avatar with an IG-style **action row below the bio**:
   - Row 1 (full width, 2 buttons side-by-side): `Follow` / `Following` (primary lime, flips to outline when following) + `Message`.
   - When following, tapping the button opens a small confirm popover: "Unfollow @name?" → Unfollow / Cancel. Prevents accidental unfollows (IG behavior).
4. **Move the small "Verified" chip** to sit beside the display name (unchanged), but drop the age " · N" text into the handle line to reduce header noise.

## New component — `src/components/FollowSheet.tsx`
Replaces `FollowListDialog`.

- Radix Dialog with mobile-first sheet look (rounded top, full-height on mobile, max-w-md on desktop).
- Header: sticky title with close button; below it a **Tabs** row (Followers | Following) using the existing shadcn `Tabs`.
- **Search input** (sticky under the tabs) filters the current tab's list by `display_name` / `username` client-side across already-loaded pages; still fetches next pages via infinite scroll so search widens as more loads.
- Each row (`FollowRow`):
  - Avatar + display name (bold) + `@username` (muted) — the whole row links to `/players/$userId` and closes the sheet.
  - Right-aligned small button:
    - If the row user is the viewer → hidden.
    - If viewer already follows them → `Following` (outline).
    - Else → `Follow` (lime).
    - Tapping toggles follow for that row without closing the sheet, using the same `useFollow`-style mutation but per-row.
- Reuses existing keyset infinite scroll from `follows.ts` (30/page). Adds a small "No matches" empty state when search returns nothing.

## Data layer — `src/lib/follows.ts`
- `listFollows` already returns `{ users, nextCursor }` — keep.
- **Extend** `FollowUser` to include the viewer's follow state for that row: after loading a page, do one extra query
  `select follower_id from follows where follower_id = <viewer> and followee_id in (<page ids>)`
  and mark each user `viewerFollows: boolean` (skip when signed out). Merge into the returned page so the per-row Follow buttons render correct state without N queries.
- New `followUserById(id)` / `unfollowUserById(id)` (thin wrappers; the existing `followUser`/`unfollowUser` already take an id, so reuse those).
- Update the `useFollow` invalidation to also invalidate `["follow-list", *, userId]` so counts and row buttons stay in sync when the header button toggles.

## Notification
No change — the DB trigger already writes an in-app notification on insert; it fires for row-level follows too.

## Out of scope
- Follow requests / private profiles.
- Followed-by-mutuals hint ("Followed by X, Y +3").
- Real-time follower stream updates.
- Suggestions section inside the sheet.
- Any change to routing structure (still a modal, not a dedicated `/players/$userId/followers` route).

## Verification
- `bunx tsgo --noEmit` clean.
- Manual: signed-in viewer opens someone's profile → sees inline `Games · Followers · Following`, Follow + Message row. Tap Followers → sheet opens on Followers tab, can switch to Following, can search, can Follow/Unfollow rows inline, can scroll to load more. Header button and row buttons for the same user stay in sync. Confirm popover appears on Unfollow.
