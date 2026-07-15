## Problem

Realtime subscriptions for `join_requests`, `game_payment_settings`, and `payment_submissions` are wired on the game details page, tables are in the `supabase_realtime` publication, and RLS allows the viewer to read their own rows — yet status still only updates on refresh. This is the same class of flakiness the pay page already handles with a belt-and-suspenders fallback (see `e2e/pay-approval-polling-fallback.spec.ts`). We need the same safety net on the game details page so approval, roster, and payment status always update live.

## Fix (all in `src/routes/games.$gameId.index.tsx`)

1. **Log + surface subscription status** on the three viewer-scoped channels (`join_requests:me:*`, `game_payment_settings:*`, `payment_submissions:me:*`) so we can see `CHANNEL_ERROR` / `TIMED_OUT` in the console instead of silent failure.

2. **Re-auth realtime on session changes.** After `supabase.auth.getSession()` / `onAuthStateChange`, call `supabase.realtime.setAuth(access_token)` once at mount so the WebSocket carries the user JWT. Without it, RLS-scoped subscriptions can be rejected silently right after sign-in.

3. **Add a fallback refresh loop** (mirrors the pay page):
   - `setInterval(refreshStatus, 15000)` while the tab is visible.
   - `window.addEventListener('focus', refreshStatus)`.
   - `document.addEventListener('visibilitychange', ...)` → `refreshStatus()` when the tab becomes visible.
   - Same fallback triggers `refreshHostRequests()` when the viewer is the host.

4. **Also refresh roster on tab focus.** The live roster hook (`useLiveParticipants`) already subscribes, but if its socket dropped the count/list can stall. Add a focus/visibility re-hydrate by bumping a local `rosterNonce` state that the hook keys on (or call a small `refetch` we expose). Minimal change: force `useLiveParticipants` to re-run by keying it on `${game.id}:${rosterNonce}` and incrementing `rosterNonce` on focus.

5. **Keep existing realtime channels** — the fallback is additive, not a replacement.

## Non-goals

- No schema changes (publication + RLS already correct).
- No changes to the pay page (already has this fallback).
- No changes to shared stores beyond what's needed to expose a refetch.

## Verification

- Manual: sign in as player on tab A, host on tab B. Host approves join request → tab A flips to "Pay" state within 15s even if the socket is down; within ~1s when realtime works.
- Console: subscribe status logs show `SUBSCRIBED` on the three channels.
- Existing e2e (`pay-approval-realtime-only.spec.ts`, `pay-approval-polling-fallback.spec.ts`) still pass.
