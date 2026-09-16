# CI run 92 — E2E failure diagnostics

Captured 2026-09-16 from workflow run
[34569074064](https://github.com/ballacitysports-star/ballacity/actions/runs/34569074064)
(`E2E`, run number 92, branch `claude/code-review-next-steps-1qdb4a`, head
`ea77d7047426df543d0184953652e61ecbcbca26`, executed 2026-09-11, 50.9 minutes).

**Result: 97 failed, 89 passed, 11 skipped, 197 total**, across 60 spec files.
37 of the failing spec files are `invite-*`, `pay-*` or `oauth-*`.

## What is here

| File | What it is |
| --- | --- |
| `failing-tests.txt` | All 97 failures, grouped by spec file with line numbers and test titles. `invite-*`/`pay-*`/`oauth-*` are listed first. |
| `playwright-job.txt` | The complete job log, timestamps and ANSI codes stripped: per-test error messages, the failing assertion with surrounding source lines, and the resolved-locator/received-value detail Playwright prints on failure. |

## What is NOT here, and why

The `playwright-report` artifact (id 10188443682, 142 MiB) held the **Playwright
traces, failure screenshots and video**. It expires **2026-09-18T07:06:54Z** and
it could not be rescued before then. Everything in this directory was recovered
from the job log instead, which survives separately.

So: the failing test, its assertion, and the value it actually got are all
preserved. Step-by-step trace timelines, DOM snapshots and screenshots are not.

The rescue path that exists for this — `.github/workflows/preserve-artifact.yml`,
which copies an artifact into a permanent Release asset — could not run, because
**GitHub Actions is not assigning runners to this repository**. Two dispatches
(2026-09-15 and 2026-09-16) both died in ~3 seconds with `runner_id: 0`, no step
executed and no logs. That is the same signature every `E2E` run has shown since
2026-09-11 12:02, and `.github/workflows/runner-probe.yml` — a minimal job with
no secrets, no concurrency group and one step — fails identically, which places
the cause at account or repository level rather than in any workflow's spec.

**If Actions is restored before 2026-09-18T07:06:54Z**, the traces can still be
saved: dispatch `Preserve Artifact` with `run_id=34569074064`,
`artifact_name=playwright-report`. After that timestamp the traces are gone
permanently.

## Dominant failure signatures

| Count | Signature |
| --- | --- |
| 124 | `expect(locator).toBeVisible() failed` |
| 62 | `element(s) not found` |
| 20 | `expect(page).toHaveURL(expected) failed` |
| 8 | `expect(received).toBe(expected)` |
| 7 | `locator.click: Test timeout exceeded` |
| 4 | `page.waitForURL: Timeout exceeded` |

The shape — a large majority being "expected element never appeared", spread
across 60 unrelated spec files rather than concentrated in one feature — is more
consistent with the app not reaching a usable state under test than with 97
independent assertion bugs. Worth confirming against the app's own startup
behaviour before triaging specs one at a time.

## Provenance note

No credentials are present. The log was scanned for JWTs, `sk_`/`pk_`/`rk_`
keys, Supabase `sb_` keys, bearer and authorization headers, API/access/refresh
tokens, AWS keys and password assignments — zero hits. Playwright's stdout
reporter does not emit request headers or cookies; that material only existed in
the trace bundle, which is the part that was lost. URLs in the log are
`localhost:8080` with synthetic test parameters.
