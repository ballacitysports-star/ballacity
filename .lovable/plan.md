## Goal

Preserve the user's vertical scroll position on the feed (and similar list surfaces) across hard refresh, tab reopen, and in-app back/forward navigation. Today TanStack Router's `scrollRestoration: true` handles back/forward for already-rendered routes, but hard refresh loses the position and the feed's paginated list starts back at page 1.

## Fix

1. **New hook** `src/hooks/use-scroll-restore.ts`
   - `useScrollRestore(key: string, opts?: { pages?: number; onRestorePages?: (n: number) => void })`.
   - Storage: `sessionStorage` under `openrun:scroll:<key>`. Value: `{ y: number; pages?: number; ts: number }`. TTL ~30 min (older entries ignored so a cold-open next day starts at the top).
   - Save: throttled `scroll` listener (rAF-coalesced, max ~4/s) writes current `window.scrollY` and the caller-provided `pages`. Also flush on `pagehide` / `visibilitychange === "hidden"` so mobile refreshes and tab suspensions don't lose the last value.
   - Restore: on mount, read the entry, call `onRestorePages(entry.pages)` synchronously so infinite lists rehydrate their `visibleCount`, then run a rAF loop (bounded ~1.5s) that calls `window.scrollTo(0, entry.y)` once `document.documentElement.scrollHeight >= entry.y + window.innerHeight` — retries let images/skeletons hydrate before we settle. Aborts if the user scrolls in the meantime.
   - Skip restore when TanStack Router's own `history.scrollRestoration = "manual"` state signals a fresh in-app navigation with no saved offset (e.g., a Link click to `/feed`); use `performance.getEntriesByType("navigation")[0].type` — restore only on `reload` and `back_forward`, or when the entry's `ts` is fresh (last 5 s) to also cover Tab reopen.

2. **`src/routes/_tabs.feed.tsx`**
   - Call `useScrollRestore("feed", { pages: visibleCount, onRestorePages: (n) => setVisibleCount(Math.max(PAGE_SIZE, Math.min(n, filtered.length))) })` right after `visibleCount` is declared.
   - Guard: don't clobber `visibleCount` while `filtered.length === 0` (initial data still loading) — the hook retries on next paint via its rAF loop, so passing `filtered.length` in the dependency chain naturally recomputes once data arrives.
   - `runRefresh` (pull-to-refresh) already resets `visibleCount` to `PAGE_SIZE` — extend it to also `sessionStorage.removeItem(...)` for the feed key so an intentional refresh starts at the top.

3. **`src/router.tsx`**
   - Keep `scrollRestoration: true` (handles back/forward for cached matches). Also set `scrollRestorationBehavior: "instant"` so restored jumps don't animate on top of the rAF settle.

4. **Reusable for other lists (optional, same hook, no extra code here)**
   - Document the hook usage so `/players`, `/notifications`, `/messages` can adopt it with a one-liner. Not applied in this change to keep the diff scoped to the reported feed regression.

## Verification

- Scroll ~5 pages into `/feed`, hard-refresh → same cards visible, same scroll offset within a few px. Console shows no double-fetches.
- Scroll into feed, tap a game, then back → same offset (already works via router, still works).
- Scroll into feed, pull-to-refresh → jumps to top and stays there on next refresh.
- Signed-out `/` → unchanged (hook is scoped to feed).
- `bunx tsgo --noEmit` passes.

## Technical notes

- Files touched: new `src/hooks/use-scroll-restore.ts`; edits to `src/routes/_tabs.feed.tsx`, `src/router.tsx`.
- `sessionStorage` (not `localStorage`) — scroll intent is tab-scoped; sharing across tabs would jump users to a position from a different window.
- No schema, auth, or SSR changes. Hook is client-only, guarded with `typeof window` checks.
