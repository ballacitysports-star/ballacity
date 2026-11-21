# Release record: guardian links end at 18 applied to production and published, 2026-11-21

Production project `cpqihhcqeivbgxqbzatv`. Follows `2026-11-20-guardian-links-end-at-18.md` (merge of #452, sandbox
apply). Owner approvals in the session:

- 2026-11-20, "Guardian link end after 18": the rule;
- 2026-11-20, "Approve all": the four decisions, the sandbox apply and the merge of #452;
- 2026-11-21, "Approve all": apply `20261125200000` to production, then publish main.

This record holds hashes, check results and counts only, no user data.

## What shipped

| PR   | What                                                                       | Production step                          |
| ---- | -------------------------------------------------------------------------- | ---------------------------------------- |
| #452 | A guardian link stops binding when the child is a known adult; daily sweep | `20261125200000` applied, then published |

Rule: a link is in force when its status is `active` and the child is not a known adult (stored birthday, `age()` of 18
or more, from 00:00 UTC). An unknown birthday and a managed account keep the link. Scope and design:
`docs/guardian-link-age-18.md`.

## 1. `20261125200000_guardian_links_end_at_18`

Same route as earlier batches, in one transaction: insert the ledger row holding the file's text exactly as on `main`,
raise unless that text's md5 equals the file's, run the stored text with `EXECUTE`. Fingerprints use batch 8's
C-collation method over `docs/migration-evidence/catalog-fingerprint-cte.sql`.

| Step             | Result                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| File             | md5 `4ec266a0` (same on `main` `b85cf37e` and in the apply statement)                                                                                          |
| Local rehearsal  | Replay of `main` without the file: `bdb6d77d` (3436). With it: `3b00338f` (3446). The apply script on the replay without the file landed on `3446`, `3b00338f` |
| Negative control | A copy requiring a wrong md5 raised and rolled back: ledger row absent, function absent. A second run of the good copy stopped on the ledger key               |
| Production pre   | `bdb6d77d`, 3436 objects, ledger 411, latest `20261124200000` (equals the replay without the file); no row for the version                                     |
| Production post  | `3b00338f`, 3446 objects (equals a full replay of `main`), ledger 412, ledger text md5 `4ec266a0`                                                              |
| Data             | 2 active guardian links, unchanged; 0 sweep events; no link ended (both children are under 18)                                                                 |
| Grants           | `guardian_links_in_force`: `anon` and `authenticated` may not run it; `my_guardian_link_in_force`: `authenticated` may                                         |
| Schedule         | `end-adult-guardian-links` is scheduled daily at 04:41 UTC (pg_cron present)                                                                                   |
| Errors           | 0 `app_error_events` in the 30 minutes before the post-check                                                                                                   |

Rollback: `docs/rollbacks/20261125200000_guardian_links_end_at_18.down.sql`. It needs a confirmation setting, refuses if
a function's definition has changed, and cannot un-revoke links the sweep already ended (`guardian_link_age_events`
keeps the list). Roll the app back first.

## 2. Publish

| Step                        | Detail                                                        |
| --------------------------- | ------------------------------------------------------------- |
| Lovable `latest_commit_sha` | `main` `b85cf37e`, the #453 merge, after the production apply |
| Order                       | after the production apply, as the migration requires         |
| Deployment                  | `35251272`                                                    |

## Production at the end

- Catalog: equals a replay of `main` `b85cf37e`, fingerprint `3b00338f`, 3446 objects.
- Ledger: 412 rows.

## Left open

- The managed-account handover at 18 (owner decision; options in `docs/guardian-link-age-18.md`).
- Whether and when to age `profiles.age_cohort`.
- The first scheduled sweep runs at 04:41 UTC; it has nothing to end today.
