# Fix the stuck "Loading your account…" screen on /feed

## What's happening

The stuck tab is signed out. The auth gate correctly decided to send it to `/auth`
(console: `[AuthGate] redirect … hasUser: false, hasStoredSession: false`), but the
URL never changed — it's still `/feed?sport=Basketball…` and the full-screen
"Loading your account…" spinner is showing with no app content behind it.

Right after that redirect log, the console shows a router failure coming from the
Home feed's URL-sync effect (`src/routes/_tabs.feed.tsx`):
`Could not find match for from: /feed`. That effect calls
`navigate({ search, replace: true })` every time feed prefs change — including
right after the profile-sports seeding I added writes prefs. So a feed-owned
navigate is firing at the same moment the gate is redirecting away from `/feed`,
and the redirect doesn't take effect.

Not yet confirmed: whether the gate's own `router.navigate({ to: "/auth" })` throws
in that collision (which would leave `verifying` true forever and explain the
permanent spinner) or whether the feed's navigate re-commits `/feed` after it.
Verifying that is the first step, and the fix is written so either cause is closed.

## The fix

1. Confirm the failure mode first by reproducing `/feed` signed out in a browser
   session and capturing the console around the redirect.
2. Make the auth gate's redirect unbreakable: run the `/auth` navigate inside
   try/catch, always clear the `verifying` flag in a `finally`, and if the location
   still isn't `/auth` shortly after, fall back to a hard `window.location.replace`.
   The spinner must never outlive a redirect decision.
3. Stop the feed from writing to the URL when it shouldn't:
   - skip the URL-sync navigate while the viewer is signed out / the gate is still
     verifying, and while the feed route is no longer the active match;
   - guard the navigate itself so a router rejection can't bubble out of the effect.
4. Only seed sports from the profile for a signed-in viewer with a loaded profile,
   so seeding can't write prefs (and therefore can't trigger a navigate) during the
   signed-out redirect window.
5. Re-verify: signed out `/feed` lands on `/auth?next=/feed…`; signed in `/feed`
   still seeds sports once and keeps URL/pref syncing intact; check the build log
   and the browser console for the `Could not find match for from:` warning.

## Technical notes

- Files: `src/routes/__root.tsx` (`attemptRedirect` in the auth gate),
  `src/routes/_tabs.feed.tsx` (URL-sync effect + `useSeedSportsOnce` call),
  possibly `src/lib/default-sports.ts` (accept a `ready` gate on auth).
- No database or schema changes.
- Sports-seeding behavior (first visit seeds from profile, later manual choices
  stick) stays exactly as-is for signed-in users.
