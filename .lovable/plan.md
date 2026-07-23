## Goal
Let a user edit and delete their organizations from Settings.

## Where
Add a new "My organizations" section in `src/routes/settings.tsx` (under Account), rendered only when signed in and only if the user has orgs. No new route needed — Edit reuses `/orgs/$orgId/edit`.

## UI
- Card list of orgs the current user belongs to via `listMyOrgs` (already exists in `src/lib/trainer-orgs.functions.ts`).
- Each row: org avatar + name + role chip, plus:
  - "Edit" button → `<Link to="/orgs/$orgId/edit" params={{ orgId }}>` (owner or admin only; hidden for plain members).
  - "Delete" button → owner-only. Opens an AlertDialog confirming permanent deletion; on confirm calls `deleteTrainerOrg({ data: { id } })`, toasts result, and invalidates `["my-orgs"]` / `["trainer-org-memberships"]` / `["trainer-org"]` query keys.
- Empty state hidden entirely (section only renders when there is at least one org).

## Data
- Query: `useQuery({ queryKey: ["my-orgs"], queryFn: () => listMyOrgs() })`.
- Mutation: `useMutation` wrapping `deleteTrainerOrg`; on success invalidate related keys and remove the row optimistically.
- No schema changes. `deleteTrainerOrg` server fn already exists and RLS restricts deletes to the owner, so non-owners will get a rejected mutation — we still gate the button client-side by role for UX.

## Out of scope
No changes to org creation, member management, or the org detail/edit screens themselves.
