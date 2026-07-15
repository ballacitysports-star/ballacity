## Goal

Add automated tests proving that the three realtime channels in the game details view are torn down and recreated with the right `gameId`/`userId` whenever the viewer switches games or accounts.

## Approach

The realtime `useEffect`s currently live inline in `src/routes/games.$gameId.index.tsx`, which is too heavy to mount in a unit test. Extract them into a small custom hook, then unit-test the hook with a stubbed Supabase client that records every channel operation.

### 1. Extract `useGameRealtimeChannels` hook

New file: `src/lib/game-realtime.ts` (browser-safe, mirrors `game-roster.ts`).

```ts
export function useGameRealtimeChannels(params: {
  gameId: string | undefined;
  userId: string | undefined;
  hostsThisGame: boolean;
  onHostJoinRequestChange: () => void;
  onMyJoinRequestChange: () => void;
  onSettingsChange: () => void;
  onMyPaymentChange: () => void;
}): void
```

Move the four `supabase.channel(...).subscribe()` effects (host join_requests, my join_requests, game_payment_settings, my payment_submissions) verbatim into this hook, keyed on the same deps. Route file replaces the four inline effects with one hook call — behavior unchanged.

### 2. Test file: `src/lib/game-realtime.test.tsx`

Uses vitest + `@testing-library/react` (add as devDep — `renderHook` is not exposed elsewhere in the project). Mock `@/integrations/supabase/client` with `vi.mock` so `supabase.channel(name)` returns a chainable stub that records:

- `channel(name)` → pushes name onto `subscribed`
- `.on(...)` → returns self
- `.subscribe(cb)` → returns self, records status callback
- `removeChannel(ch)` → pushes ch's name onto `removed`

Tests (each renders the hook with initial props, then reruns with new props):

- **Initial mount as host** subscribes to all four expected channel names:
  `join_requests:host:g1:u1`, `join_requests:me:g1:u1`, `game_payment_settings:g1`, `payment_submissions:me:g1:u1`.
- **Initial mount as non-host** subscribes to three (skips host channel).
- **Switch gameId `g1` → `g2`** removes all four `:g1` channels and subscribes the four `:g2` equivalents.
- **Switch userId `u1` → `u2`** removes the three user-scoped channels and re-subscribes with `:u2`; the settings channel (game-only key) is NOT torn down.
- **hostsThisGame flips false → true** subscribes the host channel without touching the other three.
- **Unmount** removes every currently-subscribed channel.
- **No leaks**: `subscribed.length - removed.length` equals the count of currently-active channels after each transition.

Each test asserts channel names via exact string equality so a regression in the naming scheme (missing `userId`, wrong prefix) fails loudly.

### 3. Wiring change in the route

- Replace the four inline `useEffect` blocks in `src/routes/games.$gameId.index.tsx` (host join_requests, my join_requests, game_payment_settings, my payment_submissions) with a single `useGameRealtimeChannels({...})` call.
- Callbacks passed in remain `refreshHostRequests`, `() => { refreshStatus(); void refetchRoster(); }`, `() => { refreshStatus(); if (hostsThisGame) refreshHostRequests(); }`, `() => { refreshStatus(); void refetchRoster(); }` — identical to today.

## Files

- New: `src/lib/game-realtime.ts` (hook), `src/lib/game-realtime.test.tsx` (tests)
- Edit: `src/routes/games.$gameId.index.tsx` (swap 4 effects for 1 hook call)
- `package.json`: add `@testing-library/react` devDep (needed for `renderHook`)

## Non-goals

- No changes to the payload-guard logic inside handlers (already covered by prior turn).
- No Playwright e2e — this is faster and more precise than a browser-driven test for subscription lifecycle.
- No changes to `useLiveParticipants` (its own channel is orthogonal and already tested in production by roster e2e).

## Verification

`bunx vitest run src/lib/game-realtime.test.tsx` passes; full suite unchanged.
