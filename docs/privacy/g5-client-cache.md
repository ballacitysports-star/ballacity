# G5: client cache privacy

## Problem

Browser storage is not access controlled: it outlives a sign-out, is readable by the next person on a shared device, and is not covered by the database rules that protect the same information. The earlier work (PRIV-2C) fixed the hosted-games and avatar caches, but the reset list was hand-maintained (seven keys), the original-photo IndexedDB database was never cleared, session storage was ignored, and nothing forced a future store to be reviewed.

## What changed

- `src/lib/client-storage-manifest.ts` is the single list of every key the app writes, with a class: `device` (harmless UI state), `per-user` (purged on sign-out and identity change), `own-draft` (what the person is typing, keyed by user), `legacy` (deleted on update), `retained-record` (deliberately left alone, with the reason). Sensitive stores (game ids, hosted games, avatar/name cache, the person's own position) are marked.
- **Logout, profile switching (guardian ⇄ managed child):** `resetPerUserClientState` now purges every `per-user` and `legacy` key in local **and** session storage, deletes the original-photo database (`ballacity-originals`) and forgets the in-memory handle, then does the existing in-memory resets (exact youth locations, signed media URLs).
- **Application update:** `CLIENT_CACHE_EPOCH` (stored on the device) is compared at startup; when it differs, legacy keys, the sensitive per-user stores and the original-photo database are purged once. Bump the epoch whenever a build stops using a sensitive store. Non-sensitive stores and drafts survive an update.
- **Future stores:** a test scans the source for every `openrun…`/`ballacity…` storage key literal and fails if it is not in the manifest; another fails if any file other than the original-photo cache opens IndexedDB; another fails if a game-location or identity store is classified as a device preference. A new store cannot ship unclassified.
- `forgetOriginalImageCache()` resets the shared handle after the database is deleted.

## Compatibility

No server or schema change. The first load of this build runs the epoch purge once: users lose the legacy caches (which only ever mirrored server data), the avatar/name cache, game-id cache and their last cached position; those are re-fetched. Drafts, profile overrides, theme and view preferences are untouched. Staged rollout: client-only; safe before or after any database step. An older build keeps writing its old keys until the device loads this one.

## Recovery

If a purge removes something it should not have, the fix is to reclassify the key in the manifest (device or own-draft) in a new build; nothing is restored automatically. The manifest never causes a store to write anything.

## Limits (stated plainly)

- **Historical backups** (database backups, point-in-time recovery) are outside the browser: see the retention table in `docs/release/privacy-gap-register.md`.
- **Offline devices** keep their old caches until they next load a build with this change; the first load clears them. A device that never opens the app again keeps them. Browser history, push notifications already delivered, screenshots and downloaded files cannot be recalled.
- The static scan only sees string literals matching `openrun…`/`ballacity…`. A store whose key is built elsewhere or uses another prefix would be missed; review any new use of `localStorage`, `sessionStorage` or `indexedDB` in code review.
- Supabase's own auth session storage (`sb-…`) is managed by the SDK and is cleared by sign-out.

## Tests

`src/lib/client-storage-manifest.test.ts` (7): the source scan, the IndexedDB check, class sanity, identity-change purge (per-user and legacy removed; device prefs, drafts and the retained record kept; session storage too), epoch purge (sensitive only), once-per-epoch, and deletion of the original-photo database on both paths. Existing hosted-games, avatar, original-photo and per-user tests still pass (36).
There is no SQL in this change, so no SQL authorization tests apply.
