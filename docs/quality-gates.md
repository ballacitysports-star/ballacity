# Quality gates (plan section 9.2)

Blocking checks that keep new code from adding to known debt. Each one only judges what a pull
request changes, so the existing backlog does not block unrelated work; it can only shrink.

| Gate           | Rule                                                                                          | Where                                                                         |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Lint ratchet   | A changed file may not gain ESLint errors; a new file must have none (P3-9).                  | `scripts/lint-changed.mjs`, Lint job                                          |
| Component size | Over 800 lines (not counting blanks and comments) warns; over 1,500 is an error.              | `eslint.config.js` (`local/max-lines-soft`, `max-lines`), through the ratchet |
| Data           | No new `select("*")`. A count with `{ count, head: true }` returns no rows and is allowed.    | `eslint.config.js` (`no-restricted-syntax`), through the ratchet              |
| Policy tests   | A migration that adds or changes a row-level security policy needs a SQL test in the same PR. | `scripts/policy-tests-gate.mjs`, Lint job                                     |
| Bundle budget  | Entry and total client JS may not grow more than 5 percent; no other chunk over 150 kB gzip.  | `scripts/bundle-budget.mjs`, Typecheck & build job                            |
| Formatting     | Changed files must be Prettier-formatted.                                                     | `scripts/format-changed.mjs`, Lint job                                        |

## How the ESLint gates bite

The ratchet lints each changed file twice with the current config: as it is now and as it was at
the branch point. It fails only when the count goes up. So:

- The 5 files already over 1,500 lines (the game page among them) keep their one `max-lines` error
  and are not blocked when edited. A new file over 1,500 lines, or a file that crosses the line, is.
- The 69 existing `select("*")` calls stay until their files are next cleaned up; adding one is
  blocked. Name the columns instead.

## The policy gate

It reads the lines a branch adds under `supabase/migrations/` and looks for `create policy` or
`alter policy` outside `--` comments. If it finds one, the branch must also add or change a file
under `supabase/tests/`. One test file can cover several migrations. Run it locally with
`node scripts/policy-tests-gate.mjs` (or `POLICY_BASE=origin/some-branch`).
