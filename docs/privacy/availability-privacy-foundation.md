# WP 1.0: availability privacy foundation

Status: **implemented on branch `claude/lucid-franklin-bxb02r`, tested on a scratch database. Not merged, not published, not applied to
production.** Migration `supabase/migrations/20261114100000_availability_privacy_foundation.sql`; test
`supabase/tests/840_availability_privacy_foundation.test.sql` (86 assertions); rollback
`docs/rollbacks/20261114100000_availability_privacy_foundation.down.sql`.

This is the first work package of the availability-first plan (Phase 1). Availability is about to become the main screen, so the rules
about who can read a post come first.

## What it changes

| Path                                                      | Before (main `0902b87`)                                                                                           | After                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading posts (table, Players tab, player page, Realtime) | every signed-in account reads every open post, minors' included; `hidden_at`, blocks and suspensions ignored      | the author and their verified guardian always; others only while open and not hidden, never across a block or from a suspended or banned author, and for a minor or unknown-age author only people who may know them (R2) |
| A minor's stored location and note                        | exact when the author chose it; any note text                                                                     | city at most; a note naming an address, map link or coordinates is refused (`LOCATION_IN_PUBLIC_TEXT`)                                                                                                                    |
| Contact requests and game invitations                     | only blocks and the recipient's privacy setting; triggers in name order, so the block guard answered for any pair | sender must be the signed-in user and able to read the post, addressed to its author; minor-messaging rules apply; every refusal about the recipient is `MINOR_MESSAGING_BLOCKED:recipient_restricted:other`              |
| Author edits to `status` / `hidden_at`                    | allowed (an author could unhide or reopen what BallaCity closed)                                                  | refused for signed-in clients (`AVAILABILITY_FIELD_FORBIDDEN`); server code and definer functions unaffected                                                                                                              |
| Revoking parental consent for a child with a post         | failed: `Invalid status: inactive`, whole revocation rolled back                                                  | works; the post becomes `inactive` and hidden, seen only by the child and the guardian                                                                                                                                    |
| A player changing their own position in a game            | failed: `relation "public.games" does not exist`                                                                  | works; other fields of their place stay locked                                                                                                                                                                            |

The app change in the same commit: `createContactRequest` turns a `MINOR_MESSAGING_BLOCKED` refusal into the one neutral line ("This player
can't receive messages from you right now."), so the contact dialog never shows a raw code.

## Relationship to R2 (#265) and the PRIV stack

R2 was stacked on the unmerged PRIV-2B/2D branches. This migration carries R2's design unchanged, plus the two helpers it needs from that
stack (`private_sec.can_see_minor_name`, `private_sec.text_discloses_location` / `location_tokens`), repointed at the `private_sec` helpers
SEC-2 introduced. Differences from R2: the hidden/block/suspension filters, the post-readability and identity checks on requests, and SEC-2b's
single refusal code instead of per-reason codes. **#265 should be closed as superseded** once this merges; its file must not be applied
after this one. The PRIV-2B/2D files redefine the two helpers with `CREATE OR REPLACE` and the same signatures, so they remain compatible.

## Behaviour change to expect

- Adults no longer see minors' availability unless they share a game, chat, team or organization with them, host or coach them, or are an
  accepted follower. Posts by accounts with no recorded birthday ("unknown age") are treated the same way, so some adults who never entered a
  birthday become invisible in Find Players until they do.
- Hidden posts disappear from the Players tab for everyone but their author.
- Contacting a closed post, a hidden post or a blocker's post gives the neutral line.

## Production apply (separate approval required)

App first (it handles the new code either way), then the migration, recorded in `docs/release/records/` as in batches 4-7: rehearsal on a
replay of `main`, negative control, pre- and post-fingerprint, ledger row. Read-only checks after the apply:

```sql
select polname from pg_policy where polrelid = 'public.player_availabilities'::regclass and polcmd in ('r', '*');
-- expect exactly: Availability visible to permitted viewers
select count(*) filter (where lat is not null or formatted_address is not null or place_id is not null) as with_precise, count(*) as total
  from public.player_availabilities a where coalesce(public.age_cohort_of(a.user_id), 'unknown') <> 'adult';
-- residue for the separately approved blanking run (docs/release/legacy-data-procedures.md, P1)
```

## Residuals

- Existing rows by minors keep stored coordinates until the separately approved blanking run; they are unreadable to unrelated accounts.
- A 16-17-year-old without guardian controls can still contact an adult through the adult's post (R7, #270, is unmerged).
- The note detector is a heuristic; moderators have the scan and scrub functions.
- A refusal still carries one bit (the request was not accepted). It no longer says why.

## WP 1.1: pickup intent and post lifecycle

Migration `20261114110000_availability_intent_and_lifecycle.sql`, test `850` (44 assertions), rollback
`docs/rollbacks/20261114110000_availability_intent_and_lifecycle.down.sql`. Apply after WP 1.0.

- `looking_for` also accepts `pickup` (listed first in the app).
- Statuses `paused` (the author's switch; listed to nobody else, takes no requests) and `expired` (set by server code, WP 1.2).
- `last_confirmed_at`: starts at the apply time for every existing post; the server stamps it when the author resumes, reconfirms or
  changes the times.
- A post stops being listed to others (author and guardian still see it): weekly posts 14 days after the last confirmation; dated posts
  when the last slot ends, in the post's timezone (America/New_York when missing or unknown); slot-less legacy posts at the end of
  `ends_on`, else 14 days after confirmation. A malformed legacy row is listed as before rather than breaking the listing.
- Authors can move their own post only between open and paused, or from expired back to open. `closed`, `inactive` and `hidden_at`
  stay BallaCity's and the guardian's.
- Expect on apply: dated posts whose last date has passed stop being listed at once; every other post has 14 days before it needs a
  reconfirm (WP 1.2 sends the reminder).
