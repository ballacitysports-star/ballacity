## Root cause (verified)

After creating a gym, `/orgs/$orgId` runs the `getTrainerOrg` loader which reads `trainer_orgs` through `publicClient()` (anonymous key). The current RLS on `trainer_orgs` has a single SELECT policy scoped to the `authenticated` role only:

```
SELECT "orgs are viewable by authenticated" TO authenticated USING (true)
```

Under the anon key the query returns `null` → loader throws `notFound()` → the "Organization not found." UI renders, even though the row was just inserted successfully.

The same anon-read pattern is used by other org queries in `src/lib/trainer-orgs.functions.ts` (list, members) so they'll silently return empty results for signed-out visitors too.

## Fix

Add anon read access to org directory data via a migration:

1. `GRANT SELECT ON public.trainer_orgs TO anon;`
2. New RLS policy `"orgs are publicly viewable" ON public.trainer_orgs FOR SELECT TO anon USING (true);`
3. Same for `public.trainer_org_members` (needed by `getTrainerOrg`'s members join) — `GRANT SELECT ... TO anon;` + `FOR SELECT TO anon USING (true)`.

Org directories are meant to be public browse pages (like team pages), so opening them to anon matches intent. Writes stay locked to authenticated owners/admins as before.

No code changes needed — the loader already works; it's just being blocked by RLS.

## Verification

After the migration approves and runs:
- Create a new gym → redirects to `/orgs/{id}` → page renders (not "not found").
- Signed-out visitors can also open `/orgs/{id}` directly.
