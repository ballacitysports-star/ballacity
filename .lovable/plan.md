## Goal
Add Follow / Unfollow to the public player profile (`/players/$userId`), including follower/following counts and a notification to the followed user.

## Database
New migration:

- `public.follows` table
  - `follower_id uuid` → `auth.users.id`
  - `followee_id uuid` → `auth.users.id`
  - `created_at timestamptz default now()`
  - PK `(follower_id, followee_id)`, `CHECK (follower_id <> followee_id)`
  - Indexes on `follower_id` and `followee_id`
- GRANTs: `SELECT` to `anon` + `authenticated` (public counts); `INSERT, DELETE` to `authenticated`.
- RLS:
  - SELECT: `true` (counts and follow-lists are public).
  - INSERT: `auth.uid() = follower_id`.
  - DELETE: `auth.uid() = follower_id`.
- Trigger `after_insert_follow` → inserts a row in `public.notifications` for the followee (`type = 'follow'`, actor = follower, payload with follower id/name). Uses `SECURITY DEFINER` and respects `notification_preferences` if the existing pattern does (will mirror what other notification triggers do — read first before writing).

## Frontend

### `src/lib/follows.ts` (new)
Helpers:
- `getFollowState(followeeId)` → `{ isFollowing, followers, following }` via 3 parallel `supabase` reads (`select count`).
- `followUser(followeeId)` / `unfollowUser(followeeId)`.
- `useFollow(followeeId)` React hook using TanStack Query: `queryKey: ["follow", followeeId, viewerId]`, exposes counts + `toggle()` with optimistic update + `invalidateQueries`.

### `src/routes/players.$userId.tsx`
- Import `useFollow`.
- In the header actions row (next to Message), render a new `Follow` / `Following` button:
  - Signed-out: button prompts `toast.error("Sign in to follow")`.
  - Own profile: hidden (already redirected).
  - Uses lime-gradient when not following, outline/secondary when following; hover on following swaps to "Unfollow".
- Add two new small stat pills under the name row (or extend the existing 4-stat grid): show `followers` and `following` counts. Chosen approach: **replace the "Crew" tile with "Followers" and add "Following" next to it, keeping the 4-tile grid** (Games, Reliable, Followers, Following). Tiles are tappable → future list; for now no-op.

### Notification rendering
- `src/lib/notifications.ts` (and any notification list UI): add handling for `type === 'follow'` → "X started following you" linking to `/players/{followerId}`. Only touch presentation strings; no schema changes beyond the new type value.

## Out of scope
- Followers/Following list pages.
- Mutual-follow / friend semantics.
- Push notification wording changes beyond adding the new type.
- Any change to Message flow, roster, or auth.

## Verification
- `bunx tsgo --noEmit` clean.
- Manual: sign in as user A, visit user B's profile → tap Follow → count increments, button flips to "Following", user B sees a new in-app notification. Tap again → unfollow, count decrements. Refresh persists state. Signed-out tap shows toast.
