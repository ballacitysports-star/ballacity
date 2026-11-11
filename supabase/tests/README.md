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
`vault` schemas, `auth.uid()`). If a migration fails to apply here, it would fail on a rebuild too. Each migration is applied once (P0-4): nine files were committed to both folders with identical content, and the
replay applies whichever copy comes first and skips its twin (`scripts/migration-twins.mjs` lists them; production
applied each once, and the replayed schema matches production's fingerprint). Any other identical copy fails the
replay, naming both files: commit a migration to one folder only (keep the drizzle copy if Lovable already applied it).

## The files

| File                                           | Protects                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_schema_invariants.test.sql`                | RLS on every table; `search_path` pinned on every `SECURITY DEFINER` function; allow-lists for what anonymous visitors can call or write; family data is private                                                                                                                                              |
| `10_reel_visibility.test.sql`                  | `reel_audience()` by age: adult public, 16-17 members, 13-15 and under-13 never public, drafts, hidden reels and family clips private                                                                                                                                                                         |
| `20_teen_team_sharing.test.sql`                | A 13-15 reel reaches a team only with a verified guardian's approval, and stops the moment any condition stops holding                                                                                                                                                                                        |
| `30_guardian_gates.test.sql`                   | Minors need a guardian to join a team or a game; waivers; withdrawn consent locks a child out                                                                                                                                                                                                                 |
| `40_profile_and_family_guards.test.sql`        | Users cannot lift their own suspension or change their age; the rules for posting a clip of a child                                                                                                                                                                                                           |
| `50_post_moderation.test.sql`                  | Posts and comments start pending, edits go back to pending, a moderator's Hide holds and the author cannot undo it                                                                                                                                                                                            |
| `60_content_studio.test.sql`                   | Only a superadmin approves or publishes; an approval is bound to the exact text and Page; editing withdraws it; one post per approval; Page tokens unreadable                                                                                                                                                 |
| `70_listing_claim_review.test.sql`             | Nobody reviews their own listing claim; claims state a relationship and an attestation; the needs-info round trip; a claim grants nothing until approved                                                                                                                                                      |
| `110_follow_approval.test.sql`                 | Private accounts: following waits for approval; every minor always needs it; under 16 only a guardian can answer; no direct writes to follows / requests                                                                                                                                                      |
| `120_minor_messaging.test.sql`                 | Who may start a conversation with a minor: age rules, guardian controls, a guardian reaches only their own children, no client path around the function                                                                                                                                                       |
| `130_storage_policies.test.sql`                | Payment proofs, message attachments and highlight videos stay with their owners and participants; nobody writes into another folder; a quarantined clip is unreadable                                                                                                                                         |
| `140_game_join_gate.test.sql`                  | A player cannot skip host approval or the entry fee, join an ended game or a full one; a guardian's "Can join games" switch and withdrawn consent hold for every minor                                                                                                                                        |
| `150_guardian_join_request_order.test.sql`     | A minor's game request needs the host's answer and the guardian's, in either order; a guardian can answer until the child is on the roster                                                                                                                                                                    |
| `160_team_members_direct_add.test.sql`         | A coach cannot put anyone on a roster by writing the row (a minor never could; an adult since 20261111120000); the invite is the way in                                                                                                                                                                       |
| `170_waitlist_notified_on_leave.test.sql`      | When a seat opens the player who has waited longest is told once; no one is told about a closed or started game                                                                                                                                                                                               |
| `180_trainer_org_affiliation.test.sql`         | Only a trainer can put their profile on a facility: no direct add, no forged invite, no repointing a member row                                                                                                                                                                                               |
| `190_report_integrity.test.sql`                | A report starts as new whatever its author sends; reviewer fields are a moderator's alone; the author cannot edit it afterwards                                                                                                                                                                               |
| `200_message_guards.test.sql`                  | Messages are checked on send: a guardian turning messaging off or a block stops an existing thread; a sent message cannot be rewritten                                                                                                                                                                        |
| `210_message_attachment_checks.test.sql`       | An attachment is accepted only after the server checked that file for this sender and conversation; the stored type is the checked one                                                                                                                                                                        |
| `220_bucket_mime_types.test.sql`               | The public image buckets allow only JPG, PNG and WEBP; other buckets are untouched                                                                                                                                                                                                                            |
| `230_cancel_own_requests.test.sql`             | A player can take back their own pending request and payment proof on a paid game, and no one else's                                                                                                                                                                                                          |
| `240_minor_pay_after_parent.test.sql`          | A 16-17 year old with a guardian cannot send a payment proof before the guardian approves the request; adults unaffected                                                                                                                                                                                      |
| `250_host_block_join.test.sql`                 | A host's block stops the blocked person asking to join or joining that host's games, even naming another host on the request; one direction only; unblocking lifts it                                                                                                                                         |
| `260_guardian_actions.test.sql`                | Only a child's guardian can cancel a game for them, change their controls, end the family link or withdraw consent; strangers, the child and a moderator are refused; a moderator cannot authorise a public profile; withdrawing consent applies the restrictions                                             |
| `270_team_message_host_actions.test.sql`       | Team invite/remove/role/ownership/RSVP, accept-decline-unsend a message, and host cancel/attendance: refused for strangers, members and guardians who lack the right; allowed for the person who has it                                                                                                       |
| `280_remove_unclaimed_listing.test.sql`        | Only a moderator can take down an unclaimed listing, and only while nobody owns it, no claim is open and nothing else (members, posts, reviews...) depends on it; finished claims are swept with it; visitors cannot call it                                                                                  |
| `310_minor_reviews.test.sql`                   | Reviews and reputation are about adults only: nobody writes a review about or as a minor, anything written by or about someone who was a minor stays nonpublic forever, and the review screening hold (hotfix 0032) still applies on top                                                                      |
| `500_authenticated_oracles.test.sql`           | A minor's age is read only by the minor, a verified guardian, a moderator or the server; the messaging policy functions answer only about the caller; no API role writes `user_roles`, even with a grant restored                                                                                             |
| `510_under13_self_registration.test.sql`       | Nobody registers themselves as under 13 through `set_my_birthday`; adults and 13-year-olds register; an under-13 already on file re-saves their own date; the birthday lock still holds                                                                                                                       |
| `520_follow_request_blocks.test.sql`           | A block stops follow requests in both directions and clears pending ones; a new request tells whoever can answer it once (the account, or an under-16's guardian)                                                                                                                                             |
| `530_entity_follows.test.sql`                  | Following a team, trainer or facility goes through `follow_entity` only: hidden, unclaimed and own entities are refused, a consent-locked account cannot follow, a block with the owner refuses and removes follows, and nobody but the follower and their guardian sees who follows (the owner gets a count) |
| `540_team_announcement_notifications.test.sql` | An approved team announcement notifies every member once, except the author and anyone with a block either way; pending, held, hidden and non-announcement posts notify nobody                                                                                                                                |
| `550_comment_reaction_notifications.test.sql`  | Owners of posts, games and highlights hear about approved comments and reactions (never their own, never across a block, no repeats); reacting to a minor's content follows the comment rule; a game's owner is found by its text id                                                                          |
| `560_network_posts.test.sql`                   | Posts: who may post as a person, team or facility; audience caps by age (no under-13 posts, 13-15 team/family, 16-17 never public); who reads public, followers (people, and followers of a team or facility), team and family posts; blocks, hidden teams, moderation, soft delete                           |
| `570_following_feed.test.sql`                  | Following: posts from people, teams and facilities you follow (or teams you belong to) and team announcements and recaps, only as the posts and team posts rules allow; signed-out visitors cannot call it                                                                                                    |
| `580_games_near.test.sql`                      | Server-side game discovery: radius, sport, soonest or nearest, paging; never lists private, hidden, cancelled or past games; a signed-out visitor still sees adult-only games only                                                                                                                            |
| `690_capture_structured_reviews.test.sql`      | A replay builds exactly production's structured-review schema (columns, recommend check, four functions) and its order of the messages body/attachment check, pinned to production's definitions                                                                                                              |
| `700_events_stage5_facility_events.test.sql`   | Venue events: venue staff create clinics, camps, tournaments and open gym (never tryouts) with a required age range; strangers, minors and hidden venues are refused; pending until approved; a hidden venue hides its events; staff read sign-ups and the youth venue (D0)                                   |
| `710_events_stage6_trainer_events.test.sql`    | Trainer group sessions: staff create clinics and camps only, age range required; strangers, minors, hidden trainers refused; pending until approved; sign-ups ask for the trainer's waiver; never on a team page                                                                                              |
| `720_app_error_events.test.sql`                | Error reports (P0-8): only the service role reads or writes them; no user id, IP, email or URL column; message and fingerprint checks; the purge keeps 30 days and refuses under a day                                                                                                                        |
| `730_scheduled_jobs.test.sql`                  | Scheduled jobs (P2-7): worker helpers not callable by clients; base URL setting private and https-origin only; worker_post refuses paths outside /api/public/ and does nothing without a base URL                                                                                                             |
| `740_business_listings.test.sql`               | Business listings (P2-4): listings are venues unless the owner says otherwise; only facility or business; only the owner changes it; signed-out visitors read the type, never contact details                                                                                                                 |
| `750_team_chat.test.sql`                       | Team chat (P2-3): adults, 13-17s with a guardian and teammates messaging, and minors' guardians are in; no under-13, unguarded teen or stranger; pending until approved; rate limit, staff hide, member report                                                                                                |
| `780_minor_safety_gates.test.sql`              | Minor-safety gates: a declared age to take a game place (any writer), accept a team invite, be added to an organization directly (adults only) or pay; no direct roster writes, no moving an org membership; payment handles and the PayPal merchant id only for an adult payee; two oracles closed           |

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
