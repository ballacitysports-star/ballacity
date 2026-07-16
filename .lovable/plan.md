Goal: Make the pending/approved/declined request section on the profile feel polished while loading and when empty.

Current state:
- The section starts empty and silently appears only after `listMyJoinRequests()` resolves.
- There is no loading indicator, so the page layout can shift abruptly when requests load.
- When the user has no requests, the section is hidden entirely, leaving no contextual feedback.

Changes:

1. Track request loading state
   - Add `requestsLoading` boolean to `src/routes/_tabs.profile.tsx`.
   - Set it true before `listMyJoinRequests()` and false after success/error.

2. Create a matching skeleton for request cards
   - Add `src/components/RequestGameCardSkeleton.tsx` that mirrors the layout of `RequestGameCard` (image placeholder, title, sport chip, date/location lines, host line, progress bar, and status footer placeholder).
   - Use the project's shimmer/skeleton tokens (`bg-muted`, `animate-pulse`, rounded shapes) to keep it consistent with the existing dark theme.

3. Add an empty state for the request section
   - Create a small empty-state block with an icon (`Inbox` or `ClipboardX`), a short headline like "No requests yet", and a subline like "Requests to join games will appear here.".
   - Keep it inside the same section card styling so the area doesn't disappear.

4. Wire states into the profile section
   - While `requestsLoading` is true, show the section heading and 2 skeleton cards.
   - When not loading and `myRequests.length === 0`, show the empty state.
   - When not loading and requests exist, render the existing pending + recently reviewed cards as before.
   - Keep the section visible during loading so the page doesn't jump.

5. Handle the missing-game edge case
   - If requests exist but none have matching game data in the lookup, show the empty state instead of a blank section heading.

Outcome: The request section on the profile has a smooth loading skeleton, a clear empty state, and no longer pops in or disappears unexpectedly.