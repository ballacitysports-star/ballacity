## Goal
Add an "Organization / Gym" field to the trainer creation wizard so a trainer can attach an affiliation while creating their profile — either by picking an existing org or creating a new one on the fly.

## Where
`src/components/create/CreateTrainerWizard.tsx`, Step 1 ("Expertise") — under credentials. Small, optional field. No new steps.

## Behavior
- Typeahead search calling `listTrainerOrgs` (server fn already exists) with debounce.
- Two outcomes:
  - **Pick existing org** → store `{ orgId, orgName }` in draft. On publish, call `requestJoinTrainerOrg` after the trainer profile is created so the org owner can approve.
  - **Create new org** → free-typed name; on publish, call `createTrainerOrg({ name })` and link automatically (creator becomes owner).
- Field is fully optional — skip has no effect on canNext.
- Persisted in draft (`useDraftPersistence`) as `orgChoice: { mode: 'existing' | 'new' | null, orgId?: string, name?: string }`.
- Show a small chip on the Live preview card when set (e.g. "Member of Elite Hoops Academy · pending").

## Files touched
- `src/components/create/CreateTrainerWizard.tsx` — add field, draft state, submit-time linking.
- No DB migrations (tables already exist).
- No changes to `trainer-orgs.functions.ts`.

## Errors
If org linking fails after the trainer is created, keep the trainer profile (already saved), show a non-blocking toast: "Profile published — couldn't attach org, try again from your profile."

## Question
Should the field default to visible or hidden-behind-a-toggle ("Affiliated with an organization?") to keep Step 1 uncluttered?