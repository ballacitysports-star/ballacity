## Problem

When you refresh, you land on the marketing hero at `/`. That's because `src/routes/index.tsx` unconditionally renders the `Landing` component regardless of whether you're signed in — so any code path that ends up at `/` (a shared link, a link back to `/`, an OAuth redirect that drops `next`, or a bookmarked home) shows the marketing page instead of the in‑app surface (`/feed`).

The mobile/desktop AuthGate refresh fix from previous turns already keeps you on your current URL when it's a protected route — but it doesn't do anything when the URL genuinely is `/`.

## Fix

Make `/` session‑aware:

1. In `src/routes/index.tsx`, when a signed‑in session is detected, immediately `router.navigate({ to: "/feed", replace: true })`.
   - Read auth via the existing `useAuth()` hook (localStorage‑hydrated, mobile‑safe).
   - While `loading` is true, render nothing (or a tiny spinner) instead of the marketing hero to avoid the "flash of marketing" for signed‑in users.
   - When `loading` is false and there's no user, render the existing `Landing` unchanged.
2. Also short‑circuit on the very first client tick using `readStoredSupabaseSession()` (already used by `AuthGate`) so signed‑in refreshes on `/` never even paint the hero for a frame.
3. Keep the "Open app" and every other `<Link to="/">` in the app working — signed‑out visitors still see marketing.

No changes to `AuthGate`, `auth.tsx`, the OneSignal SW, or any other route — those are already correct.

## Verification

- Signed‑in refresh at `/` → replaced with `/feed` without flashing marketing.
- Signed‑out refresh at `/` → marketing hero renders as today.
- Signed‑in refresh at `/feed`, `/profile`, `/games/:id`, etc. → unchanged (still handled by `AuthGate`).
- Existing e2e specs (`desktop-refresh-protected.spec.ts`, `mobile-refresh-protected.spec.ts`) still pass.
- Add one new e2e case: signed‑in refresh at `/` ends up at `/feed`.

## Technical notes

- Use `useRouter().navigate({ to: "/feed", replace: true })` inside a `useEffect` gated on `!loading && user`.
- Pre‑paint gate: `const stored = typeof window !== "undefined" ? readStoredSupabaseSession() : null;` — if `stored` exists, return `null` on the first render so React never commits the marketing tree before the redirect fires.
- The route stays a public route in `PUBLIC_ROUTES`, so `AuthGate` doesn't interfere.
