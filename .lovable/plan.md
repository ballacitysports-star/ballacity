## Goal

Lock each auth user to exactly one account type (player, team, trainer, or gym) chosen at signup. Remove every path that lets a signed-in user create or switch to a different type on the same account. To use another type, users must register a separate account with a different email.

## Current State (verified)

- `public.profiles.account_type` is set once by `handle_new_user` from signup metadata.
- `change_account_type(_new_type)` RPC exists and deletes linked rows to allow switching — this is the main leak.
- `/onboarding/account-type` route lets a signed-in user re-pick and calls `change_account_type`.
- `AccountTypePicker` is used both at signup and post-signup.
- `enforce_account_type_lock` trigger already blocks direct `account_type` updates when a linked profile exists, but the RPC is SECURITY DEFINER and bypasses it.
- Creation routes exist for each type: `/teams/create`, `/trainers/create`, `/orgs/create`. DB triggers (`enforce_team_owner_account_type`, `enforce_org_owner_account_type`) already reject creating a linked profile whose kind doesn't match `account_type`, so the DB is already safe — but the UI still exposes those routes to mismatched users.

## Changes

### 1. Database migration
- Drop the `change_account_type(text)` RPC entirely. No replacement.
- Keep existing triggers (`enforce_account_type_lock`, `enforce_team/org_owner_account_type`, `enforce_single_linked_team/org`) — they already enforce the rule server-side.

### 2. Remove the switch-type route
- Delete `src/routes/onboarding.account-type.tsx`.
- `src/routes/__root.tsx`: remove the redirect that sends users missing `account_type` to `/onboarding/account-type`. Account type is now always set at signup (metadata → `handle_new_user`), so this gate is obsolete. If a legacy account somehow lacks it, fall back to sign-out with a message rather than offering a picker.

### 3. Signup is the only place to pick
- `src/routes/auth.tsx`: keep the `AccountTypePicker` on the signup form. Confirm it passes `account_type` in `signUp` metadata (already the case). Add copy under the picker: "This is permanent. To use a different account type, sign up with a different email."
- No picker on sign-in.

### 4. Gate creation routes to matching type
- `/teams/create`, `/trainers/create`, `/orgs/create`: on mount, read `useAccountType()`. If the current user's `account_type` doesn't match the route's kind, render a blocked-state card ("Your account is a {type}. Team/Trainer/Gym profiles require a separate account.") with a link back to `/profile` — do not render the wizard. Also skip the auto-redirect from `onboarding.welcome` for mismatched types (shouldn't happen post-cleanup, but defensive).

### 5. Remove entry points from Settings / Profile
- `src/routes/settings.tsx`: remove any "Change account type" link/section if present. Keep "My organizations" only for gym accounts (already the case via ownership).
- Audit `src/routes/_tabs.profile.tsx` and `src/routes/_tabs.create.tsx` for any "switch type" affordance and remove.

### 6. Copy update on delete-account modal
- Clarify that deleting is the only way to free the email for a different account type.

## Out of scope
- Cross-account linking / "switch profile" UX. Users manage multiple accounts by signing out and signing in with a different email.
- Data migration for existing users who already switched via the old RPC — their current `account_type` stands.

## Technical notes
- Dropping the RPC is safe: after the UI cleanup, nothing else calls it. Grep confirms only `onboarding.account-type.tsx` invokes `supabase.rpc("change_account_type", …)`.
- DB triggers make the guarantee authoritative regardless of client bugs.
