## Goal
Make the `+` button on `/trainers` open the create flow with the "Trainer" kind preselected, skipping the team/trainer step.

## Changes

**`src/routes/teams.create.tsx`**
- Add `validateSearch` to the route accepting `{ kind?: "team" | "coach" }`.
- Read `Route.useSearch()` in the component. If `kind === "coach"`:
  - Initialize `useState<OrgKind | null>` with `"coach"` instead of `null`.
  - Start the wizard at `step = 1` (skip the kind picker) when a valid kind is present in the URL.

**`src/routes/_tabs.trainers.tsx` (line 221)**
- Change the `<Link>` to `to="/teams/create"` with `search={{ kind: "coach" }}` so the wizard opens directly into the trainer flow.

## Notes
- No changes to teams page — the `+` there continues to open the picker (or we can mirror with `kind: "team"` later if desired, but not in scope).
- Underlying data model still uses `coach` for backward compatibility.