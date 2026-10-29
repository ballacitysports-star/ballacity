# CI security: what the repository enforces and what the owner must configure

This describes the GitHub Actions setup as of this change. The right-hand column
says whether a thing is enforced by files in this repository or must be set by the
repository owner in GitHub. Nothing in the second group is configured by merging
this change, and none of it has been verified as configured.

## Enforced by files in the repository

| Control                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Where                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Every workflow has an explicit token scope: `contents: read`, or `{}` for the runner probe                                                                                                                                                                                                                                                                                                                                                                                      | `.github/workflows/*.yml`              |
| `preserve-artifact.yml` keeps `contents: write` and `actions: read`, which it needs to re-publish an artifact as a Release. It runs only on manual dispatch and is reviewed separately.                                                                                                                                                                                                                                                                                         | `preserve-artifact.yml`                |
| No workflow uses `pull_request_target` or `workflow_run`, so pull requests from forks never receive secrets                                                                                                                                                                                                                                                                                                                                                                     | all workflows                          |
| Only the E2E job references secrets (`E2E_SUPABASE_URL`, `E2E_SUPABASE_PUBLISHABLE_KEY`, `E2E_SUPABASE_PROJECT_ID`, `E2E_SUPABASE_SERVICE_ROLE_KEY`)                                                                                                                                                                                                                                                                                                                            | `e2e.yml`                              |
| The E2E job declares `environment: e2e-sandbox` and runs only for pushes to `main` and for same-repository, non-Dependabot pull requests                                                                                                                                                                                                                                                                                                                                        | `e2e.yml`                              |
| The first step of the E2E job (`.github/e2e-preflight.mjs`) refuses to continue unless all four `E2E_*` secrets and the `E2E_SANDBOX_PROJECT_REF` variable are present, name one project consistently (URL host, project id, designation, and any readable key claim), and that project is not a production reference. It prints check names only, never a value, and makes no network call. Without it, empty secrets fall through `vite.config.ts` to the production backend. | `.github/e2e-preflight.mjs`, `e2e.yml` |
| Review is requested from the owner for workflows, the Playwright config, E2E global setup, `e2e/safety/` and `supabase/config*.toml`, `vite.config.ts`, `.env.production`, `package.json` and `bun.lock`                                                                                                                                                                                                                                                                        | `.github/CODEOWNERS`                   |
| Every `actions/checkout` step sets `persist-credentials: false`, so the job token is not left in the workspace's git config for later steps, dependency install scripts or spec code. No workflow runs an authenticated git operation after checkout (a test checks this). The checkout step itself still authenticates its own fetch, including the full-history fetch the lint job needs.                                                                                     | `.github/workflows/*.yml`              |

A skipped E2E job is **not** a passing remote test. Nothing ran.

## Must be configured by the repository owner (not done by this change)

1. **Create the Environment `e2e-sandbox`** (Settings, Environments) and add required
   reviewers. Only after the sandbox project and the secret mapping have been
   independently verified in the Supabase dashboard:
   - add the four `E2E_*` secrets as **Environment** secrets, and
   - add the Environment **variable** `E2E_SANDBOX_PROJECT_REF` (not a secret) set to
     that project's reference. This is your explicit designation. The preflight
     requires it to match the URL and project id, so a run cannot start until you have
     made it. It does not prove the project is isolated; you do.
2. **Delete the repository-level `E2E_*` secrets** once the Environment copies exist.
   Environment scoping only protects secrets that live in the Environment. If
   repository-level copies remain, a pull request that removes `environment:` from
   `e2e.yml` can still read them. No file in this repository can prevent that; only
   removing them does. The preflight limits the damage (a run with a production or
   inconsistent target is refused) but not their exposure to such a workflow.
3. **Deployment branches:** probably leave unrestricted. For pull request runs GitHub
   evaluates `refs/pull/N/merge`, which a "protected branches only" rule may reject.
   Check this when configuring.
4. **Prevent self-review** on the Environment: with a single reviewer account, leaving
   it on means that account cannot approve its own run.
5. **Settings, Actions, General:** set "Require approval for all outside
   collaborators" for fork pull request workflows, and set default workflow
   permissions to read-only.
