## Problem

Availability posts exist in the database (2 open rows) but neither your own nor others' posts show up in the app. Same root cause will affect messaging, notifications, games, reviews, etc.

Every table in the `public` schema is missing Data API GRANTs to the `authenticated`, `anon`, and `service_role` roles. RLS policies exist and would allow the reads, but without table-level GRANTs PostgREST refuses the query and the client silently gets empty/permission-denied results. All 25 public tables are affected — this is the classic "remixed project without explicit grants" state.

## Fix

Single migration that grants the standard Data-API privileges to each table based on its policy shape:

- **All 25 tables** → `GRANT SELECT, INSERT, UPDATE, DELETE ... TO authenticated` and `GRANT ALL ... TO service_role`.
- **`anon` SELECT** only on tables whose SELECT policies don't require `auth.uid()` (e.g. `profiles`, `hosted_games`, `reviews`, `review_helpfuls`, `player_availabilities` if publicly listable). I'll audit each policy and grant `anon` only where a policy legitimately permits it; auth-only tables (messages, notifications, payments, join_requests, user_roles, etc.) get no `anon` grant.

No RLS changes, no schema changes, no app code changes.

## Verification

After the migration:
1. Re-query `player_availabilities` as `authenticated` to confirm rows return.
2. Reload `/available-players` in the preview to confirm posts appear.
