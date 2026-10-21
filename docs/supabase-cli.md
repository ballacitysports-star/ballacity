# Supabase CLI configuration

Two Supabase projects appear in this repository. They are not interchangeable.

| Purpose                         | Project ref            | Where it is configured                      |
| ------------------------------- | ---------------------- | ------------------------------------------- |
| Default / canonical (app + CLI) | `cpqihhcqeivbgxqbzatv` | `supabase/config.toml`, `.env.production`   |
| E2E / test sandbox (optional)   | `olrbulvwexrkjcxddjxq` | `supabase/config.e2e.toml` (reference only) |

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

## Using the E2E project from the CLI

The Supabase CLI has no flag for an alternate config file, so
`supabase/config.e2e.toml` is a documented reference rather than something the
CLI loads. To point the CLI at the test sandbox, link it explicitly and link
back afterwards:

```sh
supabase link --project-ref olrbulvwexrkjcxddjxq   # test sandbox
supabase link --project-ref cpqihhcqeivbgxqbzatv   # back to default
```

Never commit a change to `supabase/config.toml` that switches the default away
from `cpqihhcqeivbgxqbzatv`.

## Credentials

No keys, tokens, service-role keys or database passwords live in this
repository. Project refs are public identifiers, not secrets. All keys come from
the environment (`.env.production` is generated and holds only publishable
values) or from GitHub repository secrets.
