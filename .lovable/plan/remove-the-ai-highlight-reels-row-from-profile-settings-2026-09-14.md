# Remove the "AI Highlight Reels" row from profile settings

The "AI Highlight Reels — 3 free, then $15/mo unlimited" row on the profile settings page goes away.

## What changes

- That row and its heading are deleted from the profile settings page.
- The reels feature itself is untouched: the reels page still works and stays reachable from wherever else it is linked.
- Rows above and below (payments, plans and subscriptions) stay exactly as they are.

## Technical notes

- Delete the `<Section title="AI Highlight Reels">` block in `src/routes/profile.edit.tsx`.
- Drop the now-unused `Video` icon import from that file's lucide-react import list.
- No other files, routes, data or config change.
