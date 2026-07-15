## Goal
Prevent spam/accidental rapid resubmits of join requests after a host rejection, and notify the host when a player resubmits.

## Rules
- **Cooldown**: 15 minutes after the most recent rejection on a given `(player_id, game_id)`.
- **Attempt cap**: max 3 total submissions per `(player_id, game_id)` (initial + up to 2 resubmits).
- **Host notification**: on a successful resubmit, notify the host with a minimal "player resubmitted, pending review" message.

## Database (migration)
Add to `join_requests`:
- `attempt_count INT NOT NULL DEFAULT 1` — total submissions for this player+game.
- `last_rejected_at TIMESTAMPTZ` — set by trigger whenever a row transitions to `status = 'rejected'`.

Trigger: `BEFORE UPDATE` on `join_requests` — when `OLD.status <> 'rejected' AND NEW.status = 'rejected'`, set `NEW.last_rejected_at = now()`.

RLS: keep existing DELETE policy (`pending`/`rejected` by owner). No new policies needed — attempt cap & cooldown are enforced server-side via a validation trigger to prevent client bypass.

Trigger: `BEFORE INSERT` on `join_requests` — when a prior row exists for the same `(player_id, game_id)` that will be superseded:
- If prior `attempt_count >= 3` → `RAISE EXCEPTION 'Maximum resubmission attempts reached for this game.'`.
- If prior `status = 'rejected'` AND `last_rejected_at > now() - interval '15 minutes'` → `RAISE EXCEPTION 'Please wait before resubmitting.' USING ERRCODE = 'P0001'` and include remaining seconds in the message.
- Set `NEW.attempt_count = prior.attempt_count + 1`.

## Client (`src/lib/payments.ts`)
Update `createJoinRequest` resubmit path:
1. Before deleting the prior rejected row, check `last_rejected_at` and `attempt_count`; if cooldown active or cap hit, return a typed result `{ blocked: true, reason: 'cooldown' | 'cap', retryAfterSeconds?: number }` instead of retrying.
2. On successful resubmit insert, call a new server function `notifyHostOfResubmit({ gameId, hostId, playerId })` that inserts a notification for the host via `createNotification` with body `"A player resubmitted a join request — pending your review."` and a link back to the game.

## UI (`src/routes/games.$gameId.index.tsx`)
- Declined banner: show remaining cooldown ("You can resubmit in Xm Ys") and disable the resubmit CTA until it elapses; when `attempt_count >= 3`, replace CTA with "You've reached the resubmit limit for this game — message the host."
- Toast on cooldown/cap errors returned from `createJoinRequest`.

## Test updates
- `src/lib/game-realtime.test.tsx` unaffected.
- Update existing join-request tests / add unit tests for `createJoinRequest` covering: cooldown block, cap block, successful resubmit increments attempt count, host notification fires on resubmit.

## Notes
The backend has no standard rate-limiting primitive, so this is an ad-hoc limit enforced by DB triggers + client checks (per your confirmation). No new tables needed.