6. **Branch protection on `main`:** choose the required status checks. Enable "Require
   review from Code Owners" only when a second reviewer exists; with one account a
   code-owner review requirement blocks every change to the covered paths.
   CODEOWNERS only _requests_ review; it does not stop a contributor from approving or
   merging their own change to these paths. To make it enforce independent approval, the
   owner configures a branch protection rule or ruleset on `main` (not done by any file here):
   require a pull request before merging; require at least one approval; require review
   from Code Owners; dismiss stale approvals on new pushes; require approval of the most
   recent reviewable push, so the person who pushed cannot be the approver; and do not
   allow bypass. GitHub does not count a PR author's own approval, so with a single
   account these rules block every change to the covered paths. They need a second
   reviewer (a second account or a team). Until one exists, leave "Require review from
   Code Owners" off and treat CODEOWNERS as a notification. The Environment's "Prevent
   self-review" (item 4) is the matching control for the E2E job. The login in
   `.github/CODEOWNERS` is the repository owner's; if a team should own these paths
   instead, the owner replaces it there.
7. **Supabase GitHub integration:** confirm which project it targets and whether it
   deploys migrations on merge. A per-pull-request preview check has been seen
   reporting that preview branching is disabled.

## What approval does to checks

With required reviewers on `e2e-sandbox`, the E2E job pauses in "waiting" on every
same-repository pull request and every push to `main` until a reviewer approves. If
E2E is a required check, merges wait for that approval. Fork and Dependabot pull
requests skip the job. `Unit & Lint` and `Database tests` use no secrets and are
unaffected.

Approving a run executes that pull request's version of the guard
(`e2e/safety/**`, `playwright.config.ts`). Review those files, which CODEOWNERS
asks the owner to do, before approving.

## Events: what runs, skips or waits

| Event                             | `Unit & Lint`, `Database tests`                          | `E2E`                                                        |
| --------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Push to `main`                    | run                                                      | waits for Environment approval, then the preflight must pass |
| Pull request from this repository | run                                                      | waits for Environment approval, then the preflight must pass |
| Pull request from a fork          | run after outside-collaborator approval, with no secrets | skipped                                                      |
| Dependabot pull request           | run                                                      | skipped                                                      |
| Any other event                   | per workflow                                             | skipped                                                      |

A skipped E2E job is not a passing remote test. If E2E is a required status check,
the approval wait blocks merges until a reviewer approves.

## Relationship to the E2E target guard

Two independent checks stand in front of the sandbox, and both are in this change:
the CI preflight (`.github/e2e-preflight*.mjs`, which needs the owner's
`E2E_SANDBOX_PROJECT_REF`) and the Playwright guard (`e2e/safety/**`, which has its own
hardcoded sandbox allowlist and production block list). **Both must name the same
project.** If they differ, the run is refused by whichever sees the mismatch. Changing
the guard's allowlist is a code change that CODEOWNERS routes to the owner.

## Validation contract and credential scope

The preflight (`.github/e2e-preflight.mjs`, logic in `e2e-preflight-lib.mjs`) always runs
its checks when invoked; there is no "am I the entrypoint" test. Any failure, unknown
argument or unexpected error exits nonzero. It reads the repository files that name
production relative to its own location, so it does not depend on the working directory
or on spaces in the path. It prints check names only.

| Mode          | Used by         | Requires                                                                                                               | Refuses                                                                                                         |
| ------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| _(none)_ gate | first step      | all five `E2E_*` inputs                                                                                                | missing, malformed, inconsistent or production target; wrong key role; same key twice; non-local `E2E_BASE_URL` |
| `--runtime`   | build           | the `E2E_*` inputs except the service key, plus `SUPABASE_*` and `VITE_SUPABASE_*` URL, project id and publishable key | any of those six differing from the validated `E2E_*` value; the service key under any name                     |
| `--service`   | Playwright step | as `--runtime` plus `SUPABASE_SERVICE_ROLE_KEY`, equal to the validated one                                            | a differing service key; the service key in any `VITE_*` variable                                               |

In `--runtime` and `--service` the preflight also requires every variable that
`.env.production` would seed to be set to something else, and refuses a live
`pk_`/`sk_`/`rk_` key under any name (case-insensitive, anywhere in the value, never
printed). Each step that receives credentials runs the preflight on those very values
first, so the validated values are the values the process gets. Nothing is set at job
level except `E2E_BASE_URL` and the Chromium path.

### The job, step by step

The Playwright step starts the dev server itself (`webServer` in `playwright.config.ts`,
built by `e2e/safety/dev-server.ts`). There are no separate server start or stop steps:
the config refuses to reuse a running server.

