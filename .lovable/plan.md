## Goal

The "My organizations" section (with the "Start a team, trainer, or gym" empty state and the Team/Trainer/Gym create buttons) should not appear for player accounts. Team, trainer, and gym accounts keep it unchanged.

## Change

In the edit-profile screen (`src/routes/profile.edit.tsx`):

- Read the current account type with the existing `useAccountType()` hook from `src/lib/account-type.ts`.
- Wrap the whole `My organizations` section (title, header create-chips, empty state, and the owned team/trainer/gym lists) so it only renders when the account type is not `player`.
- While the account type is still loading, render nothing for this section to avoid a flash of the create buttons for players.

No other sections, routes, or backend behavior change. The `/teams/create`, `/trainers/create`, and `/orgs/create` routes stay as-is and remain gated by their existing account-type guards.
