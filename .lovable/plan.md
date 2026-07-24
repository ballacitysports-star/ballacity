## Root cause

New Google/Apple users end up on marketing `/` because two bugs compose:

1. **`goPostAuth` in `src/routes/auth.tsx` treats `/` as a valid destination.** With no `next` and no `lastVisited`, it falls back to `document.referrer`, which for users who came to `/auth` from the landing is `/`. `sanitizeNextPath` allows `/`. It then hard-reloads to `/`.
2. **`src/routes/index.tsx` uses an invalid navigate option.** `router.navigate({ href: dest, replace: true })` — TanStack Router's `NavigateOptions` uses `to`, not `href`. The call silently no-ops, so signed-in users never leave the marketing page. This also breaks the "signed-in user visits `/`" case in general (bookmarks, refresh at `/`).

Additionally, `__root.tsx`'s SIGNED_IN reconcile that would send new OAuth users to `/onboarding/account-type` runs in the pre-reload page — after `window.location.replace("/")` reloads, only `INITIAL_SESSION` fires and is filtered out, so the reconcile never gets a second chance.

## Fix

### 1. `src/routes/auth.tsx` — never land on `/` after sign-in
- In `goPostAuth`, after computing `dest` (from `next`, `lastVisited`, and referrer), treat `/` as "no destination" and fall through to `/feed`.
- Same treatment for the `oauth()` success branch at line 265 (`window.location.replace(next ?? "/profile")`) — if `next === "/"`, use `/feed` instead.
- This is a UI/presentation-layer fix; no business logic changes.

### 2. `src/routes/index.tsx` — actually navigate signed-in users away
- Replace `router.navigate({ href: dest, replace: true })` with `router.navigate({ to: dest, replace: true })`.
- Keep the skeleton fallback so marketing never flashes.

### 3. Optional hardening in `sanitizeNextPath` (`src/routes/__root.tsx`)
- Add `/` to the excluded paths so no future caller can pick the landing as a post-auth destination. Landing is not a sensible "return here after sign-in" target for an authenticated user in this app.

Result: new OAuth users hard-reload to `/feed`, `AuthGate` sees `account_type` is null, and routes them to `/onboarding/account-type` — the intended flow. Users who refresh on `/` while signed in also correctly bounce to their last visited page (or `/feed`) instead of being stuck on marketing.

## Verification

- Manual: sign in with a brand-new Google account from `/auth` (from marketing referrer and from a direct visit) → lands on `/onboarding/account-type`. Same for Apple.
- Add a small assertion to `e2e/oauth-new-user-onboarding.spec.ts` (or a sibling spec) covering the "referrer is `/`" case so this regression can't sneak back.
