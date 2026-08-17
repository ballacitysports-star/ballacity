# Fix: the gym edit page never opens

Confirmed by loading `/orgs/<gym id>/edit` in a browser with a signed-in owner session: the page renders the **public gym profile** (Directions / Call / Website / Ratings & reviews), not the edit form. No errors, no permission block — the edit screen simply is never rendered.

## Cause

The gym profile lives in `src/routes/orgs.$orgId.tsx`, so the router treats it as the *parent* of `/orgs/$orgId/edit` and `/orgs/$orgId/members` (visible in the generated route tree as `OrgsOrgIdRouteWithChildren`). That parent component does not render an `<Outlet />`, so both child screens are swallowed and the parent's own profile content shows instead.

Teams and trainers don't have this problem because they use the `…$teamId.index.tsx` / `…$trainerId.index.tsx` naming, which makes the profile a leaf route rather than a layout.

Database access is fine: the owner matches, the update policy allows owner/admin, and table grants exist. Nothing to change in the backend.

## The fix

- Rename `src/routes/orgs.$orgId.tsx` to `src/routes/orgs.$orgId.index.tsx` and update its route id to `/orgs/$orgId/`, matching the teams/trainers convention. This makes `/orgs/$orgId` a leaf and lets `/orgs/$orgId/edit` and `/orgs/$orgId/members` render their own screens.
- Verify nothing referenced the route via `Route.useParams`/`getRouteApi` under the old id inside that file and neighbouring components; update any such references.
- Existing `<Link to="/orgs/$orgId">` calls keep working (the path is unchanged); the regenerated route tree is picked up automatically.

## Verification

- Load `/orgs/<gym id>/edit` as the owner: the "Edit gym." form with autosave status renders.
- Change a field and confirm the autosave indicator saves and the value persists after reload.
- Load `/orgs/<gym id>/members` and confirm the members screen renders.
- Load `/orgs/<gym id>` and confirm the public profile still renders unchanged.
