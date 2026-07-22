## Problem

Comments exist in the database (4 rows) but don't render in the UI. Root cause: `listComments` in `src/lib/post-engagement.functions.ts` uses a PostgREST embed:

```
.select("*, profiles:author_id(display_name, avatar_url, avatar_initials)")
```

This embed requires a foreign key from `post_comments.author_id` to `public.profiles.id`. The actual FK points to `auth.users(id)`, so PostgREST returns an error and the query throws — the component then renders "Be the first to comment."

## Fix

Edit `src/lib/post-engagement.functions.ts` → `listComments` handler only:

1. Select plain columns from `post_comments` (no embed).
2. Collect the unique `author_id` set.
3. Second query: `profiles.select('id, display_name, avatar_url, avatar_initials').in('id', ids)` using the same publishable client.
4. Build a `Map<authorId, profile>` and merge into the returned `CommentRow[]` (same shape as today, so `PostEngagement.tsx` needs no change).

No migration, no schema change, no other files touched.

## Verify

- Reload a team post modal / game details page and confirm existing comments appear with author name + avatar.
- Post a new comment and confirm it shows up live via the existing realtime subscription.