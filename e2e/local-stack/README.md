# Local Supabase stack for E2E

Runs the Playwright suite against a throwaway Supabase backend in Docker on your machine,
instead of the shared E2E sandbox project. Nothing here contacts a hosted project.

```sh
node e2e/local-stack/stack.mjs up          # ~35s: fresh database, all migrations, services
set -a; . e2e/local-stack/.state/env.sh; set +a
bunx playwright test --trace=off --workers=1          # or a subset, e.g. the smoke set below
node e2e/local-stack/stack.mjs down        # stop everything and delete the database
```

Smoke set only (as CI judges it):

```sh
node -e 'const s=require("./e2e/smoke-set.json");console.log([...new Set(s.tests.map(t=>"e2e/"+t.file))].join(" "))' \
  | xargs bunx playwright test --trace=off --workers=1 --reporter=list,json
# with PLAYWRIGHT_JSON_OUTPUT_NAME=results.json set, then:
node .github/e2e-smoke-gate.mjs results.json e2e/smoke-set.json
```

Needs Docker (with Compose v2), `psql` and Node 22 on the host. Stop any dev server on port 8080
first: Playwright starts its own (see `e2e/safety/dev-server.ts`).

## What runs

| Service  | Image                          | Port (127.0.0.1 only) | Notes                                       |
| -------- | ------------------------------ | --------------------- | ------------------------------------------- |
| gateway  | `gateway.mjs` on the host      | 54321                 | the `SUPABASE_URL` the app and suite use    |
| Postgres | `supabase/postgres:17.6.1.003` | 54322                 | real auth/storage schemas and API roles     |
| Auth     | `supabase/gotrue:v2.180.0`     | 54331                 | email sign-up autoconfirmed, no mail sent   |
| REST     | `postgrest/postgrest:v13.0.7`  | 54332                 |                                             |
| Realtime | `supabase/realtime:v2.51.11`   | 54333                 | optional: skipped if the image is not local |
| Storage  | `supabase/storage-api:v1.28.0` | 54334                 | required: files live inside the container   |

`up` brings them up in the order the schema needs: Postgres, then Auth (it migrates `auth`),
Realtime (creates `realtime.messages`) and Storage (migrates `storage`), then the repository's
migrations, then PostgREST and the gateway.

The migrations are applied the way the CI replay applies them (`scripts/db-test.mjs`): every file
in `supabase/migrations` and `drizzle/migrations`, in `scripts/migration-order.mjs` order, known
twins skipped, each in one transaction, as the `postgres` role. The platform stub
`supabase/tests/support/supabase-stub.sql` is not loaded: the services provide the real schemas.

`gateway.mjs` stands in for Supabase's Kong: it routes `/auth/v1`, `/rest/v1`, `/realtime/v1`
(HTTP and WebSocket) and `/storage/v1`, refuses requests without the anon or service-role key
(except the auth redirect endpoints and storage, as Kong does), copies the key into
`Authorization` when the client sent none, and answers CORS.

Without the Realtime image, `up` creates a plain `realtime.messages` table so the migrations'
policies apply, and the realtime specs fail. Without the Storage image `up` stops: the migrations
create buckets with columns only Storage's own migrations add.

## Secrets

`up` generates a new JWT secret, database password and Realtime keys on every run, mints the
`anon` and `service_role` keys from that secret, and writes them to `e2e/local-stack/.state/`
(git-ignored, mode 600). They are valid only for that run's containers, which publish ports on
127.0.0.1 only, and `down` deletes them. Nothing secret is committed.

The keys carry no project `ref` claim, and the project label is `127`, so the E2E target guard
(`e2e/safety/target-guard.ts`) classifies the run as **local**: both Supabase URLs must be
loopback, and a session injected by global setup is accepted only when its issuer is a loopback
URL and the target is local. A remote or production target is refused exactly as before.

`127` is the label because supabase-js stores the session under `sb-<first label of the API
host>-auth-token`, i.e. `sb-127-auth-token`, and global setup injects it under
`sb-<SUPABASE_PROJECT_ID>-auth-token`.

## Fixture data

Global setup seeds the fixture accounts and the `g1`/`g2` games whenever
`SUPABASE_SERVICE_ROLE_KEY` is set, which `env.sh` does. It also records each fixture account's
acceptance of the current Terms and Privacy versions: on a fresh database they have none, and the
legal re-accept dialog would otherwise cover every signed-in page. Each `up` starts from an empty
database, so a run never inherits another run's rows.
