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
| Review is requested from the owner for workflows, the Playwright config, E2E global setup, `e2e/safety/` and `supabase/config*.toml`                                                                                                                                                                                                                                                                                                                                            | `.github/CODEOWNERS`                   |

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

The preflight runs in CI and is independent of the Playwright guard in
`e2e/safety/**` (a separate pull request). It does not rely on that pull request
being merged, and that guard does not rely on this one. If the guard's sandbox
allowlist and your `E2E_SANDBOX_PROJECT_REF` name different projects, the run is
refused by whichever check sees the mismatch.

## Validation contract and credential scope

The preflight (`.github/e2e-preflight.mjs`, logic in `e2e-preflight-lib.mjs`) always runs
its checks when invoked; there is no "am I the entrypoint" test. Any failure, unknown
argument or unexpected error exits nonzero. It reads the repository files that name
production relative to its own location, so it does not depend on the working directory
or on spaces in the path. It prints check names only.

| Mode          | Used by                    | Requires                                                                                                               | Refuses                                                                                                         |
| ------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| _(none)_ gate | first step, before install | all five `E2E_*` inputs                                                                                                | missing, malformed, inconsistent or production target; wrong key role; same key twice; non-local `E2E_BASE_URL` |
| `--runtime`   | build                      | the `E2E_*` inputs except the service key, plus `SUPABASE_*` and `VITE_SUPABASE_*` URL, project id and publishable key | any of those six differing from the validated `E2E_*` value; the service key under any name                     |
| `--service`   | dev server, Playwright     | as `--runtime` plus `SUPABASE_SERVICE_ROLE_KEY`, equal to the validated one                                            | a differing service key; the service key in any `VITE_*` variable                                               |

Each step that receives credentials runs the preflight on those very values first, so the
validated values are the values the process gets. Nothing is set at job level.

| Step                                      | Browser-facing values | Service role key                                                                                                        |
| ----------------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Verify E2E target                         | `E2E_*`               | yes (first-party script, before install)                                                                                |
| Install dependencies, Playwright browsers | no                    | **no**                                                                                                                  |
| Build (dev mode)                          | yes                   | **no**                                                                                                                  |
| Start dev server                          | yes                   | yes: the app's server functions build an admin client from it                                                           |
| Run Playwright tests                      | yes                   | yes: `e2e/global-setup.ts` seeds fixtures with it, then deletes it from `process.env` so spec workers do not inherit it |
| Summarise, Stop, Upload                   | no                    | **no**                                                                                                                  |

Limits, stated plainly:

- A readable JWT exposes the project it was issued for, and that is checked. `sb_*` style
  keys expose nothing, so for them only equality with the validated value is checked.
  Neither proves the remote project is isolated from production; the owner verifies that
  in the Supabase dashboard.
- The dev server and the Playwright process still hold the service role key while
  running. The dev server needs it for the app's server functions. Seeding could be moved
  to its own earlier step so the Playwright process never holds it, but `global-setup.ts`
  also signs the player in and hands that session to the workers, and #230 rewrites the
  same file. Splitting it is a follow-up to do after #230 lands: extract the seeding half
  into `e2e/seed-fixtures.ts`, run it as a step with the key, and leave sign-in (publishable
  key only) in global setup. Until then the key is removed from `process.env` right after
  global setup reads it, so spec workers and their children do not inherit it.
- **Production-seeded variables.** `vite.config.ts` fills every variable that is unset or
  empty from `.env.production`, which also holds a live Stripe publishable key
  (`VITE_PAYMENTS_CLIENT_TOKEN`). In `--runtime`/`--service` the preflight now requires each
  such variable to be set to something other than the production value, and refuses any
  `pk_live_`/`sk_live_`/`rk_live_` value under any name. The workflow sets
  `VITE_PAYMENTS_CLIENT_TOKEN: e2e-payments-disabled`, which is not a `pk_*` key, so the
  build reads as payments-not-configured and never loads Stripe. Specs that need a
  configured checkout would have to mock it; no remote run was made to check this.
