# Sandbox verification: steps for the project owner

Purpose: prove, from the Supabase and GitHub dashboards, that the E2E/rehearsal sandbox is a separate non-production project, and only then let the repository's E2E guard run against it. Nothing in this file changes production. **Never paste a key, token, password or full connection string into a chat, an issue or a pull request.** Where a value is needed, send only the project reference (20 lowercase letters) or a yes/no.

Production reference (for comparison): `cpqihhcqeivbgxqbzatv`. Designated sandbox, named in `supabase/config.e2e.toml` and the guard allowlist: `qkukefvzwlyusvspablz`, the Supabase project behind the Lovable project `ballacity-staging` (read from that project's `supabase/config.toml`). A repository file is not proof of isolation; confirm it in step 1.

## 1. Identify and confirm the project

1. Supabase dashboard, Organizations. Note which organization owns the candidate project and which owns `cpqihhcqeivbgxqbzatv`. You must be an owner of the sandbox one.
2. Candidate project, Settings, General: "Reference ID" is exactly the value you will use; the name says sandbox or staging; it is not the project that serves ballacity.com.
3. Lovable: open `ballacity-staging`, find which backend project it uses (project settings or the Cloud/backend panel). If it points at `cpqihhcqeivbgxqbzatv`, it is not a sandbox. Record the answer.
4. Settings, API: the Project URL host is `<reference>.supabase.co` and differs from production's.

## 2. Prove it is isolated

5. Table Editor: `profiles`, `games`/`hosted_games`, `guardian_links`, `payment_submissions`, `availability_contact_requests`: empty or clearly synthetic. Authentication, Users: only test accounts. Storage: no production media.
6. Authentication, URL Configuration: Site URL and redirect allow-list contain no `ballacity.com`. Edge Function secrets, Vault, Integrations: no live PayPal, email, SMS, push or Google keys (sandbox keys only, or none).
7. Database, Replication: no replication, foreign data wrapper or webhook that points at production.
8. Negative key check, done by you privately: with the **sandbox** publishable key, request `https://cpqihhcqeivbgxqbzatv.supabase.co/auth/v1/health`. It must be refused (401). Never run it with a production key.
9. Database, Backups: note whether point-in-time recovery is on (the sandbox should not hold real data, so a short window is fine).

## 3. Load the schema (synthetic data only)

10. The sandbox must be rebuilt from the repository, not restored from production: apply every file in `supabase/migrations` and `drizzle/migrations` in timestamp order (a Drizzle entry's time is its `when` in `meta/_journal.json`; at the same instant ours first). `scripts/db-test.mjs` documents the order. If the sandbox already has objects, reset it first (your decision; it is not production).
11. Do not apply the files under `docs/migration-evidence/original-sources/` or any file that is not in those two folders.
12. Create synthetic accounts (disposable emails): adult host; adult guardian with a verified link to a managed under-13 child; 13-15 teen; 16-17 teen; adult organization admin; adult team manager; unrelated adult; unrelated teen; moderator; administrator. Add games: youth (8-12), no age limit, 21+, paid youth, legacy youth.

## 4. Configure GitHub (you do this; nothing else may)

13. Settings, Environments, `e2e-sandbox`: add the four `E2E_*` secrets from the sandbox (URL, publishable key, project id, service-role key) as **Environment** secrets; add required reviewers; delete any repository-level `E2E_*` secrets.
14. **Last**, add the Environment variable `E2E_SANDBOX_PROJECT_REF` = the verified reference. The preflight (`.github/e2e-preflight.mjs`) refuses to run unless the variable, the URL host, the project id and any readable key claim agree and none is a production reference.
15. Do not make `Playwright` a required check until it passes repeatedly against the verified sandbox.

## 5. What to send back

- Both organization names and whether they differ.
- The sandbox reference ID (not the keys).
- What Lovable's `ballacity-staging` uses.
- Whether the sandbox started empty, and whether the negative key check was refused.
- "Sandbox verified" in writing.

## 6. What happens next (still no production change)

Rehearsal on the sandbox only, in the order of `docs/release/youth-privacy-release-runbook.md` section 15: migrations in order, real Auth/RLS/Realtime/Storage checks, Playwright, mobile and desktop visual QA of PRIV-2C and PRIV-2D, coarsening ON, recovery drills.

## 7. Verification record (2026-11-14)

The owner worked through sections 1 to 4 on 2026-11-14 with Claude Code, and answered "yes" to every dashboard check below.
Counts and settings only; no keys or user data are recorded here.

| Item                                    | Result                                                                                                                                                                                                                                                                                                                                                  | How it was checked                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1-4. Project and owner                  | `qkukefvzwlyusvspablz`, named `ballacity-staging`, in the owner's own Supabase account; production `cpqihhcqeivbgxqbzatv` is Lovable Cloud (managed by Lovable), so they are in different organizations                                                                                                                                                 | owner's dashboard screenshot; Lovable reports the sandbox database as "not managed by Lovable"            |
| 3. Lovable `ballacity-staging`          | its `supabase/config.toml` and `.env` name `qkukefvzwlyusvspablz`, not production                                                                                                                                                                                                                                                                       | read through Lovable's file tool                                                                          |
| 5. Data                                 | test accounts only; no real media; signed-out visitors see 0 games, 2 profiles (fixtures), and are refused availability posts                                                                                                                                                                                                                           | owner (Users, Storage); anonymous REST counts from the session                                            |
| 6. Auth and secrets                     | email sign-in only; no `ballacity.com` in Site URL or redirects; no live PayPal, Stripe, email, push, Twilio or Google keys                                                                                                                                                                                                                             | owner (dashboard); public auth settings read from the session                                             |
| 7. Replication                          | none                                                                                                                                                                                                                                                                                                                                                    | owner (dashboard)                                                                                         |
| 8. Negative key check                   | **401**: production refused the sandbox's publishable key                                                                                                                                                                                                                                                                                               | owner, from their own computer (the session's network cannot reach the production host)                   |
| 9. Backups                              | none (acceptable: synthetic data only)                                                                                                                                                                                                                                                                                                                  | owner's dashboard                                                                                         |
| 10. Schema                              | was current to `20261111180000`; the owner applied `20261112150000`, `20261113120000`, `20261114100000` and `20261114110000` in that order through the SQL Editor, each "Success". A read-only marker query (one object per migration from 2026-11-08, validated on a full replay = 18/18 and a pre-11-08 replay = 0/18) then returned 18 of 18 present | owner's screenshots; WP 1.0 functions answer 401/42501 (present, refused) instead of 404 from the session |
| 13-14. GitHub `e2e-sandbox` environment | the four `E2E_*` secrets are environment secrets; `E2E_SANDBOX_PROJECT_REF` is set; every CI run's preflight (gate, runtime, service) reports the target "consistent, designated and not production"                                                                                                                                                    | owner's settings screenshot; CI logs of #426 and #427                                                     |

**Sandbox verified** (owner, 2026-11-14).

Open items, none blocking:

- The SQL Editor does not write `supabase_migrations.schema_migrations`, so the dashboard still shows "Last migration:
  lock_published_team_waivers". Before anyone uses `supabase db push` or the dashboard's GitHub deploy against this project,
  record the four versions in that table, or those tools will try to apply them again (and fail on objects that exist).
- Compute is **Nano**, the size that went unhealthy under the E2E suite's load on 2026-11-12 (batch 6). A larger size is
  the owner's call.
- A required reviewer on `e2e-sandbox` was being set up; once saved, every E2E run waits for an approval click.
