## Problem

The previous turn added an auto-redirect in `src/routes/index.tsx`: any signed-in visit to `/` is replaced with `/feed`. That means if a refresh ever resolves to `/` — a bookmarked home, an OAuth return, a mobile webview that drops the path, or any link back to `/` — the user is thrown onto `/feed` and loses whatever page + query params they were on.

The user wants the opposite: refresh should keep them exactly where they were, query string intact, and never force-navigate to `/feed`.

## Fix

1. **Remove the `/` → `/feed` auto-redirect** in `src/routes/index.tsx`.
   - Delete the `useEffect` that calls `router.navigate({ to: "/feed", replace: true })`.
   - Delete the pre-paint gate that returns `null` when a stored session exists.
   - Drop the now-unused imports (`useEffect`, `useRouter`, `useAuth`, `readStoredSupabaseSession`).
   - `/` always renders the marketing `Landing` — for everyone, signed-in or not. The header already has an "Open app" link for signed-in users to jump into `/feed` on their own.

2. **Leave `AuthGate` alone.** It already preserves the current URL + query on refresh for protected routes (the 4s hydration wait + `sanitizeNextPath(router.state.location.href)` behavior shipped earlier). No changes there.

3. **Leave `src/routes/auth.tsx` alone.** `goPostAuth` still falls back to `/feed` only when there is no `next` and no same-origin referrer — that only runs after an explicit sign-in, not on refresh, so it doesn't affect this bug.

## Verification

- Signed-in refresh at `/profile?tab=hosting` → stays on `/profile?tab=hosting`.
- Signed-in refresh at `/games/:id?foo=bar` → stays there.
- Signed-in refresh at `/` → renders marketing landing (no forced jump to `/feed`).
- Signed-out refresh at `/` → renders marketing landing (unchanged).
- Existing `e2e/desktop-refresh-protected.spec.ts` and `e2e/mobile-refresh-protected.spec.ts` still pass.

## Technical notes

- Only `src/routes/index.tsx` changes. Route stays public in `PUBLIC_ROUTES`, so `AuthGate` doesn't touch it.
- No new dependencies, no schema changes, no test rewrites.