- **Session tokens in artifacts.** The fixture user's session is injected into the
  browser, so traces and screenshots can carry it. Playwright runs with `--trace=off`,
  `test-results/` is never uploaded, and the only artifact is
  `ci-sanitized/results.json`, a _separate_ file written by
  `ci-redact.mjs --in playwright-report/results.json --out ci-sanitized/results.json`.
  The input and the redacted output must both be valid JSON. On any failure the tool
  removes the output, prints one fixed line (never the error or any content) and exits 1.
  The step sets `sanitized=true` only after the redactor exits 0, and the upload runs only
  when that output is `true` and uploads exactly that one file, so a failure blocks the
  upload even if no file could be removed or overwritten. Retention is 3 days. Cost:
  failure screenshots and traces are not available from CI.
- **Dev-server log.** A failed start prints only the last 60 lines of the log through
  `ci-redact.mjs --tail`, lines capped at 300 characters. On any redactor error it prints a
  fixed notice, never the raw log.
- **What the redactor covers.** Exact values of credential-named and `E2E_*`/`SUPABASE_*`/
  `VITE_*` variables, raw and in up to three layers of JSON escaping (embedded quotes,
  newlines, tabs, backslashes, escaped slashes); `user:password@` in any `scheme://` URL
  (scheme and host kept); JWTs; `sb_secret_`/`sb_publishable_` and Stripe-style keys;
  bearer/basic credentials; whole cookie headers; and the values of fields named
  `access_token`, `refresh_token`, `id_token`, `password`, `secret`, `token`, `api_key`,
  `authorization` and similar, at any depth of escaping, including unicode-escaped values.
- **What it cannot reliably catch.** This is pattern matching, not a guarantee. Not
  detected: an opaque value with no recognizable format that is not a known environment
  value and is not next to a credential-looking field name; a field _name_ that is itself
  escaped; a secret split across lines or fields; base64-, URL- or otherwise re-encoded
  secrets; and tokens minted at run time. The last is deliberate residual risk: the
  fixture user's session tokens are created inside the Playwright process by global setup.
  Handing them (or the service role key) to the redaction step would widen secret scope for
  convenience, so the report step receives **no** secrets and relies on structure and
  shape. JWT-format tokens are still caught by shape; an opaque refresh token is caught only
  next to its field name.
- A job skipped by its `if:` reports as skipped, and a skipped required check is treated
  as passing by branch protection. Do not rely on this job as a required check without
  accepting that.
- Third-party actions (`actions/checkout@v4`, `oven-sh/setup-bun@v2`,
  `actions/upload-artifact@v4`) are pinned to tags, not commit SHAs, and `bun-version` is
  `latest`. Pinning is recommended as a separate minimal change.

## BLOCKER for the PR #230 integration: the payments placeholder

> **Do not merge this branch with #230, or run E2E from #230 alone, until the dev-server
> launcher passes the payments placeholder.** #230's `e2e/safety/dev-server.ts` builds the
> server's environment from an allowlist (`PASS_THROUGH_VARS`) plus the variables it sets
> explicitly. `VITE_PAYMENTS_CLIENT_TOKEN` is in neither. A child process without it makes
> `vite.config.ts` fill it from `.env.production`, which holds a **live Stripe publishable
> key**, so the E2E server and bundle would run against the live billing partition.

