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

| File                                       | Protects                                                                                                                                                               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_schema_invariants.test.sql`            | RLS on every table; `search_path` pinned on every `SECURITY DEFINER` function; allow-lists for what anonymous visitors can call or write; family data is private       |
| `10_reel_visibility.test.sql`              | `reel_audience()` by age: adult public, 16-17 members, 13-15 and under-13 never public, drafts, hidden reels and family clips private                                  |
| `20_teen_team_sharing.test.sql`            | A 13-15 reel reaches a team only with a verified guardian's approval, and stops the moment any condition stops holding                                                 |
| `30_guardian_gates.test.sql`               | Minors need a guardian to join a team or a game; waivers; withdrawn consent locks a child out                                                                          |
| `40_profile_and_family_guards.test.sql`    | Users cannot lift their own suspension or change their age; the rules for posting a clip of a child                                                                    |
| `50_post_moderation.test.sql`              | Posts and comments start pending, edits go back to pending, a moderator's Hide holds and the author cannot undo it                                                     |
| `60_content_studio.test.sql`               | Only a superadmin approves or publishes; an approval is bound to the exact text and Page; editing withdraws it; one post per approval; Page tokens unreadable          |
| `70_listing_claim_review.test.sql`         | Nobody reviews their own listing claim; claims state a relationship and an attestation; the needs-info round trip; a claim grants nothing until approved               |
| `110_follow_approval.test.sql`             | Private accounts: following waits for approval; every minor always needs it; under 16 only a guardian can answer; no direct writes to follows / requests               |
| `120_minor_messaging.test.sql`             | Who may start a conversation with a minor: age rules, guardian controls, a guardian reaches only their own children, no client path around the function                |
| `130_storage_policies.test.sql`            | Payment proofs, message attachments and highlight videos stay with their owners and participants; nobody writes into another folder; a quarantined clip is unreadable  |
| `190_report_integrity.test.sql`         | A report starts as new whatever its author sends; reviewer fields are a moderator's alone; the author cannot edit it afterwards |
| `200_message_guards.test.sql`           | Messages are checked on send: a guardian turning messaging off or a block stops an existing thread; a sent message cannot be rewritten |
| `210_message_attachment_checks.test.sql`| An attachment is accepted only after the server checked that file for this sender and conversation; the stored type is the checked one |
| `220_bucket_mime_types.test.sql`        | The public image buckets allow only JPG, PNG and WEBP; other buckets are untouched |
| `230_cancel_own_requests.test.sql`      | A player can take back their own pending request and payment proof on a paid game, and no one else's |
| `240_minor_pay_after_parent.test.sql`   | A 16-17 year old with a guardian cannot send a payment proof before the guardian approves the request; adults unaffected |
| `250_host_block_join.test.sql`          | A host's block stops the blocked person asking to join or joining that host's games, even naming another host on the request; one direction only; unblocking lifts it |
| `260_guardian_actions.test.sql`         | Only a child's guardian can cancel a game for them, change their controls, end the family link or withdraw consent; strangers, the child and a moderator are refused; a moderator cannot authorise a public profile; withdrawing consent applies the restrictions |
| `270_team_message_host_actions.test.sql` | Team invite/remove/role/ownership/RSVP, accept-decline-unsend a message, and host cancel/attendance: refused for strangers, members and guardians who lack the right; allowed for the person who has it |
| `140_game_join_gate.test.sql`              | A player cannot skip host approval or the entry fee, join an ended game or a full one; a guardian's "Can join games" switch and withdrawn consent hold for every minor |
| `150_guardian_join_request_order.test.sql` | A minor's game request needs the host's answer and the guardian's, in either order; a guardian can answer until the child is on the roster                             |
| `160_team_members_direct_add.test.sql`     | A coach cannot put a minor on a roster by writing the row; the invite their guardian approves is the way in                                                            |
| `170_waitlist_notified_on_leave.test.sql`  | When a seat opens the player who has waited longest is told once; no one is told about a closed or started game                                                        |
| `180_trainer_org_affiliation.test.sql`     | Only a trainer can put their profile on a facility: no direct add, no forged invite, no repointing a member row                                                        |

## Races

A test file runs in one session, so it cannot show two requests arriving together. `scripts/db-test.mjs` runs
the races after the files: it commits a small game, opens real sessions against it, checks the outcome and
removes it. Today that is two players taking the last seat of a game (`--only race` runs just that, about four
seconds). Add a race there when a rule depends on the order things happen in, not only on what is stored.

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
