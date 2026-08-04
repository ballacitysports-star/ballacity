# Multiple profiles per account, with a profile switcher

Today an account is locked to exactly one type (Player, Team, Trainer, or Gym), and the app tells you to sign up with another email if you want a different one. This changes that: every account keeps its personal player profile, and you can add as many Team, Trainer, and Gym profiles as you want, then switch which one you're acting as across the whole app.

## What you'll be able to do

- Keep your player profile always — it's your personal identity and can't be removed.
- Add Team, Trainer, and Gym profiles from Settings or your profile page, as many as you like.
- Switch the active profile from a switcher in the top bar (avatar menu) and in Settings. The switcher lists your player profile plus every team/trainer/gym you own, with avatar, name, and type label.
- The active profile drives the whole app: what your profile tab shows, who hosts a game you create, who sends messages, and which management screens appear.
- Creating a Team/Trainer/Gym no longer blocks you or asks for a different email — the "wrong account type" screens are replaced by a normal create flow that switches you into the new profile once it's saved.

## Onboarding wording changes

- Signup picker becomes "Where do you want to start?" with a note: "You can add team, trainer, and gym profiles later and switch between them anytime." The current "This is permanent. To use a different account type, sign up with a different email." line is removed.
- The onboarding welcome step and Settings drop the "locked" language; Settings shows your profiles list instead, with "Add a profile".
- Player is always created; the picked type (if not player) is created as an additional profile right after onboarding.

## Technical section

Database (one migration):

- New table `public.account_profiles`: `id`, `user_id`, `kind` ('player' | 'team' | 'trainer' | 'gym'), `ref_id` (text — `teams.id` or `trainer_orgs.id`, null for player), `created_at`. GRANT to `authenticated` (+ `service_role`), RLS with owner-scoped policies on `auth.uid() = user_id`.
- Add `profiles.active_profile_id uuid` — pointer to the row in `account_profiles` currently in use. Defaults to the player row.
- Backfill: create a player row for every existing profile, plus rows for each owned `teams` / `trainer_orgs` record; set `active_profile_id` to the row matching the current `account_type`.
- Drop the triggers that block multi-profile use: `enforce_account_type_lock_trg`, `enforce_single_linked_team_trg`, `enforce_single_linked_org_trg`, `enforce_team_owner_account_type_trg`, `enforce_org_owner_account_type_trg`. Keep `profiles.account_type` as the active profile's kind (kept in sync) so existing reads and the `get_account_type` function keep working.
- Triggers on `teams` / `trainer_orgs` insert+delete keep `account_profiles` in sync.

App code:

- `src/lib/account-type.ts`: keep `AccountType` + `ACCOUNT_TYPE_META`; add `useMyProfiles()` (player + owned teams/orgs), `useActiveProfile()`, and `switchActiveProfile(id)` which updates `active_profile_id`, mirrors `account_type`, and invalidates queries so the app re-renders in the new context.
- New `src/components/ProfileSwitcher.tsx` — dropdown used in the header and Settings, with "Add a profile" entries per type.
- Replace `src/components/AccountTypeGate.tsx` usage in `teams.create.tsx`, `trainers.create.tsx`, `orgs.create.tsx` with a lightweight signed-in check; after create, switch active profile to the new one.
- Update `AccountTypePicker`, `src/routes/auth.tsx`, `src/routes/onboarding.welcome.tsx`, and `src/routes/settings.tsx` for the new wording and profiles list.
- Profile tab, create-game host attribution, and org/team management screens read the active profile instead of `account_type` directly.
