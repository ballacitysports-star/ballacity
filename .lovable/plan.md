## Problem

When a new user signs in with Google from the "Sign in" tab (or the "Sign up" tab without first picking a type), no `pendingAccountType` is stashed before the OAuth redirect. On return, the `handle_new_user` DB trigger creates the profile with `account_type = 'player'` by default, so the app treats them as an existing player and never shows the account-type picker.

Root cause (verified in `src/routes/auth.tsx` L172-174 and the `handle_new_user` function in db-functions): the picker only runs pre-OAuth in signup mode with an explicit selection; the trigger silently defaults everyone else to `player`.

## Fix

Make account type "unset until the user picks it" and gate the app on that.

### 1. DB migration
- Update `handle_new_user()` so `account_type` is set only when `raw_user_meta_data->>'account_type'` is one of `player|team|trainer|gym`; otherwise insert `NULL`.
- Keep the `enforce_account_type_lock` trigger — still valid (nothing linked yet when null).
- No changes to grants/RLS.

### 2. New route `src/routes/onboarding.account-type.tsx`
- Public-ish route reachable only when authenticated with a null `account_type`.
- Renders the existing `AccountTypePicker` (same 4-card UI used in signup).
- On confirm: `UPDATE profiles SET account_type = <choice> WHERE id = auth.uid()`, then navigate:
  - `player` → `/onboarding/welcome`
  - `team` → `/teams/create`
  - `trainer` → `/trainers/create`
  - `gym` → `/orgs/create`
- Cannot be dismissed; no back-to-app link. Sign-out button available.

### 3. `src/routes/__root.tsx` gate change (L389-411)
Replace the "sign out on missing type" branch with:
- If `account_type` is null/invalid AND current path is not `/onboarding/account-type` → `router.navigate({ to: "/onboarding/account-type", replace: true })`.
- Leave the existing pending-type persistence path (L476-499) intact so users who did pick a type pre-OAuth skip the picker automatically.

### 4. Add `/onboarding/account-type` to the auth-gate allow list
The route must render for signed-in users but not require an existing `account_type`. Add it to whatever guard exposes `isPublic` / gate skip list in `__root.tsx` so the null-type redirect doesn't loop.

## Result
- Existing users with a real `account_type` are unaffected.
- New Google sign-ins land on the account-type wizard, then the correct create/onboarding screen.
- Email signups still pre-select the type (pending key path) and skip the wizard.

## Files touched
- New: Supabase migration updating `handle_new_user`.
- New: `src/routes/onboarding.account-type.tsx`.
- Edit: `src/routes/__root.tsx` (redirect instead of sign-out; allow the new route through the gate).
