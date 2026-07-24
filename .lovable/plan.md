## Goal
For any user signing in with Google or Apple whose `profiles.account_type` is still empty, unconditionally redirect them to `/onboarding/account-type` — even if a "pending" choice was stashed before the OAuth handoff. Email sign-ins and returning users are unaffected.

## Current behavior (verified)
`src/routes/__root.tsx` (auth-state effect, ~L503–539):
1. On any `SIGNED_IN` event, read `profiles.account_type`.
2. If it exists → done.
3. If it's missing but `readPendingAccountType()` has a value → silently write it into the profile and continue to the saved `next` path.
4. Otherwise → navigate to `/onboarding/account-type`.

Because branch 3 auto-applies a locally stashed choice, a first-time Google/Apple user can bypass the account-type screen (e.g. if a stale `pending` value exists, or if the flow ever pre-selects one).

## Change
In `src/routes/__root.tsx`, for OAuth (Google/Apple) sign-ins with no existing `account_type`, skip the pending auto-apply and always navigate to `/onboarding/account-type`. The pending value (and the saved `next` path) stay in storage so the picker/wizard can consume them after the user confirms their type.

Detection: use `session.user.app_metadata.provider` (values `"google"` / `"apple"`). Email/password sign-ins keep today's behavior (still redirected to the picker when type is missing, since branch 4 already handles it; branch 3 only matters when a `pending` value exists, which for email is set on the same device moments earlier).

### Pseudocode
```ts
const provider = session.user.app_metadata?.provider;
const isOAuth = provider === "google" || provider === "apple";

// existing profile lookup...
if (isAccountType(existing)) { /* unchanged */ return; }

if (isOAuth) {
  // Always force the picker for new social sign-ins.
  if (router.state.location.pathname !== "/onboarding/account-type") {
    router.navigate({ to: "/onboarding/account-type", replace: true });
  }
  return;
}

// Non-OAuth: keep current pending-apply behavior.
if (pending) { /* update profile, consume next */ return; }
router.navigate({ to: "/onboarding/account-type", replace: true });
```

The existing `AuthGate` type-check guard (L389–422) already blocks protected routes when `account_type` is missing, so this is a belt-and-suspenders redirect that guarantees the picker screen appears immediately after OAuth callback rather than after a route flash.

## Files touched
- `src/routes/__root.tsx` — adjust the `SIGNED_IN` reconcile block only.

## Out of scope
- No DB / RLS / auth-provider changes.
- No changes to `/onboarding/account-type` UI or to `onboarding.welcome.tsx`.
- Email sign-in flow unchanged.