| Step                                      | Browser-facing values | Payments placeholder | Service role key                                                                                       |
| ----------------------------------------- | --------------------- | -------------------- | ------------------------------------------------------------------------------------------------------ |
| Verify E2E target                         | `E2E_*`               | no                   | `E2E_` alias only (first-party script, before install)                                                 |
| Install dependencies, Playwright browsers | no                    | no                   | **no**                                                                                                 |
| Build (dev mode)                          | yes                   | yes                  | **no**                                                                                                 |
| Run Playwright tests                      | yes                   | yes                  | `SUPABASE_SERVICE_ROLE_KEY` (and the `E2E_` alias only until the preflight in the same script is done) |
| Redact report, Summarise, Upload          | no                    | no                   | **no**                                                                                                 |

### Where the service role key goes, and where it does not

1. **Preflight.** The Playwright step receives the key as both `SUPABASE_SERVICE_ROLE_KEY`
   and `E2E_SUPABASE_SERVICE_ROLE_KEY`; the preflight compares them. The script then runs
   `unset E2E_SUPABASE_SERVICE_ROLE_KEY` before Playwright starts, so the alias never
   reaches the Playwright process, a spec worker or a child process.
   Unsetting before the preflight would defeat the comparison.
2. **Guard.** `playwright.config.ts` runs the target guard at config load, and
   `e2e/global-setup.ts` runs it again as its first statement. Both see the key and check
   its claims.
3. **Dev server.** The launcher (`e2e/safety/start-dev-server.mjs`) takes the key from its
   own inherited environment, and only when the spec's `inheritServiceKey` flag is true.
   The key is **not** in `E2E_DEV_SERVER_SPEC` or anywhere else in Playwright's
   configuration: Playwright's JSON report writes `webServer.env` verbatim into
   `results.json`. The launcher and the global-setup check both refuse a spec that
   carries it. The Vite child gets an explicit, allowlisted environment.
4. **Fixture seeding.** `globalSetup` reads the key once, after the guard and the
   launched-server check, and then deletes it from `process.env`, so the workers
   Playwright starts next and their children do not inherit it. Deleting a variable does
   not erase copies already handed to child processes (the dev server and the launcher
   keep theirs) or any copy already in a serialized object, which is why the key is kept
   out of the spec in the first place.

### Payments

`vite.config.ts` fills every variable that is unset or empty from `.env.production`, which
also holds a live Stripe publishable key (`VITE_PAYMENTS_CLIENT_TOKEN`). Two processes need
the placeholder, and each gets `VITE_PAYMENTS_CLIENT_TOKEN: e2e-payments-disabled`:

- **The build step.** It is a verification gate and its output is not used by the server,
  but without the placeholder it would bake the live token into `dist`.
- **The dev server.** The launcher always sets the placeholder in the child, refuses any
  other parent value (a live key, a test key, an altered placeholder), and refuses to start
  if the spec lacks it or carries a live-shaped value. The global-setup check repeats that.

The placeholder is not a `pk_test_`/`pk_live_` key, so `src/lib/stripe.ts` reads it as
payments-not-configured: Stripe is never loaded and billing stays in the sandbox partition.
Specs that need a configured checkout would have to mock it; no remote run was made to
check this. Production payment code and `vite.config.ts` are unchanged.

### Logs and artifacts

- **Output.** Playwright's output, including the dev server's stderr that Playwright
  forwards, is piped through `ci-redact.mjs --stream` (`shell: bash`, so `pipefail`): the
  step fails if Playwright or the redactor fails, Playwright's exit status is preserved, and
  a redactor failure prints one fixed line and never the offending line. If the consumer of its output goes away (a closed pipe) or the output cannot be written, it prints one fixed line without a stack trace and exits 1. Exact values come
  from the step's own environment, which holds the key, so this is the one place exact-value
  redaction applies to secret-bearing logs.
- **Traces.** `--trace=off`. Traces record requests and DOM snapshots, and the fixture
  user's session is injected into the page.
- **Report.** The only artifact is `ci-sanitized/results.json`, a separate file written by
  `ci-redact.mjs --in playwright-report/results.json --out ci-sanitized/results.json`. Input
  and output must both be valid JSON. On any failure the tool removes the output, prints one
  fixed line and exits 1. The step sets `sanitized=true` only after the redactor exits 0, and
  the upload runs only when that output is `true` and uploads exactly that file with 3-day
  retention. The raw report, `test-results/` (screenshots, per-test files) and logs are
  never upload candidates. Failure screenshots and traces are not available from CI.
