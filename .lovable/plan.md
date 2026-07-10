## Fix: content doesn't load on mobile after Google login

### Root cause

`src/hooks/use-auth.ts` initializes with `supabase.auth.getUser()` — a network call to the Auth server. On mobile webviews (especially the Lovable Android app) this frequently resolves BEFORE the Supabase client finishes rehydrating the persisted session from `localStorage`, so:

1. `getUser()` returns "no user" over the network,
2. `setAuthState({ user: null, loading: false })` fires,
3. every screen that reads `useAuth()` renders its signed-out branch (Profile → "Sign in to view your profile"; feed → empty because RLS sees no bearer),
4. by the time `onAuthStateChange` finally fires `INITIAL_SESSION`/`SIGNED_IN` with the real session, many data hooks have already run their one-shot `useEffect(..., [user?.id])` fetch against `user=null` and don't refetch until a manual reload.

### The fix — restore the session first, then verify

Change `initAuthStore()` in `src/hooks/use-auth.ts` to the pattern documented in `tanstack-supabase-integration` and the stack-overflow reference:

1. Subscribe to `onAuthStateChange` FIRST (so no event is missed while we hydrate).
2. Call `supabase.auth.getSession()` — this reads from `localStorage` and is what actually gates "auth is ready". Set `{ session, user: session?.user ?? null, loading: false }` from its result.
3. Do NOT block hydration on `getUser()`. Fire it AFTER we've published the session, and only use it to upgrade `user` with the server-verified copy (or clear state if it returns an explicit "user not found" error, not a network error).
4. In `onAuthStateChange`, keep ignoring `INITIAL_SESSION` with no session (so we don't clobber a session `getSession()` just published), and on any event WITH a session, update state + set `loading: false`.

Net effect: on mobile, `loading` flips to `false` only once the persisted session is known, and `user` is populated the whole time the tab is signed in.

### Belt-and-suspenders in the data hooks that showed the symptom

Two hooks fire a Supabase query in `useEffect(..., [user?.id])` and never refetch if `user` arrives late:

- `useMyProfile` in `src/lib/user-prefs-store.ts` (already keyed on `user?.id`, so the fix above resolves it once `user` becomes non-null — no change needed as long as `useAuth` no longer publishes a false-null).
- The profile page's own `refreshRequests` / realtime subscription (`src/routes/_tabs.profile.tsx`, keyed on `profileUser?.id`) — same story.

Both are correct once `useAuth` stops publishing `{ user: null, loading: false }` prematurely. No changes needed in these files.

### Files changed

- `src/hooks/use-auth.ts` — rewrite `initAuthStore()` per above. ~20 lines. No API change: `useAuth()`, `signOut()`, `getCurrentUser()` signatures stay identical.

### Out of scope

- No changes to `src/routes/auth.tsx` (the Google flow itself works — logs confirm token exchange succeeds and the hard-reload lands on `/profile`).
- No changes to `__root.tsx`, route tree, or RLS.
- No new queries or React Query wiring.

### Verification

- Lovable Android app: sign in with Google → land on `/profile` → profile card, cover, name, and joined games render on first paint (no "Sign in" flash, no empty feed).
- Desktop Chrome: unchanged behavior; loading flips to false just as fast because `getSession()` is a local read.
- Sign-out: `signOut()` still triggers `onAuthStateChange('SIGNED_OUT', null)` → state clears → profile falls back to signed-out CTA.
