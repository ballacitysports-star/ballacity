# Moving ballaCity to the org-owned Supabase project

This is the runbook for finishing the migration a previous session started and
reverted (see `git log -- .env.production supabase/config.toml` around
2026-09-09). It moves ballaCity off the Lovable-managed project
(`cpqihhcqeivbgxqbzatv` — current production, referenced by `.env.production`
and the Lovable backend binding) onto the org-owned project
(`olrbulvwexrkjcxddjxq` — already the CLI link target in
`supabase/config.toml`, but empty as of the last check).

**Nothing here has been run.** Every script below needs credentials that do
not exist anywhere in this repo or its environments — you have to supply
them. Nothing touches production until the very last step, and that step is
a manual edit you run yourself after verifying parity.

## Why this is four steps, not one

Supabase splits cleanly into three things that each move differently, plus a
provider-config step nothing here can automate:

1. **Schema** — fully described by the 277 files in `supabase/migrations/`.
   No source access needed at all; just apply them to the destination in
   order, the same way `supabase db push` would.
2. **Data** — table rows in `public.*`, plus `auth.users` and
   `auth.identities` (ballaCity has real Google/Apple/Microsoft sign-in via
   `@lovable.dev/cloud-auth-js`, which is a client wrapper around standard
   Supabase Auth — the Lovable manifest's OAuth issuer is literally
   `https://cpqihhcqeivbgxqbzatv.supabase.co/auth/v1`. Skip `auth.identities`
   and every social-login user is locked out).
3. **Storage** — the 13 buckets declared in
   `supabase/migrations/20260909220000_declare_storage_buckets.sql` and
   `20260912180000_app_assets_bucket.sql`. Files live in a blob store, not the
   database — `storage.objects` rows are metadata that must be recreated by
   actually uploading through the Storage API, not copied via SQL, or you get
   rows pointing at bytes that don't exist on the new project.
4. **OAuth provider config** — Google/Apple/Microsoft client IDs, secrets,
   and redirect URLs live in the Supabase Dashboard (Authentication →
   Providers), not in this repo. **No script can do this.** If it isn't
   redone on the destination project before cutover, every social-login user
   fails to sign in even though their `auth.identities` row copied fine.

## What you need to supply

None of this exists in the Claude Code environment — no Supabase CLI, no
`DATABASE_URL`/`SUPABASE_*` env vars, no service-role keys. For each project,
get these from **Supabase Dashboard → Project Settings**:

| Variable | Where | Used by |
|---|---|---|
| `SOURCE_DATABASE_URL` | Settings → Database → Connection string → **URI**, "Use direct connection" (not the pooler — `pg_dump`/`pg_restore` need session-level features the transaction pooler doesn't support) | `copy-database.sh` |
| `SOURCE_SUPABASE_URL`, `SOURCE_SERVICE_ROLE_KEY` | Settings → API | `copy-storage.mjs`, `verify-parity.mjs` |
| `DEST_DATABASE_URL` | Same, direct connection, for `olrbulvwexrkjcxddjxq` | `apply-schema.sh`, `copy-database.sh` |
| `DEST_SUPABASE_URL`, `DEST_SERVICE_ROLE_KEY` | Settings → API, for `olrbulvwexrkjcxddjxq` | `copy-storage.mjs`, `verify-parity.mjs` |

The source project is Lovable-managed. If its service-role key/DB URL isn't
directly reachable from your Supabase account, Lovable's own database bridge
(`query_database` in the Lovable MCP tools) is a working alternative for the
data side — it executes SQL against the same database without needing the
raw key. It does not help with Storage, which needs the actual key.

Export whatever you're given as environment variables before running
anything below; none of these scripts accept credentials as arguments (shell
history and process lists would leak them).

## Order of operations

```bash
cd scripts/own-supabase-migration

# 1. Schema — safe to run repeatedly, tracks what it already applied.
DEST_DATABASE_URL=postgresql://... ./apply-schema.sh

# 2. Data — public schema tables + auth.users + auth.identities.
SOURCE_DATABASE_URL=postgresql://... DEST_DATABASE_URL=postgresql://... ./copy-database.sh

# 3. Storage — all 13 buckets, resumable (skips objects already at destination).
SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
DEST_SUPABASE_URL=... DEST_SERVICE_ROLE_KEY=... \
  node copy-storage.mjs

# 4. Verify — row counts per table, object counts + bytes per bucket.
#    Re-run until every row reads "match". Do not proceed on any mismatch
#    without understanding why (see "Known-safe mismatches" below).
SOURCE_DATABASE_URL=... DEST_DATABASE_URL=... \
SOURCE_SUPABASE_URL=... SOURCE_SERVICE_ROLE_KEY=... \
DEST_SUPABASE_URL=... DEST_SERVICE_ROLE_KEY=... \
  node verify-parity.mjs
```

Then, manually, in the Supabase Dashboard for `olrbulvwexrkjcxddjxq`:

5. **Authentication → Providers**: re-enter the Google/Apple/Microsoft
   client ID + secret, and add the destination project's callback URL to
   each provider's own console (Google Cloud Console, Apple Developer,
   Azure AD). Sign in with one test account per provider before cutover.
6. **Authentication → URL Configuration**: set Site URL and redirect URLs to
   match production's actual domain.

## The cutover itself (do this last, do it yourself)

Only after every row in step 4 says "match" and step 5/6 are done:

- Update `.env.production` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `VITE_SUPABASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_PROJECT_ID`) to the destination project's values.
- Update the Lovable backend binding — this is a Lovable project setting,
  not a file in this repo; do it in the Lovable editor
  (Settings → Integrations → Supabase, or wherever Lovable currently
  surfaces it).
- Rotate `SUPABASE_SERVICE_ROLE_KEY` wherever it's set as a deploy secret
  (this repo's server code reads it via `src/integrations/supabase/client.server.ts`).

This repo already broke production once by flipping `.env.production` before
the destination had a schema (commit `2908347`, reverted an hour later as
`894e827`). Don't repeat it: keep the two projects running in parallel,
confirmed green on step 4, before touching `.env.production`.

## Known-safe mismatches

- `auth.sessions`, `auth.refresh_tokens`, `auth.flow_state`,
  `auth.one_time_tokens`, `auth.mfa_*`, `auth.sso_*`, `auth.instances`,
  `auth.audit_log_entries`, `auth.schema_migrations` are deliberately **not**
  copied by `copy-database.sh` — they're either instance-specific, ephemeral,
  or GoTrue-internal bookkeeping. Users simply sign in again on the new
  project; that's expected, not a bug.
- Row counts for tables with a `created_at`/`updated_at` you're actively
  writing to in production will drift between when you dumped and when you
  verify — take a final delta pass (or a maintenance window) immediately
  before cutover if the app is still receiving writes during migration.
