## Goal

Never flash the marketing landing to a signed-in user while `/` is redirecting them to their last-visited page. Replace the current `return null` gate in `src/routes/index.tsx` with a lightweight full-screen skeleton that matches the app chrome.

## Fix

1. **New component** `src/components/AuthRedirectSkeleton.tsx`
   - Full-height (`min-h-dvh`) `bg-background` screen.
   - Top-bar skeleton: logo bar + right-side pill (matches BottomNav-less shell used during redirect).
   - Centered content: 3 stacked `Skeleton` bars (title, subtitle, action pill) inside a max-w container, plus a subtle spinner beneath.
   - Uses existing `@/components/ui/skeleton` and `Logo` — no new deps, no color hardcoding.
   - Accepts an optional `label` prop (default `"Taking you back to where you were…"`) rendered as `sr-only` + a muted caption for reassurance.

2. **`src/routes/index.tsx`**
   - Replace `if (user || (loading && hasStoredSession)) return null;` with `return <AuthRedirectSkeleton />;` for the same condition.
   - Keep the existing `useEffect` redirect logic unchanged.

3. **`src/routes/__root.tsx` — AuthGate parity (optional, only if needed for consistency)**
   - `AuthLoadingFallback` already handles the protected-route wait. No changes required there; the new skeleton is scoped to the `/` redirect case only so we don't disturb the retry/reload affordances the auth loader shows after 6s.

## Verification

- Signed-in refresh at `/` → renders `AuthRedirectSkeleton` for one frame, then redirects to the last-visited page. No marketing hero flash.
- Signed-out visit at `/` → renders the full `Landing` (unchanged).
- Loading with a stored session but no `user` yet → skeleton shows until the session hydrates and the redirect fires.
- `bunx tsgo --noEmit` passes.

## Technical notes

- Files touched: new `src/components/AuthRedirectSkeleton.tsx`; edits to `src/routes/index.tsx`.
- No routing, storage, or auth-gate behavior changes.
