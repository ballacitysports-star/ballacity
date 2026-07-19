## Goal
Move trainer creation out of the `/teams/create` route into its own `/trainers/create` route so the two flows are fully independent.

## Changes

### 1. New route: `src/routes/trainers.create.tsx`
- Copy `teams.create.tsx` as the starting point.
- Hard-code `kind = "coach"` (trainer). Remove the `kind` search param, the `kindParam` canonicalization effect, and the `setKind` state.
- Strip all `kind === "team"` branches: team name/league/record/home court/staff/roster fields and their wizard steps.
- Keep trainer-only fields: trainer name, sports, specialties/positions, credentials, rate per hour, session types, bio, cover photo, location.
- On submit, save with `kind: "coach"` and navigate to `/trainers` (or the new trainer's profile).
- `createFileRoute("/trainers/create")`.

### 2. Simplify `src/routes/teams.create.tsx`
- Remove the `kind` search param and the `/teams/create?kind=coach` redirect.
- Hard-code `kind = "team"` and delete all `kind === "coach"` branches (credentials, rate, session types, trainer copy).
- Route stays at `/teams/create`, always renders the team-only wizard.

### 3. Update entry points
- `src/routes/_tabs.trainers.tsx` (line ~296): change `to="/teams/create"` (currently with `kind: "coach"`) → `to="/trainers/create"`.
- `src/routes/profile.edit.tsx` (lines ~735, 742, 762, 769): trainer-related CTAs point to `/trainers/create`; team CTAs stay on `/teams/create` (no `kind` param).
- `src/routes/_tabs.teams.tsx` (line 260): keep `/teams/create`, drop any `kind` search value.

### 4. Cleanup
- Any lingering `?kind=team|coach` links removed.
- `routeTree.gen.ts` regenerates automatically.

## Out of scope
No changes to team/trainer data models, profile pages, or the shared `sport-config`/`org-store` helpers — only the creation route split and its call sites.