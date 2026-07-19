## Add Gym under "My organizations" in Profile Edit

The "My organizations" section (`src/routes/profile.edit.tsx` L651–701) currently only shows Team and Trainer add pills, and `useMyOrgs()` only reads the `teams` table. Gyms (rows in `trainer_orgs`, created via `/orgs/create`) never surface here.

### Changes

Scope: `src/routes/profile.edit.tsx` only.

1. **Header pills** — add a third pill next to Team/Trainer:
   - `+ Gym` → `Link` to `/orgs/create`.

2. **Empty state** — change the two-button grid into a three-button grid and add a "Start a gym" CTA linking to `/orgs/create`.

3. **List the user's gyms** alongside teams/trainers:
   - Add a TanStack Query fetch using `listTrainerOrgs` (or a small `listMyOrgs`-style filter on `owner_id = auth user`) plus `listMyTrainerOrgMemberships` to include gyms where the user is a member/admin.
   - Filter to gyms owned by the current user (simplest cut) via the existing `owner_id` field returned by `listTrainerOrgs`.
   - Render each gym in a lightweight card (avatar/cover, name, handle, city, "Gym" badge) that links to `/orgs/$orgId`. Use inline JSX rather than extending `OrgCard` (which is typed for the teams schema).
   - Merge with `myOrgs` for the empty-state check: if any teams, trainer profiles, or gyms exist, show the lists instead of the empty state.

### Out of scope

- No schema changes; `trainer_orgs` and `/orgs/create` already exist.
- `OrgCard` and the teams-based `useMyOrgs` stay as-is.
- No changes to gym creation or edit flows.
