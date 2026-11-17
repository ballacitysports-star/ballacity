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

## WP 1.3: server-side player search

Migration `20261114120000_players_available_near.sql`, test `860` (26 assertions), rollback
`docs/rollbacks/20261114120000_players_available_near.down.sql`. Apply after WP 1.1. No screen calls it yet (WP 1.5).

- `public.players_available_near(...)` runs as the caller, so everything about who may be seen is the table's read policy (WP 1.0
  and 1.1). It also requires the post to be open, unhidden and not run out, so guardians and authors do not see closed posts in
  results, and it never lists the caller's own posts.
- Matching: sport; intent; skill tiers (a post with no tier for the sport matches any); the time window (default the next 7 days,
  at most 31), with dated and weekly slots turned into real times in each post's timezone; reach both ways (the caller's radius and
  the poster's own travel radius). A malformed slot or date is skipped, never an error.
- Output: one row per person (their earliest matching window), distance in whole miles rounded up (at least 1), nearest or soonest
  first, limit/offset paging with a stable tie-break. It adds no location precision beyond what the table already returns to the
  same caller.
- App: `listPlayersAvailableNear` wraps it. New and edited posts now store a point for their city, rounded to two decimals; the
  database still applies the author's location-privacy setting and stores no point for anyone under 18.

## WP 1.4: "I'm available" and My availability (app only)

No database change; it uses WP 1.1's pause and reconfirm.

- **"I'm available" sheet** (`src/components/availability/QuickAvailabilitySheet.tsx`, logic in `src/lib/quick-availability.ts`):
  sport, level and area come from the profile; the player picks Today, Tomorrow or a date, a time of day, and optionally
  "every <weekday>". It respects the existing posting gate (a player profile with a sport level). "More options" opens the
  full form. The Players tab's "+" and the Mine tab's new "I'm available" button open it.
- **My availability** (`src/components/players/MineView.tsx`, rules in `src/lib/availability-lifecycle.ts`): each post shows
  Listed until <date>, Paused, Not listed (run out) or Closed; Pause and Resume; "Still available" for weekly posts within
  three days of running out or already run out; "Pick new dates" for dated posts whose dates passed. The expiry date mirrors
  `private_sec.availability_expires_at` (same test cases as SQL test 850); the database still decides visibility.
- **Install banner**: it sat above every sheet and dialog (z-60) and covered their buttons on phones; it now sits above the
  bottom nav and below dialogs (z-45).
- Checked against the verified sandbox at iPhone size: post, listed-until date, pause, resume and remove all saved; the test
  account's profile was restored and the test post removed; no request reached the production host.

## WP 1.5: Find Players on the server search (app only)

No database change; it uses WP 1.3's `players_available_near`.

- With the viewer's location (device or a typed place), the Players list comes from the server search: real distance
  within both the viewer's radius (the distance filter, else 25 miles) and the poster's travel radius; the "When" filter as
  a real time window (`src/lib/availability-window.ts`: today to midnight, the next 7 days, the weekend, or two weeks ahead
  for "any"); intent; one sport when exactly one is picked. Nearest and Soonest keep the server's order. Pages of 30 with
  "Load more". Posts saved before locations were captured are still listed, after the located ones.
- The search, the sport and skill chips, the age filter and the text search still narrow the page in the browser; the
  card, the author details and the read rules are unchanged (`listAvailabilityNear` reads the posts the search returned,
  under the same read policy).
- Without a location the list is the newest posts, as before. If the search fails (an older database, a network error)
  the page falls back to that list for the visit instead of showing an error; checked on the sandbox before WP 1.3 was
  applied there (the search answered 404, the page listed posts, no error shown).
