# Fix "Player" showing after registering as a gym

Confirmed cause: the newest account registered as Gym has its onboarding type saved as "gym", but no gym profile was ever created — onboarding's last step links to "Create gym profile", and if that step is skipped or abandoned, the account only has a player profile. The app then falls back to the player profile, so Settings, the switcher, and the Profile tab all say "Player".

## What will change

- Registering as a gym (or team/trainer) is not finished until the gym/team/trainer profile actually exists. After the onboarding steps, the app lands on that setup screen and keeps returning there until the profile is created — the app tabs aren't reachable with an unfinished setup.
- That setup screen gets a clear "finish this to use your gym account" notice, plus an explicit "Continue as a player instead" escape hatch that switches the account to a player account so nobody gets stuck forever.
- While setup is incomplete, Settings and the profile switcher show the registered type with a "Setup incomplete — finish gym setup" state instead of silently saying "Player", so the label always matches reality.
- Once the gym is created the account switches into that gym profile, and Settings, the switcher, and the Profile tab all read Gym.

## Technical section

- Pending-setup detection: add a small derived flag in `src/lib/account-profiles.ts` — read `profiles.account_type` alongside `active_profile_id`/`default_profile_id` in `fetchMyProfiles`, and expose `pendingKind` = `account_type` when it is a non-player type with no matching `account_profiles` row of that kind. No schema change.
- Gate: in `src/routes/_tabs.tsx`, when `pendingKind` is set, redirect to the matching create route (`/orgs/create`, `/teams/create`, `/trainers/create`) with a `?finish=1` search param. Client-side only (the tabs subtree already renders after auth); keep it a single effect-free `beforeLoad`-style check consistent with the existing route patterns in that file.
- Create routes (`orgs.create.tsx`, `teams.create.tsx`, `trainers.create.tsx`): when `finish=1`, render a notice banner and a "Continue as a player instead" action that sets `profiles.account_type = 'player'`, points `active_profile_id` at the player profile, invalidates `myProfilesKey`, and navigates to `/feed`. On successful creation the existing `setActiveProfileByRef` path already activates the new profile; add the same `myProfilesKey` invalidation where missing.
- Labels: `src/routes/settings.tsx` "Onboarding details" and `src/components/ProfileSwitcher.tsx` use `pendingKind` when present — show `ACCOUNT_TYPE_META[pendingKind].label` with a "Setup incomplete" chip and a link to the create route with `finish=1`.
- Onboarding (`src/routes/onboarding.welcome.tsx`): keep the final handoff, but navigate with `finish=1` so the gate and the setup screen agree.
- No migration; existing accounts with a pending type (e.g. the gym signup above) are routed into setup on their next visit.
