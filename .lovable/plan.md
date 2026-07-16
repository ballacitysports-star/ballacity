## Goals

1. **Roster not updating after removal** — the game details page keeps showing "ghost" avatars for removed players because the roster falls back to placeholders derived from the static `game.joined` count whenever the live list is empty.
2. **AuthGate redirect `/feed → /auth`** — on a fresh visit or slow hydration, `AuthGate` runs its second-chance check once and redirects even when a stored Supabase session exists but hasn't parsed yet.
3. **Light cleanup** — drop dead imports/vars discovered in the files we touch (no broader refactor, no `any`/prettier sweeps).

## 1. Fix ghost roster placeholders

`src/routes/games.$gameId.index.tsx` around line 829:

```ts
const usePlaceholderRoster = liveRoster.length === 0 && (game.joined ?? 0) > 0;
```

This is true even after `useLiveParticipants` has hydrated with 0 rows (which is exactly the state right after the last participant is removed). It then renders `game.joined` fake avatars from a hard-coded initials list.

**Fix:** only render placeholders while the roster hasn't hydrated yet. Use the already-available live count as the authoritative signal:

```ts
const rosterHydrated = liveParticipantCount !== undefined;
const usePlaceholderRoster =
  !rosterHydrated && liveRoster.length === 0 && (game.joined ?? 0) > 0;
const placeholderCount = rosterHydrated
  ? 0
  : Math.max(0, (liveParticipantCount ?? game.joined ?? 0) - liveRoster.length);
```

Cap `placeholderOthers` at `placeholderCount` so the visible roster size can never exceed the authoritative live count.

Also verify the two other roster surfaces (positions list ~line 1390 / 1530 / 1576 and the "approved+live" merge at 1841) already read from `liveRoster`; no change needed there.

## 2. Harden AuthGate late-hydration redirect

`src/routes/__root.tsx` `AuthGate` (lines 242–350) currently:
- waits for `useAuth` `loading=false`,
- calls `supabase.auth.getSession()` once, and
- if that returns no session, navigates to `/auth`.

On mobile Safari the persisted session can parse a tick after the first `getSession()` resolves. Add a bounded retry that only kicks in when there is a stored session in `localStorage` (we already compute this in `authgate-log.ts`).

Changes:
- Extract `readStoredSupabaseSession()` (or reuse the logic from `envSnapshot`) into `src/lib/authgate-log.ts` and export it.
- In the verify effect, if `getSession()` returns `null` **and** `readStoredSupabaseSession()` is truthy and not expired, wait ~250ms and re-check `getSession()` once more before redirecting. Log a new `verify-hydrated-retry` decision for observability.
- If still empty (or no stored session), redirect as today.

Result: signed-out visitors still redirect immediately; signed-in visitors whose session hasn't parsed avoid the false redirect.

## 3. Light cleanup (unused imports/vars only)

Only in files above:
- `src/components/RequestGameCard.tsx` — drop unused `User` icon import.
- `src/routes/games.$gameId.index.tsx` — remove any imports that become unused after the roster change (verify with `bunx tsgo --noEmit` scoped to the file).

No `any→unknown` conversions, no prettier reformats, no larger refactors.

## Verification

- `bunx tsgo --noEmit` — no new errors (preexisting `available-players.tsx` TS2322s stay).
- Manual: host removes the last participant → placeholder avatars disappear immediately.
- Manual: hard-refresh `/feed` while signed in on mobile viewport → no `[AuthGate] redirect` warning; hard-refresh while signed out → still redirects.

## Out of scope

- Fixing every `no-explicit-any` / prettier lint warning.
- Reworking RLS or the Realtime subscription filters.
- The Vite HMR websocket warning (preview-only).
