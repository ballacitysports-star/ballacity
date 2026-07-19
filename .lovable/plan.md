## Problem

The Trainers page crashes to the error boundary ("This page didn't load"). Console shows:

> Error: cannot add `postgres_changes` callbacks for realtime:trainer-requests-<uid> after `subscribe()`.
> at subscribeToMyTrainerRequests (src/lib/trainer-requests.ts:49)
> at TrainerActions.tsx:36

Root cause: `_tabs.trainers.tsx` renders one `<TrainerActions />` per trainer card. Each one calls `subscribeToMyTrainerRequests(user.id, …)`, which does `supabase.channel(\`trainer-requests-${userId}\`)`. Supabase-js reuses a channel with the same topic, so the second mount receives an already-subscribed channel; the follow-up `.on("postgres_changes", …)` throws, React unwinds, and the route boundary shows the error page.

## Fix

Share one realtime channel across all subscribers for the same user, in `src/lib/trainer-requests.ts`:

- Keep a module-level map keyed by `userId` holding `{ channel, listeners: Set<() => void>, refCount }`.
- On first subscribe for a user: create the channel, register both `.on("postgres_changes", …)` filters (from/to) that fan out to every listener, then `.subscribe()`.
- On subsequent subscribes: just add the callback to `listeners` and bump refCount — no new `.on()` or `.subscribe()` calls.
- Returned unsubscribe removes the listener and decrements refCount; when it hits 0, `supabase.removeChannel(channel)` and delete the map entry.

This preserves the current public API (`subscribeToMyTrainerRequests(userId, onChange) => () => void`), so `TrainerActions.tsx` and the trainer detail route need no changes.

## Verify

- Load `/trainers` — page renders the trainer list without hitting the error boundary.
- Console shows no "cannot add postgres_changes callbacks after subscribe()" errors.
- Navigating to `/trainers/$trainerId` and back still works (channel is torn down after the last unmount).