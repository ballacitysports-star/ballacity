## Why the created team disappears

Teams currently live only in an in-memory module array (`ORGS` in `src/lib/sample-data.ts`, mutated by `src/lib/org-store.ts`). That means:

- On any hard refresh, the module reloads with just the seeded sample teams — user-created teams vanish.
- SSR loaders (`teams.$teamId.tsx`, `teams` list) run against server-side `ORGS`, which never has client-side additions, so a direct visit to a newly-created team can even 404.

The uploaded cover photo already persists (it's stored in the `team-covers` Supabase bucket and returns a long-lived signed URL), but nothing else does. Fix = persist the team row itself in the database.

## Plan

1. **New `public.teams` table (Lovable Cloud)** — one migration with GRANTs, RLS, and update trigger.
   - Columns mirror the fields collected in `teams.create.tsx` / used by `OrgCard` and the team page: `id`, `owner_id (auth.users)`, `kind ('team'|'coach')`, `name`, `handle`, `tagline`, `city`, `founded`, `sports (text[])`, `bio`, `achievements (text[])`, `accent`, `avatar`, `cover`, `league`, `home_court`, `wins`, `losses`, `staff (jsonb)`, `credentials (text[])`, `rate_per_hour`, `skill_min`, `skill_max`, `followers` (default 0), `verified` (default false), `created_at`, `updated_at`.
   - RLS: anyone signed in can SELECT (teams directory is a shared feed); owner can INSERT/UPDATE/DELETE their own rows (`auth.uid() = owner_id`).
   - Public `anon` SELECT too, so the directory works pre-auth like it does today.

2. **Data layer refactor — `src/lib/org-store.ts`**
   - Replace the in-memory store with Supabase-backed helpers:
     - `useAllOrgs()` → TanStack Query (`useQuery`) reading from `teams` + merging seeded sample orgs for the demo directory.
     - `getOrgById(id)` → server fn / query.
     - `addOrg(org)` → insert row (owner = current user); on success invalidate the teams query.
     - `updateOrg`, `deleteOrg` → matching update/delete against the row.
     - `isMyOrg(id)` → check `owner_id === auth.uid()`.
   - Keep the sample-data `ORGS` array as read-only seed data for the directory; real user teams live in the DB.

3. **Route wiring**
   - `src/routes/_tabs.teams.tsx`: replace `useAllOrgs()` with the new query hook. Show a small skeleton while loading.
   - `src/routes/teams.$teamId.tsx`: change the loader to fetch the org from Supabase via `createServerFn` (isomorphic-safe), keeping `notFound()` behavior. Head/meta unchanged.
   - `src/routes/teams.$teamId.edit.tsx`: call the DB `updateOrg` (owner-only) and invalidate.
   - `src/routes/teams.create.tsx`: `submit()` awaits `addOrg`, then navigates; disable the Create button while the insert is in-flight; show inline error on failure.

4. **Auth requirement for create/edit**
   - Wrap `/teams/create` and `/teams/$teamId/edit` under `_authenticated/` (or gate inline) so `owner_id` is always available. Public `/teams` and `/teams/$teamId` remain readable to signed-out users.

5. **No changes to** the `TeamCoverUploader`, the `team-covers` storage bucket, sample seed data rendering, or the games/roster features.

## Out of scope

- Migrating games, follows, or messaging to a different pattern.
- Moderation / verification workflow for teams.
- Real distance calc (still uses `pseudoDistance`).

## Technical details

- Loader for `teams.$teamId` calls a `createServerFn({ method: 'GET' })` that queries by id — safe under SSR/prerender because it doesn't require auth (relies on the `anon` SELECT policy).
- Create/update/delete server calls go through `requireSupabaseAuth` so `owner_id` and RLS are enforced server-side.
- Sample seed orgs are kept client-side and merged in the directory query result (sorted with DB rows) so the existing demo experience is preserved.
- `Org` type stays the same shape; a small mapper converts DB row (snake_case) ↔ `Org` (camelCase).
