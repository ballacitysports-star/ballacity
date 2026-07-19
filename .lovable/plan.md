## Goal

When editing a trainer profile, keep the URL under `/trainers/...` instead of jumping to `/teams/$teamId/edit`.

## Approach

Add a dedicated trainer edit route that reuses the existing editor UI, and point trainer-facing Edit links at it. Team edits keep using `/teams/$teamId/edit`.

## Changes

1. **New route `src/routes/trainers.$trainerId.edit.tsx`**
   - `createFileRoute("/trainers/$trainerId/edit")`, `ssr: false`.
   - Extract the current `EditOrg` component from `src/routes/teams.$teamId.edit.tsx` into a shared module `src/components/edit/EditOrgScreen.tsx` that takes `orgId` as a prop.
   - The trainer route reads `trainerId` param, passes it as `orgId`, and on save/cancel navigates back to `/trainers/$trainerId`.

2. **Update `src/routes/teams.$teamId.edit.tsx`**
   - Becomes a thin wrapper that renders `<EditOrgScreen orgId={teamId} backTo="team" />`.
   - Coach-kind orgs opened here still work, but success redirect goes to `/teams/$teamId` (unchanged for team-kind).

3. **Repoint trainer-facing Edit links to the new route**
   - `src/routes/trainers.$trainerId.tsx:240` → `to="/trainers/$trainerId/edit"` with `params={{ trainerId }}`.
   - `src/components/TrainerProfileChecklist.tsx:37` → same.
   - Leave team-oriented links (`OrgCard`, `TeamsMapView`, `CreateOrgWizard`, review routes) untouched.

4. **Post-save navigation inside `EditOrgScreen`**
   - Already redirects to `/trainers/$id` for coach kind and `/teams/$id` for team kind — keep that behavior so both entry points land back where the user came from.

## Verification

- Typecheck.
- Playwright: open `/trainers/c-nc-4kgo`, click Edit, assert URL is `/trainers/c-nc-4kgo/edit`, advance one step, Save, assert redirect to `/trainers/c-nc-4kgo`.
