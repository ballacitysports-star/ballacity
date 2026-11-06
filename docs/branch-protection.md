# Branch protection for `main`: steps for the repository administrator

Nothing in this file is applied by the repository. It is done in the GitHub web interface by someone with admin rights.
Before changing anything, read what already exists in Settings > Rules and Settings > Branches and write it down.

## 0. Final administrator checklist (tick in order; do not skip the verification at the end)

Preconditions (all true on 2026-11-04, `main` = `04e4b6cc` or later):

- [ ] `Replay migrations and run SQL tests` has no path filter (merged in #254) and reported success on the push to `main`.
- [ ] `Unit tests`, `Lint` and `Typecheck & build` reported success on the same push.
- [ ] You have written down every rule and ruleset that already exists (Settings, Rules and Settings, Branches).
- [ ] You know which identity Lovable pushes as (Settings, Integrations): a GitHub App installation, or an authorization of your own account.

Create one ruleset on the default branch (Settings, Rules, Rulesets, New branch ruleset, name `main protection`; start in Evaluate mode if your plan offers it, then Active):

- [ ] **Require a pull request before merging.**
- [ ] **Required reviews:** while there is one account, 0 approvals but "Require conversation resolution" and "Dismiss stale approvals" on (GitHub does not count an author's own approval, so 1 would block every change). The day a second reviewer exists: 1 approval, "Require review from Code Owners", "Require approval of the most recent reviewable push".
- [ ] **Require status checks to pass:** `Unit tests`, `Lint`, `Typecheck & build`, `Replay migrations and run SQL tests` (source: GitHub Actions). Require branches to be up to date before merging.
- [ ] **Not required:** `Playwright`. It stays optional until the sandbox is verified, `E2E_SANDBOX_PROJECT_REF` is configured by you, and it has passed repeatedly; and the `e2e-sandbox` Environment has required reviewers.
- [ ] **Not required yet:** `E2E smoke` (P0-9, the 26-test smoke subset of the same run). Require it after three consecutive green runs; preconditions and costs are in `docs/e2e-smoke.md`.
- [ ] Restrict deletions; block force pushes; merge commits only while the stacked privacy branches exist.
- [ ] **Bypass list: empty.** No standing bypass for anyone, including you and Lovable (see section 2 for the operating procedure).
- [ ] Settings, General, "Automatically delete head branches": off until the privacy stack is merged.

Operating Lovable safely under the rule (details in section 2):

- [ ] Before enabling the rule, tell your team that Lovable edits that land directly on `main` will be rejected once it is Active.
- [ ] Test, outside any release window and with a trivial edit, whether Lovable can work on a non-default branch and open a pull request. If yes, that is the workflow from then on.
- [ ] If it cannot: pause Lovable's GitHub sync (or stop making edits in Lovable) during the privacy release; use a time-boxed bypass held by you only if an urgent app change cannot wait, and review every bypassed commit afterwards.
- [ ] Lovable applying a migration to the database is not governed by this rule at all. Treat "Applied <migration>" commits as a production change that needs its own approval.

Verify (do not skip):

- [ ] A documentation-only pull request shows all four required checks and none stays "Expected".
- [ ] A direct push to `main` is rejected.
- [ ] A pull request with a deliberately failing SQL assertion or broken migration cannot be merged.
- [ ] Settings, Rules, Insights shows the rule evaluated.

## 1. The four required checks

| Required check (exact job name)       | Workflow       | Source         |
| ------------------------------------- | -------------- | -------------- |
| `Unit tests`                          | Unit & Lint    | GitHub Actions |
| `Lint`                                | Unit & Lint    | GitHub Actions |
| `Typecheck & build`                   | Unit & Lint    | GitHub Actions |
| `Replay migrations and run SQL tests` | Database tests | GitHub Actions |

`Playwright` (workflow E2E) is **not** required. It stops at its target preflight until the owner designates a verified
Supabase sandbox (`E2E_SANDBOX_PROJECT_REF`), and a skipped or failing run is not a pass. Make it required only after the
sandbox is verified, the preflight passes, the run is stable across several pull requests, and the `e2e-sandbox`
Environment has required reviewers (an approval pause would otherwise stall every merge).

### Gate before requiring them: each check must have reported success on `main`

Checked on 2026-11-04: after #254 merged (`05009c41`) and after #251 merged (`04e4b6cc`), `Unit & Lint` (jobs `Unit tests`, `Lint`, `Typecheck & build`) and `Database tests` (job `Replay migrations and run SQL tests`) each completed with conclusion `success` on the push to `main`. Earlier, at `890082cb`, the same three Unit & Lint jobs and Database tests had also succeeded. `Replay migrations and run SQL tests` now reports on every pull request, including documentation-only ones. A check can be selected as required once it has reported on the repository within the last seven days.

## 2. Lovable and direct pushes to `main`: assessment

What the history shows. `main` receives direct commits written by Lovable (author `gpt-engineer-app[bot]`, for example
"Added app-only maintenance mode", 2026-11-03). In the Actions history those pushes are attributed to the owner's own
GitHub account as the pushing actor (`ballacitysports-star`), not to a separate app. **Confirm which it is** in Settings >
Integrations (a GitHub App installation, or an OAuth authorization of the owner's account). The answer decides what a
bypass means:

- If Lovable pushes as the owner's account, you cannot give Lovable a bypass without giving the owner's account the same
  bypass, and "admin may bypass" and "Lovable may bypass" are the same switch.
- If Lovable pushes as its own GitHub App, a bypass can be limited to that app.

What an unrestricted direct push to `main` can do, and why it matters for the privacy release:

| Path in a direct push                                | Effect                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `supabase/migrations/**`, `drizzle/migrations/**`    | Lovable's agent applies migrations to the production database itself (commits such as "Applied remove_unclaimed_listing"). Branch rules cannot stop that; they can only make the file reviewable first. |
| `.github/workflows/**`, `.github/e2e-preflight*.mjs` | Changes what CI checks, what has secrets, and the sandbox guard.                                                                                                                                        |
| `supabase/config*.toml`                              | Changes which project tooling points at.                                                                                                                                                                |
| Application code                                     | Reaches production only when someone publishes (publishing is separate), but a bad merge here is what the checks exist to catch.                                                                        |

Merging to `main` does not apply SQL or publish (F7 and the payment-settings fix are merged and absent from production).
So a branch rule protects review and CI, not the database; the database is protected by approvals for each production
action described in the release runbook.

Recommendation, in order of preference:

1. **During the privacy release (from the first merge until activation and coarsening are complete): no standing bypass.**
   Pull requests only, all four checks required. Lovable work continues on a branch and reaches `main` through a pull
   request (verify that your Lovable plan supports working on a non-default branch; test with a trivial edit outside the
   release window). Lovable edits made while the rule is active and not supported on a branch will be rejected; that is
   the intended friction, not a fault.
2. **If Lovable cannot work any other way, a time-boxed bypass held by the owner**, switched on for the minimum time and
   off again, with every bypassed commit reviewed afterwards. Never a permanent entry for an actor that can write
   migrations, workflows and configuration unreviewed.
3. **After the release**, re-assess with real data: how often Lovable pushes, whether it supports branches and pull
   requests, and whether a path-restricted rule is available on your plan (rulesets can restrict file paths on some
   plans, which would let application files through while still requiring review for the three sensitive path groups
   above).

A detective control that needs no special plan: a small workflow on `push` to `main` that fails visibly if a commit by the
bot touched the sensitive path groups. Not added here; ask if you want it.

## 3. The ruleset (Settings > Rules > Rulesets > New branch ruleset)

- Name `main protection`. Enforcement: Active (use Evaluate first if your plan offers it, to see what would be blocked).
- Target: the default branch (`main`).
- Rules:
  - Restrict deletions. Block force pushes.
  - Require a pull request before merging. Required approvals: 0 while there is a single account (GitHub does not count an
    author's own approval, so 1 would block everything). Do not require Code Owners review until a second reviewer exists.
    Dismiss stale approvals; require conversation resolution.
  - Require status checks to pass: the four in section 1, source GitHub Actions. Require branches to be up to date before
    merging: the migration pull requests must be tested against the final merged result.
  - Allowed merge methods: merge commit only while the stacked privacy branches exist (squash or rebase rewrites the
    branches a later pull request is based on).
- Bypass list: empty during the privacy release (see section 2). Do not add a "Lovable" entry on the assumption that it is
  separate from the owner; check first.
- Settings > General > Automatically delete head branches: off until the privacy stack is merged (deleting a branch that an
  open pull request uses as its base closes that pull request).

## 4. Verify it works

1. Open a documentation-only pull request. All four checks appear and report (none stays "Expected").
2. Push a commit directly to `main`: rejected.
3. A pull request with a deliberately failing SQL assertion or broken migration cannot be merged.
4. Make a trivial Lovable edit and see what happens; this tells you whether section 2, option 1 is workable.
5. Settings > Rules > Insights shows the rule evaluated.

## 5. Do not

- Require `Playwright` or any check that needs a secret or an approval.
- Set `E2E_SANDBOX_PROJECT_REF` as part of this.
- Weaken or bypass the rules to get a release step through; fix the failing check.
