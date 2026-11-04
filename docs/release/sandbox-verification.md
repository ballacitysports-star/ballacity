# Sandbox verification: steps for the project owner

Purpose: prove, from the Supabase and GitHub dashboards, that the E2E/rehearsal sandbox is a separate non-production project, and only then let the repository's E2E guard run against it. Nothing in this file changes production. **Never paste a key, token, password or full connection string into a chat, an issue or a pull request.** Where a value is needed, send only the project reference (20 lowercase letters) or a yes/no.

Production reference (for comparison): `cpqihhcqeivbgxqbzatv`. Candidate named in `supabase/config.e2e.toml` and designated in `e2e/safety/target-guard.ts`: `qkukefvzwlyusvspablz`, the Supabase project `ballacity-staging` (**isolation not yet verified**; a repository file is not proof of identity). It replaces `olrbulvwexrkjcxddjxq`, which was never verified and is no longer accepted. The Lovable project `ballacity-staging` reports that its database is not managed by Lovable, so it cannot be inspected from the tools used here; check it in step 1. When every step passes, record the result in `VERIFIED_E2E_SANDBOX_ISOLATION` (`e2e/safety/sandbox-isolation.ts`); until then the E2E guard refuses the project and no fixture is written.

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
