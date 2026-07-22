## Change

Switch the Feed's "From teams & clubs" section from a horizontal snap-scroll row to a vertical stacked list, keeping the same "Load more" pagination.

## Scope

`src/routes/_tabs.feed.tsx`, "From teams & clubs" section only.

- Replace the horizontal container (`flex gap-3 overflow-x-auto scrollbar-hide -mx-4 px-4 pb-1 snap-x`) with a vertical stack (`flex flex-col gap-3`).
- Remove per-card width/snap classes (`w-[85%] max-w-sm shrink-0 snap-start`) so each `PostCard` spans the section's full width.
- Keep the team chip header above each `PostCard` unchanged.
- Change the "Load more" button wrapper from a fixed-width horizontal slot to a centered block below the list; button styling stays the same.
- No changes to the server function, query, pagination size (10), or filter behavior.

## Out of scope

- Team profile post feed and other sections of the feed.
- Pagination size, ordering, or filtering logic.