Required change in `e2e/safety/dev-server.ts` (not made here; #230's branch is untouched):

1. Set `VITE_PAYMENTS_CLIENT_TOKEN=e2e-payments-disabled` explicitly in the child
   environment, and add it to the list of variables that must be non-empty before startup.
2. Validate it before the server starts: refuse an unset or empty value, refuse the value
   in `.env.production`, and refuse any value containing a `pk_live_`/`sk_live_`/`rk_live_`
   key (case-insensitive, anywhere in the string), without printing it.
3. Do not take it from the parent environment unchecked.

Local tests required after the integration (none of them needs a network or real keys):

- The actual child environment returned by `buildDevServerSpec` contains
  `VITE_PAYMENTS_CLIENT_TOKEN=e2e-payments-disabled`, and contains no live payments key
  under any name.
- With a fake `.env.production` in a temp dir, a launched server (the fake-server technique
  from #230's integration test) reports the placeholder, never the file's value.
- The launcher refuses to start when the variable is unset, empty, equal to the production
  value, or live-shaped.
- The existing "every reader of Supabase variables in `src/` is listed" test is extended
  with an equivalent for payments variables.
- Re-run `src/lib/e2e-preflight.test.ts` and `src/lib/ci-redact.test.ts`.
- A synthetic Playwright run shows the service key is visible to the guard and the dev
  server but not to spec workers or their children (`e2e/global-setup.ts` deletes it only
  _after_ the guard has read it).
- Dev-server output under #230 is produced by Playwright's `webServer`, so the redacted
  tail step above disappears with the separate dev-server step; pipe or filter that output
  through `ci-redact.mjs` or accept it unredacted.

## Redactor findings B1 to B5 and the tests that cover them

All tests are in `src/lib/ci-redact.test.ts` (redactor lib and CLI) and
`src/lib/e2e-preflight.test.ts` (workflow assertions and preflight). They use synthetic
values only and run the real CLI from paths containing spaces.

| Finding                             | Fix                                                                                                                  | Covered by                                                                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1 URL credentials                  | `user:password@` removed from any `scheme://` URL; scheme and host kept                                              | "URL credentials": http(s), postgres, redis, percent-encoded, user-only, `@` inside a password, several URLs in one string, malformed URLs, no damage to surrounding JSON (escaped or not)                                                                                              |
| B2 JSON-encoded secrets             | values of credential-named fields redacted with any number of backslashes before the quotes; unicode escapes handled | "JSON-encoded secrets": the audit's exact escaped `access_token`/`password` failure, 1 to 3 escape layers, nested objects and arrays, unicode escapes, a 2 MB value in linear time, stringified session JSON, unrelated fields such as `token_type` left alone, output still valid JSON |
| B3 exact values for the report step | none passed on purpose: the report step receives no secrets                                                          | workflow assertion that the step has no `env:` secrets; residual risk below                                                                                                                                                                                                             |
| B4 escaped multiline secrets        | exact values also matched in up to 3 layers of JSON escaping, slash-escaped, and per long line                       | "multiline secret does not survive 0 to 3 layers", embedded-in-JSON, slash-escaped                                                                                                                                                                                                      |
| B5 fail-closed artifacts            | sanitize into a separate file; upload gated on a success flag; exact upload path                                     | CLI: missing input, malformed JSON, stale output removed, `--in` equal to `--out` refused, unwritable output; workflow: step order, flag set only after the redactor, no `\|\| true`/`continue-on-error`, exact path, nothing downstream reads the raw report                           |

### Exact-value versus pattern-based protection

- **Exact value** (strong, but only for values the process actually has): the dev-server
  log step, whose environment holds the Supabase values and the service role key. Matched
  raw and in up to three layers of JSON escaping.
- **Pattern based** (a safety net, not a guarantee): the report step, which receives no
  secrets. It relies on URL credentials, JWT/`sb_*`/Stripe-style shapes, bearer and basic
  credentials, cookie headers, and values next to credential-named fields.

### Residual risk when sanitizing reports, logs and escaped content

- An opaque value with no recognizable format that is not next to a credential-looking
  field name is not detected. A field name that is itself escaped is not detected. Secrets
  split across lines or fields, and re-encoded (base64, URL-encoded) secrets, are not
  detected.
- Run-time tokens minted by global setup are not available to the report step. JWT-format
  ones are caught by shape; an opaque one only next to its field name.
- Malformed or non-JSON reports are not repaired: the report step fails and nothing is
  uploaded. Redacted output that is not valid JSON is also treated as failure. Playwright's
  own stdout is not redacted by this step.
- Redaction of a log keeps only its last lines, each capped at 300 characters, which also
  limits what can leak but loses context.

## Verification status

Verified locally with synthetic data: the preflight and redactor behavior and the
workflow's static structure (the tests above), type checking, lint, formatting and YAML
parsing, and a synthetic Playwright run showing that `--trace=off` suppresses traces and
that a variable deleted in a global-setup module is not seen by workers or their children.

**Not verified:** any GitHub Actions run (the runners have never allocated on this
repository); the `e2e-sandbox` Environment, secrets and variable; the contents of a real
artifact, trace or log; behavior of a real built bundle under the placeholder token; the
interaction with #230's guard and launcher; and the isolation of the E2E sandbox project
from production, which only the owner can establish in the Supabase dashboard. Nothing in
this document is a guarantee beyond what these tests support.
