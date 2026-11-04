# Supabase CLI configuration

Two Supabase projects appear in this repository. They are not interchangeable.

| Purpose                         | Project ref            | Where it is configured                                                                                            |
| ------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Default / canonical (app + CLI) | `cpqihhcqeivbgxqbzatv` | `supabase/config.toml`, `.env.production`                                                                         |
| E2E / test sandbox (optional)   | `qkukefvzwlyusvspablz` | `supabase/config.e2e.toml` (reference only); Supabase project `ballacity-staging`; isolation **not yet verified** |

## Normal contributor commands

`supabase/config.toml` holds `project_id = "cpqihhcqeivbgxqbzatv"`, so plain CLI
commands target the canonical project that serves ballacity.com and the Lovable
previews:

```sh
supabase link --project-ref cpqihhcqeivbgxqbzatv   # once
supabase migration list
supabase db pull
```

Schema changes for this project are applied to production through Lovable's
agent. Never apply migrations to the canonical project by hand without
agreement — it is production. See "How migrations reach production" below.

## How migrations reach production

There are two migration histories, and neither copy should be deleted:

| Folder                 | What it is                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/` | The canonical chain: the replay tests read it and it is the only one that rebuilds a fresh database fully.                   |
| `drizzle/migrations/`  | What Lovable's current tool applied (SQL, a journal and snapshots). Production records it in `drizzle.__drizzle_migrations`. |

Production's `supabase_migrations.schema_migrations` stopped growing at
`20260926155719`; later migrations are tracked only in
`drizzle.__drizzle_migrations`. So:

- Do not use `supabase db push`: the CLI can try to replay history the database
  has already moved past.
- Write the migration under `supabase/migrations/`, written to be safe to run
  twice, then ask Lovable to apply the exact SQL unchanged and make no code
  changes.
- Lovable's tool may or may not sync its own `drizzle/migrations/` copy back to
  the repository. The copy lagging production is expected and harmless; treat
  the files in that folder as tool-owned and do not hand-edit them.
- After Lovable reports success, check production rather than trusting the
  report (below).

### Verifying what was applied

Drizzle stores the SHA-256 of the migration's SQL text in
`drizzle.__drizzle_migrations.hash`, so the exact text that was sent to Lovable
can be compared byte for byte with what production ran. Hash the text you sent,
not necessarily the repository file: if you left the comment header out when
pasting it to Lovable, the file's hash will not match.

```sh
sha256sum sent.sql                                # the exact text given to Lovable
```

```sql
select id, to_timestamp(created_at / 1000.0) at time zone 'utc' as applied_at_utc, hash
  from drizzle.__drizzle_migrations order by id desc limit 3;
```

The hashes are equal only when the SQL was applied exactly as given, including
the trailing newline. Then run read-only checks on the objects the migration
touches, such as `pg_policies` and `pg_proc.prosrc`.

Checked this way on 2026-10-20: `20261020120000_hide_posts_and_comments.sql` was
applied as drizzle entry 22 (2026-10-20 11:30:48 UTC) and its hash equals the
SHA-256 of the SQL block sent to Lovable. Lovable did not add a matching file,
journal entry or snapshot to `drizzle/migrations/` for it.

## E2E tests

The Playwright suite does **not** read `supabase/config.toml` and does not use
the Supabase CLI. `.github/workflows/e2e.yml` and `e2e/global-setup.ts` take
their target project entirely from environment variables / repository secrets:

- `E2E_SUPABASE_URL`
- `E2E_SUPABASE_PROJECT_ID`
- `E2E_SUPABASE_PUBLISHABLE_KEY`
- `E2E_SUPABASE_SERVICE_ROLE_KEY` (optional; lets global setup seed fixtures)

Run the suite locally with those values exported as `SUPABASE_*` /
`VITE_SUPABASE_*` (see `.env.example`):

```sh
bun run test:e2e
```

## E2E sandbox isolation

`qkukefvzwlyusvspablz` (Supabase project `ballacity-staging`) is the designated E2E sandbox. It replaces
`olrbulvwexrkjcxddjxq`, which was never verified and is no longer accepted. Designation is not enough: the
suite seeds fixture accounts and rows with the service-role key, so `e2e/safety/target-guard.ts` refuses
a remote target until the owner has recorded its isolation in `VERIFIED_E2E_SANDBOX_ISOLATION`
(`e2e/safety/sandbox-isolation.ts`). That record ships empty. Production `cpqihhcqeivbgxqbzatv` is refused
whatever the records say, and a record that names production or a project that is not designated stops
every run.

What the GitHub preflight proves, and what it does not: `.github/e2e-preflight.mjs` confirms that the
`E2E_*` secrets agree with each other and with the `E2E_SANDBOX_PROJECT_REF` variable, and that none names
production. It cannot see the dashboard, so it does not prove isolation.

The owner verifies, in the Supabase and GitHub dashboards (`docs/release/sandbox-verification.md`):

1. `qkukefvzwlyusvspablz` is the `ballacity-staging` project, owned by an account or organization the owner
   controls, and is not the project that serves ballacity.com.
2. It holds no production data (synthetic rows only), and has no replication, foreign data wrapper, webhook,
   Edge Function secret or auth redirect that points at production or ballacity.com.
3. The `e2e-sandbox` Environment's `E2E_SUPABASE_URL`, `E2E_SUPABASE_PROJECT_ID`, publishable key and
   service-role key were copied from this project's API settings, and `E2E_SANDBOX_PROJECT_REF` is
   `qkukefvzwlyusvspablz`. The keys are refused by production (a public read returns 401).
4. Recommended before recording: add required reviewers to the `e2e-sandbox` Environment, so that no run
   writes fixtures without an approval.

Then add one entry to `VERIFIED_E2E_SANDBOX_ISOLATION` in a reviewed commit: `verified_by`, `verified_on`
(YYYY-MM-DD) and `evidence` (where the written record lives; never a key or a connection string). Remove the
entry to revoke it.

## Using the E2E project from the CLI

The Supabase CLI has no flag for an alternate config file, so
`supabase/config.e2e.toml` is a documented reference rather than something the
CLI loads. To point the CLI at the test sandbox, link it explicitly and link
back afterwards:

```sh
supabase link --project-ref qkukefvzwlyusvspablz   # test sandbox
supabase link --project-ref cpqihhcqeivbgxqbzatv   # back to default
```

Never commit a change to `supabase/config.toml` that switches the default away
from `cpqihhcqeivbgxqbzatv`.

## Credentials

No keys, tokens, service-role keys or database passwords live in this
repository. Project refs are public identifiers, not secrets. All keys come from
the environment (`.env.production` is generated and holds only publishable
values) or from GitHub repository secrets.
