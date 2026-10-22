# Database tests

SQL tests that run against a real copy of the database built from the migrations. They check the rules the app
relies on the database to enforce: who can see a reel, what a minor needs a guardian's approval for, what a
user cannot change about their own profile, what a moderator's Hide does.

```sh
bun run test:db                   # replay every migration, then run every test (about 20 seconds)
bun run test:db -- --replay-only  # just prove the migrations apply, in order, on a blank database
bun run test:db -- --only reel    # only test files whose name contains "reel"
bun run test:db -- --keep         # leave the scratch database behind to poke at (--reuse picks it up again)
```

It needs `psql` and a Postgres you can connect to as a **superuser** through the usual `PGHOST`, `PGPORT`,
`PGUSER` and `PGPASSWORD`. It creates and drops its own database (`ballacity_dbtest`), so it never touches
anything else on that server. Supabase runs Postgres 17; 16 also works.

## What it replays

`scripts/db-test.mjs` applies `supabase/migrations` and `drizzle/migrations` **together**, in timestamp order (a
drizzle entry's time is `when` in its `meta/_journal.json`). The live schema is both folders: the second is
what Lovable writes and applies itself. `support/supabase-stub.sql` stands in for the parts of the Supabase
platform the migrations assume (the API roles and their default grants, the `auth`, `storage`, `realtime` and
`vault` schemas, `auth.uid()`). If a migration fails to apply here, it would fail on a rebuild too. If it fails because the same file is committed to both folders, the error names the other copy: keep one (the drizzle copy if Lovable already applied it).

## The files

| File                                    | Protects                                                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_schema_invariants.test.sql`         | RLS on every table; `search_path` pinned on every `SECURITY DEFINER` function; allow-lists for what anonymous visitors can call or write; family data is private |
| `10_reel_visibility.test.sql`           | `reel_audience()` by age: adult public, 16-17 members, 13-15 and under-13 never public, drafts, hidden reels and family clips private                            |
| `20_teen_team_sharing.test.sql`         | A 13-15 reel reaches a team only with a verified guardian's approval, and stops the moment any condition stops holding                                           |
| `30_guardian_gates.test.sql`            | Minors need a guardian to join a team or a game; waivers; withdrawn consent locks a child out                                                                    |
| `40_profile_and_family_guards.test.sql` | Users cannot lift their own suspension or change their age; the rules for posting a clip of a child                                                              |
| `50_post_moderation.test.sql`           | Posts and comments start pending, edits go back to pending, a moderator's Hide holds and the author cannot undo it                                               |
| `60_content_studio.test.sql`            | Only a superadmin approves or publishes; an approval is bound to the exact text and Page; editing withdraws it; one post per approval; Page tokens unreadable    |
| `70_listing_claim_review.test.sql`      | Nobody reviews their own listing claim; claims state a relationship and an attestation; the needs-info round trip; a claim grants nothing until approved         |
| `110_follow_approval.test.sql`          | Private accounts: following waits for approval; every minor always needs it; under 16 only a guardian can answer; no direct writes to follows / requests         |

## Writing a test

A test file is plain SQL wrapped in `BEGIN; ... ROLLBACK;`, so nothing it creates survives. Setup runs as the
superuser, where `auth.uid()` is NULL, the same footing as the service role. `t.as_user()`, `t.as_anon()` and
`t.as_service()` then switch to an API role, and `t.reset()` switches back. RLS and the guard triggers apply
exactly as they do for a real request.

| Helper                                      | Does                                                                                       |
| ------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `t.person('handle', age)`                   | Sign-up path: an `auth.users` row plus a birthday, so the age cohort is set. Letters only. |
| `t.guardian('parent', 'child')`             | Verified guardian link, approved consent where the age needs one, and a controls row       |
| `t.team('id', 'owner')`, `t.member(...)`    | A team and its members                                                                     |
| `t.reel('owner', 'tag')`                    | A finished, posted reel, id `t.id('reel-tag')`                                             |
| `t.id('handle')`                            | The stable uuid for a person, so a test can name them without keeping variables            |
| `t.eq(got, want, name)`, `t.ok(cond, name)` | An assertion                                                                               |
| `t.throws(sql, 'MESSAGE', name)`            | The statement must fail with that text in its message (runs in a savepoint)                |
| `t.lives(sql, name)`                        | The statement must succeed                                                                 |
| `t.count(query)`, `t.changed(stmt)`         | Rows visible / rows changed for the current role. No privilege at all counts as 0.         |

Keep one file per area, name each assertion as the rule it checks, and write a test for any new rule that protects
minors, guardians, payments or moderation in the same pull request as its migration. A test is only worth having if
it fails when the protection is removed, so try it: drop the trigger or policy in a scratch copy and watch it fail.

`00_schema_invariants.test.sql` holds two allow-lists. A new `SECURITY DEFINER` function anonymous visitors can call,
or a new policy anonymous visitors can write through, fails it until the migration revokes the grant or a reviewer
adds the entry with a reason.
