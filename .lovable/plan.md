## Bug

On a hard refresh of a protected page (e.g. `/feed`, `/games/:id`), `AuthGate` sometimes redirects to `/auth` (the sign-in landing) before the persisted Supabase session finishes parsing. The 250ms retry we added helps most cases but still loses the race on slow mobile webviews and cold TanStack SSR shells, so the user sees the landing/sign-in page instead of the page they refreshed.

## Fix — never redirect while a stored session exists

Change the AuthGate policy in `src/routes/__root.tsx`:

1. On mount / verify, first call `readStoredSupabaseSession()` (already exported from `src/lib/authgate-log.ts`).
2. If a **non-expired** stored session exists, do **not** redirect — keep rendering the `AuthLoadingFallback` and wait. The root's `onAuthStateChange` listener (already present) will fire `INITIAL_SESSION` / `SIGNED_IN` and `useAuth` will flip `user` to non-null; `AuthGate` re-renders and shows the page.
3. Add a soft safety net: if `user` hasn't hydrated after ~4s despite a stored session, call `supabase.auth.getSession()` one more time. Only redirect if that final check returns no session AND the stored token is gone/expired.
4. If there is no stored session from the start, redirect to `/auth?next=…` immediately (today's behavior — keeps signed-out visits fast).

Also log a new `verify-waiting-hydration` decision so we can see the "waiting for stored session" branch in existing logs.

## Files

- `src/routes/__root.tsx` — rewrite the verify effect in `AuthGate` (lines ~258–327) per the policy above. Keep `sanitizeNextPath` and the existing redirect payload; only the decision logic changes.
- `src/lib/authgate-log.ts` — add `"verify-waiting-hydration"` to `AuthGateDecision`.

No changes to `/auth`, `useAuth`, or any route.

## Verification

- Hard-refresh `/feed` and `/games/:id` while signed in → stays on the page, no `[AuthGate] redirect` warning; brief loader is acceptable.
- Hard-refresh `/feed` while signed out (localStorage empty) → still redirects to `/auth?next=/feed` immediately.
- `bunx tsgo --noEmit` — no new errors.

## Out of scope

- Restructuring routes as public/`_authenticated`.
- Changes to `auth.tsx` post-sign-in navigation.
