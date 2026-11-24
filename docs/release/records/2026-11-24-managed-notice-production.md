# Release record: managed-account notice points to the handover (#468), 2026-11-24

Owner approvals in the session:

- 2026-11-24, "merge all": merge #467 (real-auth check, tests and docs only) and #468 (this migration);
- 2026-11-24, "Apply 20261130100000": apply the migration (no target named, so the sandbox first);
- 2026-11-24, "Apply to production" (to an explicit question naming the migration, the ledger route, the function md5
  check and the local-stack-proof-only note): apply it to production.

This record holds hashes and counts only, no user data. Nothing was published for this change (no app code changed).

## What shipped

| PR   | What                                                                                           | Merge commit | Production |
| ---- | ---------------------------------------------------------------------------------------------- | ------------ | ---------- |
| #467 | The managed-account handover run against a real (local) auth server: tests and docs only       | `45bd5586`   | none       |
| #468 | The notice a managing guardian gets when a managed account turns 18 points to "Start handover" | `2dfc645d`   | applied    |

`20261130100000_managed_notice_points_to_handover` replaces one function, `private_sec.end_adult_guardian_links(integer)`,
and changes one string in it. Recipient, once-only rule, adult test, link endings, audit rows, grants and schedule are
unchanged (SQL test 994, 48 assertions; guarded rollback `docs/rollbacks/20261130100000_managed_notice_points_to_handover.down.sql`,
which must run before the rollback of `20261125200000`). Notices already sent keep their old text.

## Basis for the notice going out: local-stack proof only

The notice sends managing guardians to the handover. The five behaviours the handover needs from a real auth service were
observed on the local Supabase stack (#467, `docs/managed-account-handover.md` section 6), not on a hosted project. Not seen:
the email send itself, the "Forgot password" mailer path, hosted auth settings and versions, a real OAuth link, and the
Parent Center "Start handover" card end to end. Production has 2 managed accounts and none is a known adult, so no managing
guardian can be told yet.

## Sandbox (`qkukefvzwlyusvspablz`)

Applied by the ledger route (one transaction: insert the ledger row with the file's text, raise unless its md5 equals the
file's, run the stored text with `EXECUTE`).

| Step | Result                                                                                                                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre  | ledger 74, latest `20261129130000`; function md5 `70a31fe4`                                                                                                                                                                                   |
| Post | ledger 75, latest `20261130100000`; ledger text md5 `cab1e0ab` equals the file; function md5 `c3f95d69`; objects equal a replay of main `2dfc645d` (3512, fp440 `05043f2f`) apart from the pre-existing `public._schema_import_requests` rows |

## Production (`cpqihhcqeivbgxqbzatv`)

Applied 2026-11-24 by the ledger route with a 5 s lock timeout, after telling the other session that changes production and
waiting for its "nothing in flight". No lock timeout fired and no session was idle in a transaction before or after.

| Step | Ledger | Latest version   | Objects (fp440) | Function md5                       | Equal to a replay of      |
| ---- | ------ | ---------------- | --------------- | ---------------------------------- | ------------------------- |
| Pre  | 423    | `20261129130000` | 3512 `55c0afc4` | `70a31fe4cdd5914cd419528c9cfa4496` | main before the migration |
| Post | 424    | `20261130100000` | 3512 `05043f2f` | `c3f95d699d9cb5e23c757eea4128f055` | main `2dfc645d`           |

The ledger text md5 `cab1e0ab` equals the file, and the function md5 equals the rollback guard value (so Postgres 16 and
the sandbox's Postgres produce the same text as production's). The daily sweep `end-adult-guardian-links` is still active.

## Checks

- Local, merged with main: `tsc` clean; vitest all passed; lint, format and policy gates clean; full SQL suite 4468 passed,
  0 failed; apply, rollback and re-apply rehearsed on local replays.
- CI on #467 and #468 heads: unit, lint, typecheck and build, SQL replay and tests, Playwright and the E2E smoke set all green.
- CI on `main` after #467 (run 1400, `45bd5586`) and #468 (run 1402, `2dfc645d`): green.

## Open owner decisions

- A second factor beyond the mailbox for the handover, and any consent or notice requirement when an account is handed to an
  adult (legal; issues #306 to #313 untouched).
- How long the age and roster-row hold of the age-cohort change lasts; whether new comments and reactions open from the flip;
  the 13 and 16 transitions and under-13 (legal).
- Ordering: the other session's `20261130110000` (not applied) sorts after this one, which is in production first.
