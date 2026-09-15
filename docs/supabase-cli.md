# Supabase CLI configuration

Two Supabase projects appear in this repository. They are not interchangeable.

| Purpose                         | Project ref            | Where it is configured                        |
| ------------------------------- | ---------------------- | --------------------------------------------- |
| Default / canonical (app + CLI) | `cpqihhcqeivbgxqbzatv` | `supabase/config.toml`, `.env.production`     |
| E2E / test sandbox (optional)   | `olrbulvwexrkjcxddjxq` | `supabase/config.e2e.toml` (reference only)   |

## Normal contributor commands

`supabase/config.toml` holds `project_id = "cpqihhcqeivbgxqbzatv"`, so plain CLI
commands target the canonical project that serves ballacity.com and the Lovable
previews:

```sh
supabase link --project-ref cpqihhcqeivbgxqbzatv   # once
supabase migration list
supabase db pull
```

Schema changes for this project are normally made through Lovable, which writes
the migration files under `supabase/migrations/`. Never apply migrations to the
canonical project by hand without agreement — it is production.

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
