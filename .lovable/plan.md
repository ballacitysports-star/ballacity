# Comments & Reactions on Posts and Games

Add lightweight discussion (threaded-flat comments) and emoji reactions to every user-facing post surface: team/club posts (via `PostDetailsDialog`) and hosted games (game details page).

## Data model (one migration)

Polymorphic target via `(subject_type, subject_id text)` so we cover `team_post` (uuid as text) and `game` (text id from `hosted_games`) without two parallel schemas.

**`public.post_comments`**
- `id uuid pk`, `subject_type text check in ('team_post','game')`, `subject_id text not null`
- `author_id uuid not null references auth.users`
- `body text not null check (length(body) between 1 and 1000)`
- `created_at`, `updated_at`, `deleted_at timestamptz`
- Index `(subject_type, subject_id, created_at desc)`

**`public.post_reactions`**
- `id uuid pk`, `subject_type`, `subject_id`, `user_id`, `emoji text check in ('👍','❤️','🔥','😂','🎉','👏')`
- Unique `(subject_type, subject_id, user_id, emoji)`

GRANTs: `authenticated` full CRUD, `anon` SELECT (comments/reactions are public reads on public posts), `service_role` ALL. RLS:
- SELECT: anyone (matches current public read of team_posts / hosted_games).
- INSERT: `auth.uid() = author_id / user_id`.
- UPDATE/DELETE comment: author only (soft delete via `deleted_at`).
- DELETE reaction: owner only.
- Realtime: `ALTER PUBLICATION supabase_realtime ADD TABLE post_comments, post_reactions`.

## Server functions (`src/lib/post-engagement.functions.ts`)

Public reads via publishable server client; writes via `requireSupabaseAuth`.
- `listComments({ subjectType, subjectId })` — joins `profiles` for display_name/avatar.
- `createComment({ subjectType, subjectId, body })`
- `deleteComment({ id })` (soft delete → shows "deleted")
- `listReactions({ subjectType, subjectId })` → returns `{ emoji, count, mine: boolean }[]`.
- `toggleReaction({ subjectType, subjectId, emoji })` — insert or delete row.

## UI component (`src/components/PostEngagement.tsx`)

Single shared block, props `{ subjectType, subjectId }`:
- **Reactions row**: 6 emoji pills with counts; tapping toggles; picker "+" to add new emoji from the fixed set. Unauthed → toast "Sign in to react".
- **Comments list**: avatar + name + relative time + body, own comment gets delete. Empty state "Be the first to comment."
- **Composer**: textarea (1000 char), Post button, disabled when signed out (shows "Sign in to comment" CTA linking to `/auth`).
- Data via TanStack Query keys `["comments", subjectType, subjectId]` and `["reactions", ...]`; mutations invalidate both.
- Realtime: subscribe to `post_comments` + `post_reactions` filtered by `subject_id=eq.<id>`, invalidate on change (teardown on unmount per realtime rules).

## Integration points

1. **`src/components/PostDetailsDialog.tsx`** — mount `<PostEngagement subjectType="team_post" subjectId={post.id} />` below the action row. Used by Feed and team profile.
2. **`src/routes/games.$gameId.index.tsx`** — add a "Discussion" section (near existing reviews/roster area) with `<PostEngagement subjectType="game" subjectId={gameId} />`. Reachable from every `GameCard` since cards already link to game details.

No changes to card previews themselves; engagement lives inside the details surfaces.

## Verification

- Typecheck.
- Manual: create comment + toggle reaction on a team post and a game while signed in; second browser sees updates via realtime.
- RLS: unauthed user can read but insert fails.

## Out of scope

Threaded replies, @mentions, notifications on new comment (can follow if requested), moderation beyond author soft-delete.