- **What is in the report.** `results.json` contains Playwright's serialized config,
  including `webServer.env.E2E_DEV_SERVER_SPEC`. That has the Supabase URL, project id and
  publishable key (not secrets) and, by design, no service role key and no live payments
  token. The report step receives no secrets.

### What the redactor covers, and what it cannot

- **Exact values** (strong, but only for values the process has): the Playwright output
  stream, whose step holds the key. Matched raw and in up to three layers of JSON
  escaping (embedded quotes, newlines, tabs, backslashes, escaped slashes), and per long
  line of a multiline value.
- **Patterns** (a safety net, not a guarantee): `user:password@` in any `scheme://` URL;
  JWTs; `sb_secret_`/`sb_publishable_` and Stripe-style keys; bearer/basic credentials;
  whole cookie headers; values of fields named like `access_token`, `refresh_token`,
  `id_token`, `password`, `secret`, `token`, `api_key`, `service_role_key`,
  `authorization`, at any depth of backslash escaping, including unicode-escaped values.
  The report step has no exact values, so it relies on these.
- **Not reliably caught:** an opaque value with no recognizable format that is neither a
  known environment value nor next to a credential-looking field name; a field _name_ that
  is itself escaped; secrets split across lines or fields; base64- or URL-re-encoded
  secrets; and tokens minted at run time. The fixture user's session tokens are created
  inside the Playwright process and are deliberately not handed to the report step (that
  would widen secret scope for convenience). JWT-form tokens are still caught by shape; an
  opaque refresh token only next to its field name.
- Malformed or non-JSON reports are not repaired: the report step fails and nothing is
  uploaded. Streams are redacted line by line, so a secret split across lines is not
  matched as a whole.

### Tests

`src/lib/e2e-dev-server.test.ts`, `e2e-dev-server.integration.test.ts` (real launcher, fake
Supabase, the real `.env.production` shown not to leak), `e2e-service-key.integration.test.ts`
(Playwright's real reporter path, opaque synthetic key, negative control),
`e2e-target-guard.test.ts`, `e2e-preflight.test.ts` (including the real Playwright-step
script run under `bash -eo pipefail` with a stub `bunx`, the alias probe and its negative
control, and static assertions on step order, upload path and absence of raw uploads) and
`ci-redact.test.ts`.

## Other limits, stated plainly

- A readable JWT exposes the project it was issued for, and that is checked. `sb_*` style
  keys expose nothing, so for them only equality with the validated value is checked.
  Neither proves the remote project is isolated from production; the owner verifies that
  in the Supabase dashboard.
- The dev server and the Playwright process hold the service role key while running. The
  dev server needs it for the app's server functions. Seeding could move to its own earlier
  step so the Playwright process never holds it, but `global-setup.ts` also signs the player
  in and hands that session to the workers. Splitting it is a follow-up: extract the seeding
  half into `e2e/seed-fixtures.ts`, run it as a step with the key, and leave sign-in
  (publishable key only) in global setup.
- A job skipped by its `if:` reports as skipped, and a skipped required check is treated as
  passing by branch protection. Do not rely on this job as a required check without
  accepting that.
- Third-party actions (`actions/checkout@v4`, `oven-sh/setup-bun@v2`,
  `actions/upload-artifact@v4`) are pinned to major-version tags, not commit SHAs, and
  `bun-version` is `latest`. The repository has no documented pinning convention, and no
  trustworthy tag-to-SHA mapping exists locally; a SHA invented or copied without checking
  it against the action's repository would be worse than a tag. Recommended as a separate,
  authorized change: resolve each tag to its commit in the action's own repository, pin
  those SHAs with a comment naming the tag, and set `bun-version` to the exact release that
  produced `bun.lock` (the repository records no Bun version: `package.json` has no
  `packageManager` or `engines`, and no `.bun-version` file exists). Until then a compromised
  or moved tag would run in these jobs. The E2E job exposes secrets only to steps that
  reference them, and none of the third-party action steps do.

## Verification status

Verified locally with synthetic data: the preflight, launcher and redactor behavior; the
Playwright step's real script under `bash -eo pipefail`; the report path through
Playwright's real JSON reporter; and the workflow's static structure.

**Not verified:** any GitHub Actions run (the runners have never allocated on this
repository); the `e2e-sandbox` Environment, secrets and variable; the contents of a real
artifact, trace or log; the behavior of a real built bundle under the placeholder; and the
isolation of the E2E sandbox project from production, which only the owner can establish in
the Supabase dashboard. Nothing in this document is a guarantee beyond what these tests
support.
