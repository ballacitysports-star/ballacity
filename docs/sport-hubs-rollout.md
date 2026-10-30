# Sport hubs: rollout and rollback

Status: local only. Nothing here is deployed, pushed or applied to any database.

## What exists
- `/<sport>` public hub for every sport in the canonical guide list (`src/routes/$sport.tsx`, `src/lib/sport-hubs.ts`).
- Public data comes from `getSportHubListings` (`src/lib/city-pages.functions.ts`): sport filtered in the query, capped at 12 per section, and passed through the existing adult-only / hidden / private rules. No gyms, because a gym row has no verified sport.
- Sport context from a hub CTA is kept in `sessionStorage` (validated against the canonical list) and used once to seed the first sport in onboarding, only when the profile has none.
- "Make primary" in the sports editor. Primary is still `sports[0]` / `profiles.sport`; no schema change.
- Analytics events `view_sport_hub` and `select_primary_sport` (sport name only, adult-gated like all events).

## Database
One additive migration, `20261030120000_sport_hubs_setting.sql`: seeds `app_settings.sport_hubs` as `{"enabled": true}` with `is_public = true`, and never overwrites an existing row. It is not applied anywhere. The row must stay public: anonymous reads only see public rows, so a non-public row would leave the switch ineffective.

Anonymous read paths were reviewed against the migrations (not run): `hosted_games` is limited to adult-only, uncancelled, unhidden games by the restrictive anon policy in `20261029150000`, and every `teams` column the hub selects is in the anon column grant from `20261021150000`.

## Kill switch
Set `app_settings.sport_hubs` (keep `is_public = true`) to `{"enabled": false}`. Hubs then 404. A missing row means enabled. This is a display switch only; it grants and removes no permissions. Removing the route file also restores prior behavior, with no data to clean up.

## Before staging
1. `bun install`, then `bun run dev` or `bun run build` to regenerate `src/routeTree.gen.ts` (tracked file; the `/$sport` route is not in it yet).
2. `bun run lint`, `bunx tsc --noEmit`, `bun run test`.
3. Confirm anon RLS on `hosted_games` and `teams` for the new filtered queries (same columns as the city pages).
4. Check `/basketball` etc. at phone width and signed-out.
