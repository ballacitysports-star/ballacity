## Goal

On mobile Safari and Chrome, refreshing any protected page (e.g. `/feed`, `/games/:id`, `/messages/:id`) currently drops the user onto the landing page at `/`. It works correctly on desktop. Fix it so refresh always keeps the user on the same URL.

## Root-cause hypothesis

The app never explicitly navigates a signed-in user to `/`. Two mobile-only conditions can strand them there today:

1. **OneSignal service worker intercepts navigation requests.** `public/OneSignalSDKWorker.js` only bypasses `/~oauth/*`. On mobile browsers the SW is registered and OneSignal's imported worker installs a broad `fetch` handler; on refresh under flaky mobile networks it can serve a cached shell that resolves to the landing route.
2. **Supabase session hydration races on mobile.** `useAuth` reads `getSession()` from localStorage. On mobile Safari (ITP) and Chrome Android, storage can be evicted or arrive after first paint, so `AuthGate` sees `user = null` briefly. Today that redirects to `/auth`, but combined with `window.location.replace` in `auth.tsx` and lost `next` params on some in-app browsers, the fallback resolves to a public route. The user then perceives it as "sent home".

## What to change

### 1. Stop the OneSignal SW from touching page navigations

`public/OneSignalSDKWorker.js`

- Register a `fetch` listener BEFORE `importScripts` that short-circuits every `request.mode === "navigate"` request straight to the network (`event.respondWith(fetch(event.request))`). Keep the existing `/~oauth/*` bypass.
- This guarantees the SW cannot serve a cached shell for `/feed`, `/games/:id`, etc.

### 2. Make `AuthGate` refresh-safe on mobile

`src/routes/__root.tsx`

- In `AuthGate`, do not redirect to `/auth` on the very first `loading → false` transition when `user` is `null`. Instead:
  - Track a `verifying` state and re-check `supabase.auth.getSession()` once more (mobile hydration can lag one tick behind the store's `loading` flip).
  - Only after that second check still returns no session do we navigate to `/auth`.
- When we do navigate, keep the current behavior of preserving `next` via `sanitizeNextPath`, and use `router.navigate({ replace: true })` (already there).
- Keep `AuthLoadingFallback` unchanged — the retry UI already handles the long-tail case.

### 3. Make post-auth redirect resilient on mobile

`src/routes/auth.tsx`

- In `goPostAuth`, if `next` is missing, fall back to `document.referrer` when it is same-origin and passes `sanitizeNextPath`, then finally `/feed` (not `/profile`). `/feed` is the in-app default surface and matches what desktop lands on.
- Keep `window.location.replace` for the hard reload behavior mobile needs.

### 4. Never bounce a signed-in visitor off `/`

`src/routes/index.tsx`

- Landing is public and shows a marketing page. Leave it public, but if the user is already signed in (from `useAuth`), render a small "Continue to app" affordance pointing to `/feed` so a mobile user who somehow lands here has a one-tap way back. Do NOT auto-redirect — that would break the marketing page for signed-in users who intentionally visited `/`.

### 5. Lightweight telemetry to confirm the fix

`src/routes/__root.tsx`

- When `AuthGate` decides to redirect to `/auth`, log a single `console.warn` including `pathname`, `document.visibilityState`, and whether `localStorage` contained the Supabase session key. This gives us a signal in the browser console if the bug recurs on a specific device.

## Files touched

- `public/OneSignalSDKWorker.js` — add navigation bypass.
- `src/routes/__root.tsx` — second-chance session check in `AuthGate`, warn on forced redirect.
- `src/routes/auth.tsx` — smarter `next` fallback (`document.referrer` → `/feed`).
- `src/routes/index.tsx` — session-aware "Continue to app" affordance.

## Out of scope

- Adding a PWA manifest or reworking service worker strategy beyond the navigation bypass.
- Changing auth providers or the Supabase storage adapter.
- Any backend/RLS changes.

## Verification

- Desktop: hard refresh on `/feed`, `/games/:id`, `/messages/:id`, `/profile` — stays on the same URL (regression check).
- Mobile Safari and Chrome Android: same refresh matrix — stays on the same URL; if signed out, lands on `/auth` and after sign-in returns to the original URL, never `/`.
- Signed-in user manually visits `/` on mobile — sees landing with a "Continue to app" button, no forced redirect.
