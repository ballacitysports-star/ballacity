## Fix roster not updating + add host "Remove player" action

### Problem 1 — roster shows removed players
The host roster on the game details page is composed from two sources:
- `approvedReqs` = `join_requests` rows with `status='approved'` (rendered via `RosterPlayerRow`)
- `liveRoster` = live `game_participants` rows (rendered as plain `Link` rows), minus overlap

Today, when a player is removed from `game_participants` (host action, admin cleanup, or a partial self-leave) the corresponding `join_requests` row can be left behind with `status='approved'`. That row is not cleaned up by any realtime handler, so `approvedReqs` keeps rendering the player forever even though `liveRoster` no longer contains them.

There is also no "remove" affordance for the host — RLS already permits `DELETE` on `game_participants` for hosts, but the UI never exposes it.

### Problem 2 — no host "remove player" UI
Add a small "Remove" control on each roster row visible only to the host, with a confirmation dialog. Removing a player must clear both `game_participants` AND any leftover `join_requests` row for that player+game so the roster updates immediately across all viewers.

### Changes

1. `src/lib/payments.ts`
   - Add `hostRemoveParticipant({ gameId, playerId })`:
     - `DELETE FROM game_participants WHERE game_id=? AND user_id=?`
     - `DELETE FROM join_requests WHERE game_id=? AND player_id=?` (all statuses — cleans the "ghost approved" row that causes the stale render). RLS already permits both for the host.
     - Best-effort: delete pending `payment_submissions` for that player+game so payment chips don't linger.

2. `src/routes/games.$gameId.index.tsx` — host roster section (lines ~1792-1875)
   - Filter `approvedReqs` so it only renders rows whose `player_id` is present in `liveRoster` once `liveRoster` has hydrated. This is the actual fix for the stale-display bug — any join_request whose participant row is gone is dropped from the UI immediately, without waiting on any cleanup.
   - When `isHost`, render a small trash/"Remove" icon-button on both branches (`RosterPlayerRow` and the live-roster `Link` rows). Clicking opens an `AlertDialog`:
     - Confirm copy: "Remove {name} from this game? They'll be notified and their spot will open up."
     - On confirm: optimistically call `removeRosterLocal(playerId)` + drop from `hostRequests`, then `await hostRemoveParticipant(...)`, then `void refetchRoster()` + refresh host requests. Rollback on error.
     - Fire `createNotification({ user_id: playerId, type: 'participant_removed', title: 'Removed from {game.title}', body: 'The host removed you from the roster.', link: '/games/{id}' })`.
   - The live-roster row is currently a whole-row `<Link>`; wrap children so the remove button uses `e.preventDefault(); e.stopPropagation()` to avoid navigating to the player profile when clicking Remove.

3. Realtime: no schema changes needed. `useLiveParticipants` already handles DELETE + resubscribe reload, so both the host's device and every other viewer will see the row disappear. The join_requests deletion is picked up by the existing `join_requests:host:<gameId>` channel which triggers `loadHostRequests()`.

### Out of scope
- No database migration; existing RLS policies already allow the host to delete from both tables.
- No changes to the self-leave flow.

### Technical notes
- `hostRemoveParticipant` runs client-side (RLS-scoped) — matches the pattern used by `withdrawMyApprovedJoinRequest`.
- Notification best-effort with `.catch(() => {})` so a notify failure doesn't roll back the remove.
