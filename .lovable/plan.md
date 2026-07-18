## Goal

After sign-in, remember the last in-app page the user was on (path + query + hash) so that any signed-in visit to `/` — refresh, bookmark, OAuth return, deep link that dropped its path — lands back on that page instead of the marketing hero or a hardcoded `/feed`.

Protected routes already preserve their own URL on refresh via `AuthGate`. This change only affects what happens when the resolved URL is `/`.

## Fix

1. **Track last visited path** (new file `src/lib/last-visited.ts`)
   - `LAST_VISITED_KEY = "openrun:last-visited"`.
   - `rememberLastVisited(href)`: store `pathname + search + hash` in `localStorage`. Skip if the path is not a real in-app surface: `/`, `/auth`, `/reset-password`, anything starting with `/api/`, `/.well-known/`, `/.mcp/`, `/.lovable`.
   - `readLastVisited(): string | null`: read + sanitize with the existing `sanitizeNextPath` (same allowlist AuthGate already uses) so a tampered value can't redirect off-site.
   - `clearLastVisited()`.

2. **Record on every navigation** (`src/routes/__root.tsx`, inside `RootComponent`)
   - Subscribe to `router.subscribe("onResolved", ...)` (or a `useEffect` on `router.state.location.href`) and call `rememberLastVisited(location.href)` whenever the resolved pathname passes the allowlist above.
   - Also clear on `SIGNED_OUT` in the existing `onAuthStateChange` listener so the next user doesn't inherit the previous session's history.

3. **Restore on signed-in `/`** (`src/routes/index.tsx`)
   - Re-introduce a minimal, session-aware gate — *only* for the `/` route, not a global redirect:
     - Read `useAuth()`.
     - While `loading` and a stored Supabase session exists (`readStoredSupabaseSession()`), render `null` to avoid a marketing flash.
     - Once `user` is present, `router.navigate({ to: readLastVisited() ?? "/feed", replace: true })` in a `useEffect`. Use `href`-style navigation via `router.navigate({ href: dest, replace: true })` so path + search + hash all restore in one call.
     - Signed-out users still see the existing `Landing` marketing page, unchanged.

4. **Post-auth fallback** (`src/routes/auth.tsx`, `goPostAuth`)
   - Preference order becomes: `next` search param → `readLastVisited()` → same-origin `document.referrer` → `/feed`. Everything else about `goPostAuth` stays the same (still `window.location.replace`).

## Verification

- Sign in, navigate to `/profile?tab=hosting`, hard-refresh → stays on `/profile?tab=hosting` (existing AuthGate behavior, unchanged).
- Sign in, navigate to `/games/:id`, then open `/` (or a bookmark to `/`, or OAuth returns to `/`) → redirected to `/games/:id`.
- Fresh sign-in from `/auth` with no `next` and no prior history → lands on `/feed` (existing default).
- Sign out, then visit `/` → marketing landing renders; no stale redirect from the previous user's last-visited entry.
- `readLastVisited()` returning `/auth`, `//evil.com`, or `/api/...` is rejected by `sanitizeNextPath` and falls back to `/feed`.
- Existing `e2e/desktop-refresh-protected.spec.ts` and `e2e/mobile-refresh-protected.spec.ts` still pass.

## Technical notes

- Storage: `localStorage` (same store AuthGate already relies on for session hydration; survives refresh and app reopen). No cookies, no schema changes.
- Files touched: new `src/lib/last-visited.ts`; edits to `src/routes/__root.tsx`, `src/routes/index.tsx`, `src/routes/auth.tsx`.
- No changes to `AuthGate`'s hydration wait, the OneSignal SW, or protected-route redirect logic.
- `sanitizeNextPath` (already exported from `src/routes/__root.tsx`) is reused for both write and read to keep the allowlist in one place.
