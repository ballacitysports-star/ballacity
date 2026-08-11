# Make profile switching actually switch the app over

Right now switching a profile only saves the choice: the Profile tab always renders your personal player profile, so nothing visibly changes apart from the label in the switcher.

## What will change

- Switching to a team, trainer, or gym in the switcher makes the Profile tab render that profile: its banner/avatar, name and handle, description, and its own tabs (hosted games, roster/members, reviews) with an "Edit" action pointing at that profile's edit screen.
- Switching back to the player profile restores today's personal profile view unchanged.
- The rest of the app follows the switch immediately without a manual reload: the create-game host selection, availability prompts, and settings all read the same active profile.
- Switching shows the new context right away (toast stays), and if the active profile's team/gym was deleted it falls back to the player profile as it does today.

## Technical section

- `src/routes/_tabs.profile.tsx`: read `useMyProfiles()`; when `active.kind !== "player"`, render an org/team variant of the page instead of the player body. Reuse `ProfileChannelHeader` with team/org data (existing team and trainer_org queries used by `teams.$teamId.index.tsx` / `orgs.$orgId.tsx`) and keep `ProfileSwitcher` at the top in both variants. Extract the current player body into a local component so the two branches stay readable; no data-model changes.
- Non-player branch sections: hosted games for that team/org, members/roster count, reviews (gym), and actions linking to `/teams/$teamId/edit` or `/orgs/$orgId/edit` plus "View public page".
- Keep the switch itself as-is (`setActiveProfile` in `src/lib/account-profiles.ts`), but make dependent reads reactive: convert `useAccountType` consumers that must follow the switch to derive from `useMyProfiles().active.kind`, since `useAccountType` holds its own `useState` and is not invalidated by the switcher's query invalidation.
- No migration; no changes to `account_profiles` or `profiles` columns.
