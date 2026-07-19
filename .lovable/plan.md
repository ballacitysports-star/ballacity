# Fix: Edit button on trainer profile leads to a blank page

## Root cause

The Edit button goes through `/trainers/$trainerId/edit`, which redirects to
`/teams/$teamId/edit`. Both routes SSR by default, but the ownership check
(`isMyOrg`) relies on `supabase.auth.getUser()`, which returns no session
during server rendering.

Result on server render:
- `refreshCurrentUser()` sets `currentUserId = null`
- `myOrgIds` stays empty
- The trainer edit loader throws `ForbiddenError`, or the teams edit
  component renders the "not allowed" screen

The client then hydrates with a real session, tries to reconcile with the
server HTML, hits a hydration mismatch, and the page ends up blank/stuck on
a spinner — exactly what you're seeing.

## Fix

Make the editor client-only and remove the unnecessary redirect hop.

1. `src/routes/teams.$teamId.edit.tsx`
   - Add `ssr: false` to the route so the loader and component only run in
     the browser, where the Supabase session is available.
   - Keep the async loader that awaits `ensureOrgById` (already hydrates the
     org store before render).
   - Add a small `pendingComponent` (spinner) so the transition isn't blank
     while hydration finishes.
   - Keep the improved "Editing not allowed" block with the trainer-aware
     back link.

2. `src/routes/trainers.$trainerId.edit.tsx`
   - Delete this file. It only added a redirect hop that also SSR-fails.

3. `src/routes/trainers.$trainerId.tsx`
   - Point the Edit `<Link>` directly at `/teams/$teamId/edit` with
     `params={{ teamId: org.id }}`. Ownership is still enforced inside that
     route.

## Why this works

- With `ssr: false`, the editor only mounts after the client has a live
  Supabase session, so `isMyOrg` returns `true` for your own trainer profile
  and the editor renders normally.
- Removing the intermediate redirect route eliminates the second SSR pass
  that was producing the blank screen.
- Server-side RLS on the teams table remains the authoritative permission
  check for the actual save.

## Verification

- Click Edit on your own trainer profile → editor loads (brief spinner ok).
- Open `/teams/<someone-else-id>/edit` while signed in as a different user →
  "Editing not allowed" screen with a Back to profile link.
- Hard-refresh `/teams/<your-id>/edit` → editor still loads after auth
  hydration.
