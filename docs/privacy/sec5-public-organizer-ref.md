# SEC-5: public organizer reference (approval C, SEC-1 open item D-5)

Migration `supabase/migrations/20261108110000_public_organizer_ref.sql` (phase 1). Prepared phase 2:
`supabase/phase2/sec5_phase2_close_host_id_columns.sql` (not a migration, not applied). Tests:
`supabase/tests/510_public_organizer_ref.test.sql` (113 assertions, phase 2 applied inside the rolled-back
transaction), plus `src/lib/organizer-access.test.ts`, `src/lib/hosted-games-store.organizer.test.tsx`,
`src/lib/payments.join-request.test.ts` and `src/lib/organizer-review-fixes.test.ts`. See "Final review (780eaf8f)
corrections" for what the independent review changed, and "Phase 2 compatibility results" at the end for the old/new
client matrix (`supabase/tests/511_sec5_phase2_compat_matrix.test.sql`, inventory
`docs/privacy/sec5-client-query-inventory.json`), Realtime and GraphQL findings, and the phase-2 rollout plan. **The
release is not complete until phase 2 is applied (owner approval required).**

## Problem

`hosted_games.host_id` is the organizer's account id. Every signed-in account could read it on every game it can
see, youth-inclusive games included. It is the same value on all of a person's games, so one leak (an old snapshot,
a shared link, a roster seen once) ties every game a minor hosts to them, and it is the key that every other table
uses for that person. The audit found the same id in three more places next to a youth game:

- `hosted_games.image`: a custom cover is stored as `storage://game-covers/<host account id>/<file>`, so the path
  is the account id again, and `storage.objects` lets any signed-in account list the covers of public games.
- `join_requests.host_id`: anyone can ask to join a public game and then read their own request.
- the join-request insert trigger refused a request whose `host_id` did not match the game, so one insert was a
  yes/no test of "does account X host game Y".

## Design

**Choice: (i) security_invoker views, with the masked values computed by a definer function, then (ii) column
revokes in phase 2.**

- (ii) alone (revoke plus definer RPCs) breaks every `select("*")` and every "my games" filter at once, and moves
  game reads off row security into RPCs that would duplicate the read policies.
- (i) as sketched in SEC-1 (a view expression `CASE WHEN host_id = auth.uid() ...`) stops working the moment the
  column is revoked, because a security_invoker view reads base columns with the caller's privileges.
- So the view reads every column except `host_id` and `image` from the table as the caller (row security decides
  the rows, exactly as before), and gets those two from `private_sec.game_organizer_for_caller(game)`, a definer
  function that reads them itself. The view keeps working after phase 2, and phase 2 is a pure grant change.

What the migration adds:

| Object                                                                            | Purpose                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hosted_games.organizer_ref uuid NOT NULL UNIQUE`                                 | Random per game (filled for existing rows by the volatile default while the column is added, no UPDATE). `a00_keep_organizer_ref_trg` sets it on insert and keeps it on update, so a client cannot choose it or give two games one value. |
| `private_sec.organizer_hidden_for(host, viewer)`                                  | True when the host is not a confirmed adult (unknown age counts, as for the neutral snapshot) and the viewer is neither the host nor someone `private_sec.can_see_minor_name` allows.                                                     |
| `private_sec.game_organizer_for_caller(game)`                                     | `host_id` (NULL when hidden), `viewer_is_host`, `organizer_hidden`, `image` ('' when hidden).                                                                                                                                             |
| `public.hosted_games_public` (security_invoker, security_barrier)                 | All game columns + `organizer_ref`, `viewer_is_host`, `organizer_hidden`; `host_id`, `image` and `hosting_approval_id` masked when hidden.                                                                                                |
| `public.join_requests_visible` (security_invoker)                                 | All join-request columns, `host_id` masked the same way, plus `viewer_is_host`.                                                                                                                                                           |
| `a00_fill_join_request_host_trg`                                                  | Names the host from the game before every other insert trigger. Clients never need the host id to ask; a wrong id is corrected, not refused (no oracle).                                                                                  |
| Five roster/waitlist policies, `storage.objects` "Authenticated read game covers" | Same rules, through definer helpers (`private_sec.is_game_host`, `private_sec.game_cover_readable`). A sub-select in a policy IS checked against the caller's column privileges, so the old forms would fail after phase 2.               |
| `private_sec.game_cover_hidden_for_caller(name)`                                  | For phase 2's storage policy: a cover folder named after a hidden organizer.                                                                                                                                                              |

Who sees the host id: the host; anyone `can_see_minor_name` allows (verified guardians, people who share a game,
chat or team, staff dealing with them, accepted followers, administrators and moderators: the rule
`get_game_organizer` and R1 already use); everyone, for a confirmed-adult host. Who does not: a stranger, a pending
requester, an anonymous visitor (who in any case sees no youth game).

"Is this my game" is `viewer_is_host` (view column), never a filter on `host_id`.

Phase 2 replaces the table-level SELECT of `anon`/`authenticated` on `hosted_games` with a column grant on every
column except `host_id` and `image`, does the same for `join_requests.host_id`, verifies nothing still grants them,
and adds a restrictive `storage.objects` policy so a hidden organizer's cover folder is neither listable nor
signable by unrelated accounts. INSERT/UPDATE/DELETE grants and all policies are unchanged. Realtime (walrus) drops
columns the subscriber cannot SELECT, so payloads lose `host_id` and `image` too.

## Threat model

| Attacker                                                | Before                                                                                    | Phase 1 (this PR)                                                                                     | Phase 2                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Signed-in stranger listing games                        | `host_id` on every youth game; filter by id lists all of a minor's games; cover path = id | The app's reads are masked; the table still answers a hand-written query                              | Closed: column refused, sweep finds nothing |
| Stranger who asks to join                               | Reads `host_id` on their own request; insert errors confirm a guessed host                | Oracle closed (host filled in by the database); request row still carries the id on the table         | Closed                                      |
| Stranger listing `game-covers` in Storage               | Folder names = host ids of public games                                                   | Unchanged (equivalent to the open column)                                                             | Closed for hidden organizers                |
| Realtime subscriber on `hosted_games` / `join_requests` | Full rows                                                                                 | The app ignores payload fields (refetches through the view); a hand-made subscription still gets them | Columns stripped (walrus `is_selectable`)   |
| Linking two games of one minor through public fields    | Same `host_id`, same cover folder                                                         | Through the view: identical to a game by another minor host except `id` and a random `organizer_ref`  | Same, and no other path                     |
| Related person (guardian, roster, teammate, staff)      | Sees the id                                                                               | Unchanged                                                                                             | Unchanged                                   |

Test 510 proves the last column with a sweep: as the stranger, as a requester and as an anonymous visitor it reads
every table and view in `public` and `storage` the role can select, column by column, and lists each one where any
readable value contains the minor's id. Before phase 2 the stranger's list is exactly `{public.hosted_games,
storage.objects}` and the requester's adds `public.join_requests`; after phase 2 both are empty (and the anonymous
visitor's list is unchanged and has no hit).

## Audit

### Database access paths that carried the host id next to a youth game

| Path                                                                                    | Who could read it                                 | Disposition                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `hosted_games.host_id`                                                                  | anyone who can read the game                      | masked in view (phase 1), column revoked (phase 2)                           |
| `hosted_games.image` (cover path)                                                       | same                                              | masked in view, revoked in phase 2                                           |
| `hosted_games.hosting_approval_id`                                                      | same                                              | single-use per game (not a linker); masked in the view anyway                |
| `storage.objects` (`game-covers/<id>/...`)                                              | any signed-in account, for covers of public games | phase 2 restrictive policy                                                   |
| `join_requests.host_id`                                                                 | the requester, their guardians, the host          | masked in `join_requests_visible`, revoked in phase 2                        |
| join-request insert (`validate_join_request` mismatch error)                            | any signed-in account                             | closed in phase 1 (fill trigger)                                             |
| realtime `hosted_games`, `join_requests`                                                | subscribers passing row security                  | client uses events as signals only; phase 2 strips the columns               |
| `game_payment_settings.host_id`                                                         | host, approved requesters, payers, participants   | masked in `game_payment_settings_visible`, revoked in phase 2 (review F4)    |
| `payment_submissions`, `paypal_orders`, `payment_verification_events` `.host_id`        | payer and payee                                   | always the payee (`enforce_payment_destination`), an adult; never the minor  |
| `game_participants`                                                                     | the person, the host, the roster                  | related only (roster = shares a game)                                        |
| `game_position_waitlist.reviewed_by`                                                    | the waitlisted person (and realtime)              | written by the database, closed to clients in phase 1 (review F1)            |
| `hosted_games.host_snapshot` (legacy personal snapshots)                                | anyone who can read the game                      | neutral in the view when hidden, revoked in phase 2 (review F2)              |
| `conversations` / `conversation_participants`                                           | participants                                      | related only (shares a chat)                                                 |
| `notifications`                                                                         | the recipient                                     | game links only; no host id in player-facing content                         |
| `reviews`                                                                               | public                                            | minors are never reviewable (`my_reviewable`, PRIV-1)                        |
| `user_reports.reported_id`                                                              | the reporter                                      | game reports: filled from the game; closed to clients in phase 1 (review F3) |
| `minor_hosting_approvals`                                                               | the minor, approver, guardians                    | related only                                                                 |
| `skill_ratings`, `team_members`, `team_posts`, `post_comments`, `post_reactions`, reels | R1                                                | already hidden for minor hosts (sweep confirms)                              |
| RPC `get_game_organizer`                                                                | signed-in                                         | neutral for strangers (G4)                                                   |
| RPC `get_game_host_payment_methods`, `get_game_host_paypal`                             | signed-in / anon                                  | refuse a non-adult host id; return the payee's methods / merchant id only    |
| RPC `my_reviewable`                                                                     | adults                                            | excludes non-adults                                                          |
| RPC `host_attendance_stats(uuid)`, `player_activity_stats(uuid)`                        | signed-in                                         | take an id, return counts; no game linkage                                   |
| RPC `game_payee_id`                                                                     | service role only                                 | n/a                                                                          |
| Views                                                                                   | none existed                                      | two added                                                                    |

### Client call sites on `hosted_games` (55, tests excluded)

Counts by category: **20** server-side with the service role (unaffected by grants), **16** user/anon reads of
explicit columns without `host_id`/`image` (compatible with phase 2 as they are), **3** writes by id (compatible),
**16** migrated in this PR (6 `select("*")` reads, 7 "my games" filters on `host_id`, 2 reads of `host_id`, 1
upsert), plus 2 generic helpers found by the sweep (`account.hidden.tsx`, `data-export.functions.ts`) and the
realtime channel.

| File:line (after this PR)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Needs                                | Replacement                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `src/lib/hosted-games-store.ts:413` (fetchAll, `*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | the feed, organizer display, my-game | `hosted_games_public`; `hostUserId` from masked `host_id`, `viewerIsHost`, `organizerRef`        |
| `src/lib/hosted-games-store.ts:669` (org games, `*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | facility page                        | view                                                                                             |
| `src/lib/hosted-games-store.ts:691` (my hidden, `*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | profile                              | view                                                                                             |
| `src/lib/hosted-games-store.ts:724` (one game, `*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | game page                            | view                                                                                             |
| `src/lib/hosted-games-store.ts` realtime channel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | live feed                            | event = signal; changed ids re-read through the view (batched); payload host_id/image never used |
| `src/lib/hosted-games-store.ts:911` (claim, upsert)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | legacy local game                    | plain insert (an upsert's `EXCLUDED.host_id` needs SELECT on it after phase 2)                   |
| `src/components/LeaveFlowButton.tsx:109` (`*`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | start time, cutoff                   | `select("date, cancel_cutoff_min")` on the table                                                 |
| `src/lib/leave-game.ts:38` (`*`, host_id)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | notify the host                      | view; masked host → `notifyGameHost` server function                                             |
| `src/components/payments/UnpaidPlayersPanel.tsx:32`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | my paid games                        | view `.eq("viewer_is_host", true)`                                                               |
| `src/lib/reels.functions.ts:650`, `:897`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | games I host                         | view `viewer_is_host`                                                                            |
| `src/lib/use-needs-action.ts:107`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | games I host today                   | view `viewer_is_host`                                                                            |
| `src/lib/availability-conflicts.ts:89`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | games I host                         | view `viewer_is_host`                                                                            |
| `src/lib/availability-conflicts.ts:102` (selects host_id)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | hosting vs joined                    | view, `viewer_is_host`                                                                           |
| `src/lib/support/assistant.server.ts:114`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | "is a host" role flag                | view `viewer_is_host` (count)                                                                    |
| `src/routes/host.tsx:64`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | host dashboard                       | view `viewer_is_host`                                                                            |
| `src/lib/mcp/tools/list-nearby-games.ts:40` (host_id)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | API output                           | view (shapeGameForApi still drops youth host ids)                                                |
| `src/routes/account.hidden.tsx:43`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | my hidden games                      | view `viewer_is_host`                                                                            |
| `src/lib/data-export.functions.ts` (games_created)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | my games export                      | view `viewer_is_host`                                                                            |
| `MyWaitlistCard.tsx:25`, `SeriesSessionsStrip.tsx:36`, `skill.functions.ts:20`, `reels.functions.ts:669,699,917`, `game-reminders.functions.ts:32`, `use-needs-action.ts:24,63`, `city-pages.functions.ts:68,157,197`, `paypal.functions.ts:85`, `guardian-approvals.ts:95`, `_tabs.reels.tsx:760`, `games.$gameId.index.tsx:5448`                                                                                                                                                                                                                                                    | listed columns                       | unchanged (no host_id/image)                                                                     |
| `hosted-games-store.ts:669`(insert), `:870`(update), `:883`(delete)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | writes by id                         | unchanged                                                                                        |
| Service role: `athlete-progress.server.ts:13,42`, `guardian-activity.functions.ts:212`, `payment-alerts.functions.ts:29`, `player-card.functions.ts:86,137` (public profiles only; G4 keeps minor hosts private), `city-sitemap.server.ts:22`, `moderation.functions.ts:170,369,409`, `roster-on-payment.server.ts:19`, `player-passport.functions.ts:172,202,210`, `media-urls.functions.ts:42`, `paypal.functions.ts:22`, `payments.functions.ts:70`, `reel-game-privacy.ts:35`, `superadmin.functions.ts:217`, `join-guardian.server.ts:15`, `notifications.functions.ts:83` (new) | internal id for a privileged action  | unchanged; none returns a minor host's id to an unrelated caller                                 |

### Client call sites on `join_requests`

| File:line                                                                                                   | Replacement                                                                                    |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/lib/payments.ts:553` createJoinRequest                                                                 | insert without `host_id` and without `.select()`; read back through `join_requests_visible`    |
| `src/lib/payments.ts` resubmit (update `.select("*")`)                                                      | update, then re-read through the view                                                          |
| `src/lib/payments.ts` getMyJoinRequest, listMyJoinRequests                                                  | view                                                                                           |
| `src/lib/payments.ts` listHostJoinRequests (`.eq("host_id")`)                                               | view `.eq("viewer_is_host", true)`                                                             |
| `src/lib/use-needs-action.ts:51` (`.eq("host_id")`)                                                         | view `viewer_is_host`                                                                          |
| `src/routes/_tabs.profile.tsx` realtime `host_id=eq.` filter                                                | unfiltered (row security scopes it) + refresh; "mine" payloads merged without `host_id`        |
| `games.$gameId.index.tsx` join flow                                                                         | no host id needed; invite `from` checked only when the host is known; host notified via server |
| others (`UnpaidPlayersPanel.tsx:51`, `guardian-approvals.ts:77`, deletes/updates by id, service-role reads) | unchanged                                                                                      |

Host notifications that named the host from the client (request, instant join, leave, waitlist) now go through
`notifyGameHostOf`: direct when the host is known, otherwise the `notifyGameHost` server function looks the host up
with the service role and applies the same `can_notify` check and minor-safe wording, and never returns the id.

## Compatibility plan

**Phase 1 (this PR).** Additive. Old clients keep working unchanged (the table still answers them). New clients read
only the views for anything that touches the organizer. Visible changes, all for a host who is not a confirmed
adult seen by an unrelated viewer: the custom cover shows the sport artwork; the profile link, message-host and
host buttons are not offered (they were already hidden for neutral hosts on cards; Report game stays, see review F3); "games hosted" counts on
the game page do not group their games. A join request naming the wrong host is now corrected instead of refused
(test 340 updated accordingly).

**Phase 2 (separate approval).** Gate: this migration applied; the client build reading the views live for the
adoption window; owner approval; sandbox rehearsal. Then copy `supabase/phase2/sec5_phase2_close_host_id_columns.sql`
into a new timestamped migration. After it, an old cached bundle doing `select("*")` on `hosted_games` gets
`permission denied`. Before applying, re-run test 510 and the full suite on the target, and on staging confirm:
(a) realtime payloads lack `host_id`/`image`; (b) PostgREST inserts/updates with `return=minimal` do not return
those columns; (c) no Lovable-generated code reintroduced a direct read (`rg 'from\("hosted_games"\)' src` and check
each `select`).

**Lovable / client caching.**

- The hosted-games cache moved from `openrun.hostedGames.v2` (which held every host id read from the table) to
  `v3`; v2 is deleted on first load and listed as legacy in `client-storage-manifest.ts` (purged on identity change
  and cache epochs). `v3` is per-user state.
- `src/integrations/supabase/types.ts` gains the two views and `organizer_ref` by hand; a Lovable type
  regeneration will produce the same shape. Lovable must keep using `hosted_games_public` / `join_requests_visible`
  for reads and `viewer_is_host` for "my games"; a new `hosted_games` column has to be added to the view as well
  (test 510 fails otherwise).
- Signed cover URLs already cached in the browser (1 hour) keep working until they expire.

## Open items

1. Phase 2 is not applied; until it is, the base columns, realtime payloads and the Storage listing still carry the
   id for anyone who queries them by hand (the 510 "BEFORE phase 2" assertions pin exactly that).
2. ~~`game_payment_settings.host_id` readable by approved requesters~~: masked and closed in phase 2 (review F4).
3. `enforce_payment_destination` runs before the approval check, so any signed-in account can test whether an
   account is the payee of a game (for a minor host, the adult payment manager, usually a guardian). Fix the same way
   as join requests: fill the payee from the game.
4. The view computes the organizer per row with a definer lookup, and `viewer_is_host` filters scan the visible
   rows. Fine at today's size; an index-backed `my_hosted_games()` RPC would be the next step.
5. Strangers lose a minor-hosted game's custom cover. Storing minor covers under a neutral path
   (`game-covers/games/<organizer_ref>/...`) would give it back.
6. Everyone `can_see_minor_name` allows (including accepted followers and anyone who ever shared a game or chat)
   can link all of a minor's games; they already learn the name from `get_game_organizer`.
7. Realtime column stripping cannot be exercised locally (no Realtime schema in the stub); PostgREST `return=minimal`
   / `return=representation` / upsert / HEAD shapes are now pinned in SQL by 511. See "Phase 2 compatibility results"
   (sandbox procedures P1–P3) before phase 2.
8. No guard yet stops new client code from reading `host_id` from the table again before phase 2 lands (after
   phase 2 the database refuses it).
9. Unknown-age hosts are treated as not adult (masked), the same as the neutral snapshot rule.
10. No helper wrapped by SEC-2 is redefined, so `private_sec.wrap_oracle_helpers()` was not re-run.

## Final review (780eaf8f) corrections

The independent review of the combined build 780eaf8f demonstrated five findings as the API roles. All five are fixed
in place in the unapplied migration, the phase 2 script and test 510 (now 113 assertions; each finding's assertions
are prefixed `F1`–`F5`). The payment-insert payee oracle and `get_game_host_paypal` are being fixed separately on
another branch and are not touched here.

| #   | Severity | Finding                                                                                                                                                                                                                                      | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Tests (510)                                                                                                                                                                                                                                                                           |
| --- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | High     | The host wrote `game_position_waitlist.reviewed_by = uid`; the waitlisted person reads their own row and gets it in realtime payloads, so a stranger who only asked for a place learned a minor host's account id, before and after phase 2. | `a00_fill_waitlist_reviewer_trg` writes `reviewed_by` itself (the caller on a status/reviewed_at change, kept otherwise, NULL on insert; the service role keeps what it writes). The client no longer sends it. The column is closed to `anon`/`authenticated` **in phase 1**: no client reads it (`waitlist-store.ts` lists its columns, the data export too), and realtime drops columns the subscriber cannot SELECT. No view is needed because no client needs the value.                                                                       | A waitlist row reviewed by the minor host is in the sweep fixture; the reviewer named by the client is ignored; the waitlisted stranger finds 0 rows with `reviewed_by` = the host (and selecting it is refused) before phase 2; the stranger's sweep is `{}` after phase 2.          |
| F2  | Medium   | `hosted_games_public` passed a stored personal `host_snapshot` through (legacy rows; the SEC-1 neutralizing batch is never run by a migration).                                                                                              | `private_sec.game_organizer_for_caller` also returns `host_snapshot`: `minor_host_public_snapshot(...)` when the organizer is hidden, the stored value otherwise. It runs inside that definer function, so `minor_host_public_snapshot` stays service-role-only and the view keeps working after phase 2. Phase 2 also closes `hosted_games.host_snapshot` (no client reads it from the table; inserts and updates need only INSERT/UPDATE).                                                                                                        | A legacy row written in replica mode with `{"username":"teenhandle"}`: a stranger gets `{"name":"Youth host","neutral":true}`, the host their own; sweep for `teenhandle` is `{public.hosted_games}` before phase 2 and `{}` after.                                                   |
| F3  | Medium   | Report game was only offered when a host id was known (a moderation regression for minor-hosted games), and `reported_id` was the client's choice.                                                                                           | `a00_fill_game_report_subject_trg` (BEFORE INSERT, runs first) sets `reported_id` from `hosted_games.host_id` for `subject_type = 'game'` and ignores the client value; an unknown game with no `reported_id` is refused with `CONTENT_NOT_FOUND`; an id that is not a hosted game (legacy local game) keeps the client's value. `user_reports.reported_id` is closed to `authenticated` in phase 1 (the reporter's read policy would otherwise hand them the host). The client always offers Report game and never sends `reported_id` for a game. | A stranger's report without `reported_id` lives; a forged one is overwritten; both are stored against the real host; the reporter cannot select or filter by `reported_id` but still reads their reports; a missing game is refused; every other column stays readable.               |
| F4  | Low      | `game_payment_settings.host_id` named the minor host of a free game to an approved requester not on the roster.                                                                                                                              | Safer option chosen (mask, not widen `organizer_hidden_for`): `public.game_payment_settings_visible` (security_invoker) with `host_id` masked by the game's rule and `viewer_is_holder`; the definer helper answers only for a row the caller's read policy admits. The client reads settings through the view, saves by id instead of `upsert(onConflict: game_id,host_id)` (an upsert needs SELECT on `host_id`), and the data export filters on `viewer_is_holder`. Phase 2 closes the base column.                                              | The approved requester gets the row with `host_id` NULL; the holder and an adult payee's payer see the id; the requester's sweep lists `game_payment_settings` before phase 2 and is `{}` after; after phase 2 the host saves by id and an upsert on `(game_id, host_id)` is refused. |
| F5  | Low      | The dependency guard missed PAY-1's `private_sec.is_game_host(text)` and SEC-2's `private_sec.is_game_participant(text,uuid)`.                                                                                                               | Both added (plus `can_read_game_payment_settings`, `game_position_waitlist`, `user_reports` and `game_payment_settings`, which the corrections use).                                                                                                                                                                                                                                                                                                                                                                                                | 510 extracts the guard block from the migration file (psql backtick + `sed`), runs it as written, then renames each helper inside the rolled-back transaction: the guard stops with the release message each time and passes with both present.                                       |

**Compatibility-plan changes.**

- Phase 1 now closes two columns to `anon`/`authenticated` itself: `user_reports.reported_id` and
  `game_position_waitlist.reviewed_by` (catalog-driven: the table-level SELECT is replaced by a grant on every other
  column, and the migration fails if either is still readable). Nothing in the current or older clients reads them;
  moderators read reports with the service role. A column added to either table later must be granted to
  `authenticated` explicitly (510 checks `user_reports`). A moderator querying `user_reports.reported_id` directly
  as `authenticated` is refused; moderation tools already use the service role.
- Phase 2 additionally closes `hosted_games.host_snapshot` and `game_payment_settings.host_id`, and its verify step
  checks all seven closed columns. Add to the pre-phase-2 staging checks: (d) the settings screen saves (update by
  id / insert) with the new build, and no client upserts `game_payment_settings`; (e) an old cached bundle doing
  `select("*")` on `game_payment_settings` will get `permission denied` after phase 2, like `hosted_games`.
- New client read path: `game_payment_settings_visible` (Lovable must keep using it and `viewer_is_holder`; a new
  `game_payment_settings` column must be added to the view too, 510 checks). `src/integrations/supabase/types.ts`
  gains it by hand.
- Report game is offered to every viewer who is not the host, whether or not the host is shown.

**Open items from this round.**

- `private_sec.game_organizer_for_caller(game)` answers for any game id, including one the caller's row security
  would not return (it returns the adult host id of such a game). It is not reachable through the API (private_sec
  is not exposed), and the new payment-settings helper checks the read policy; consider the same check there.
- A game report against an id that is not a hosted game still takes `reported_id` from the client (legacy local
  games); it is a report like any user report and moderators see it as such.
- Realtime payloads of `game_payment_settings`, `hosted_games` and `join_requests` still carry the closed columns
  until phase 2 (the app treats them as signals only).

## Phase 2 compatibility results

**Status: the privacy release is NOT complete.** Until phase 2 is applied, a direct API read (PostgREST, a hand-made
Realtime subscription, or the Storage listing) of `hosted_games.host_id`, `hosted_games.image`,
`hosted_games.host_snapshot`, `join_requests.host_id` and `game_payment_settings.host_id` still hands a minor host's
account id to an unrelated signed-in account. Phase 1 masks only what this branch's client reads. Phase 2 is the step
that closes those reads, and it needs **owner approval**. It must not be applied before the old-client population is
measured as gone (see "Phase 2 rollout" below).

Evidence: `scripts/sec5-client-query-inventory.mjs` produces the inventory
`docs/privacy/sec5-client-query-inventory.json`, and `supabase/tests/511_sec5_phase2_compat_matrix.test.sql` holds
the matrix: 85 probes; 178 assertions in states b/c/r, 87 in state a. 510 is unchanged (113). The full DB suite
passes (2553). Phase 2 and its rollback ran only inside rolled-back test transactions on local scratch databases.

### 1. Client query inventory (generated, not hand-written)

`node scripts/sec5-client-query-inventory.mjs` parses every non-test `.ts`/`.tsx` file under `src/` with the
TypeScript compiler API. It covers the OLD client (`origin/staging/priv-rehearsal-r4`, read with `git show`) and the
NEW client (this working tree). It records each:

- `.from(<table>)` chain, resolving string constants, `GAMES_READ`/`JOIN_REQUESTS_READ`, template literals and
  options objects passed by name;
- generic config-driven loop (`data-export`, `superadmin`, `image-moderation`);
- `.on("postgres_changes", …)`, with its channel.

For each one it records the select columns, filters, modifiers, write payload keys (resolved through builder
functions and variables), `on_conflict`, `returning`, count/head, the API role, and a predicted phase-1/phase-2
outcome. `--check` exits 1 when the committed JSON is stale.

| Build              | Entries | As API roles (browser / server fn with user token / anon server) | Service role | Realtime | Predicted to break in phase 2                   |
| ------------------ | ------- | ---------------------------------------------------------------- | ------------ | -------- | ----------------------------------------------- |
| OLD (r4, c637ec5e) | 114     | 73 (55 / 15 / 3)                                                 | 41           | 11       | **28** queries + 1 realtime filter on `host_id` |
| NEW (this branch)  | 121     | 79 (60 / 16 / 3)                                                 | 42           | 11       | **0**                                           |

The service role is unaffected by grants. No receiver is unresolved. The old client's 28 breaking calls fall into six
shapes:

- `select=*` on the three tables (10 calls);
- a `host_id` filter (11, one of them a count HEAD);
- `host_id` in a column list (3);
- `RETURNING *` on `join_requests` (2);
- an upsert on `hosted_games` (claim, `on_conflict=id` with `host_id`/`image`/`host_snapshot` in the payload);
- an upsert on `game_payment_settings` (`on_conflict=game_id,host_id`).

The JSON lists each call with file, line and reason (`old.summary.phase2Breaks`).

Server functions that run with the user's session (`context.supabase`, the MCP tool's bearer client, the support
assistant) ship with the server, so they change at deploy, not over an adoption window. Only browser bundles (open
tabs, installed PWAs, Lovable previews built from older commits) are "old clients".

### 2. Compatibility matrix

Each probe is the SQL PostgREST generates for the call, run as the API role that sends it (`t.as_user`/`t.as_anon`),
in its own rolled-back savepoint. The states are:

- **(a)** the pre-release schema: r4 `c637ec5e` replayed into scratch DB `t4a`, with 511 run by hand
  (`psql -d t4a -f supabase/tests/511_…`); the file detects the missing views and runs only the a-column;
- **(b)** SEC-5 phase 1;
- **(c)** phase 1 + phase 2 applied in the test transaction;
- **(r)** phase 2 followed by `supabase/phase2/sec5_phase2_rollback.sql`, which must equal (b) for every probe, and
  does.

Old- and new-client calls appear as separate rows, so the "old client against (b)/(c)" and "new client against
(b)/(c)" cells can be read directly. **LEAK** means the minor host's id (or their legacy username) was in what came
back, or an oracle filter on it matched, for a caller who is not related to them.

| ID  | Client | Call (actor)                                                                                   | (a) r4          | (b) phase 1    | (c) phase 1+2  | Error / note                                                                                                                                     |
| --- | ------ | ---------------------------------------------------------------------------------------------- | --------------- | -------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| O01 | old    | feed: hosted_games select=* (stranger)                                                         | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O02 | old    | game page: select=* eq id (stranger)                                                           | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O03 | old    | logged-out feed: select=* (anon; sees no youth game)                                           | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O04 | old    | my games: eq(host_id, me) (minor host)                                                         | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O05 | old    | conflicts: select ..., host_id in(id) (rostered player)                                        | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O06 | old    | MCP list-nearby: select includes host_id (stranger, server fn with user token)                 | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O07 | old    | claim legacy game: upsert on_conflict=id with host_id,image,host_snapshot (adult host)         | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| O08 | old    | ask to join: insert naming host_id, return=representation (RETURNING *)                        | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table join_requests                                                                                                    |
| O09 | old    | resubmit: update ... RETURNING * (requester)                                                   | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table join_requests                                                                                                    |
| O10 | old    | my requests: join_requests select=* eq(player_id) (requester)                                  | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table join_requests                                                                                                    |
| O11 | old    | host inbox: select=* eq(host_id, me) eq(status) (minor host)                                   | ok              | ok             | denied (42501) | (c) permission denied for table join_requests                                                                                                    |
| O12 | old    | needs-action: game_id, created_at eq(host_id) (minor host)                                     | ok              | ok             | denied (42501) | (c) permission denied for table join_requests                                                                                                    |
| O13 | old    | host reviews: update status by id, return=minimal (minor host)                                 | ok              | ok             | ok             |                                                                                                                                                  |
| O14 | old    | settings: game_payment_settings select=* eq(game_id) (approved requester)                      | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table game_payment_settings                                                                                            |
| O15 | old    | my settings: select=* eq(game_id) eq(host_id, me) (minor host)                                 | ok              | ok             | denied (42501) | (c) permission denied for table game_payment_settings                                                                                            |
| O16 | old    | save settings: upsert on_conflict=game_id,host_id (minor host)                                 | ok              | ok             | denied (42501) | (c) permission denied for table game_payment_settings                                                                                            |
| O17 | old    | host reviews a place, sending reviewed_by (minor host)                                         | ok              | ok             | ok             |                                                                                                                                                  |
| O18 | old    | report game naming reported_id (stranger)                                                      | ok              | ok             | ok             |                                                                                                                                                  |
| B01 | both   | explicit columns without host_id: select price eq id (stranger)                                | ok              | ok             | ok             |                                                                                                                                                  |
| B02 | both   | city pages: listed columns (anon server client)                                                | ok              | ok             | ok             |                                                                                                                                                  |
| B03 | both   | create game: insert incl. host_id/image/host_snapshot, return=minimal (adult host)             | ok              | ok             | ok             |                                                                                                                                                  |
| B04 | both   | edit game: update by id, return=minimal (adult host)                                           | ok              | ok             | ok             |                                                                                                                                                  |
| B05 | both   | delete game by id (adult host)                                                                 | ok              | ok             | ok             |                                                                                                                                                  |
| B06 | both   | cancel game: rpc host_cancel_game (adult host)                                                 | ok              | ok             | ok             |                                                                                                                                                  |
| B07 | both   | minor host edits own game by id                                                                | ok              | ok             | ok             |                                                                                                                                                  |
| B08 | both   | host declines: update status rejected by id (minor host)                                       | ok              | ok             | ok             |                                                                                                                                                  |
| B09 | both   | requester withdraws: delete eq game_id, player_id, status                                      | ok              | ok             | ok             |                                                                                                                                                  |
| B10 | both   | approved players: game_id, player_id eq(status) in(game_id) (minor host)                       | ok              | ok             | ok             |                                                                                                                                                  |
| B11 | both   | guardian queue: listed columns in(player_id) (guardian)                                        | 0 rows          | 0 rows         | 0 rows         |                                                                                                                                                  |
| B12 | both   | player joins a waitlist (insert, return=minimal)                                               | ok              | ok             | ok             |                                                                                                                                                  |
| B13 | both   | host reads the waitlist (listed columns) (minor host)                                          | ok              | ok             | ok             |                                                                                                                                                  |
| B14 | both   | player reads own places (listed columns)                                                       | ok              | ok             | ok             |                                                                                                                                                  |
| B15 | both   | host declines a place: update by id, no reviewed_by (minor host)                               | ok              | ok             | ok             |                                                                                                                                                  |
| B16 | both   | host removes a place: delete (minor host)                                                      | ok              | ok             | ok             |                                                                                                                                                  |
| B17 | both   | host reads roster (policy uses host_id) (minor host)                                           | ok              | ok             | ok             |                                                                                                                                                  |
| B18 | both   | host removes a participant (minor host)                                                        | ok              | ok             | ok             |                                                                                                                                                  |
| B19 | both   | requester reads a private game (policy sub-selects join_requests) (asker)                      | ok              | ok             | ok             |                                                                                                                                                  |
| B20 | both   | reporter reads own reports (data-export columns)                                               | ok              | ok             | ok             |                                                                                                                                                  |
| B21 | both   | stranger edits a minor's game (row security: 0 rows)                                           | 0 rows          | 0 rows         | 0 rows         |                                                                                                                                                  |
| B22 | both   | stranger creates a game naming another host (WITH CHECK)                                       | denied (42501)  | denied (42501) | denied (42501) | (c) new row violates row-level security policy for table "hosted_games"; (a) new row violates row-level security policy for table "hosted_games" |
| B23 | both   | stranger approves a request on a minor's game (0 rows)                                         | 0 rows          | 0 rows         | 0 rows         |                                                                                                                                                  |
| B24 | both   | stranger cancels a minor's game (rpc refuses)                                                  | error:P0001     | error:P0001    | error:P0001    | (c) Only the host can cancel this game.; (a) Only the host can cancel this game.                                                                 |
| B25 | both   | stranger reviews a minor host's waitlist (0 rows)                                              | 0 rows          | 0 rows         | 0 rows         |                                                                                                                                                  |
| N01 | new    | feed: hosted_games_public select=* (stranger)                                                  | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N02 | new    | game page: view select=* eq id (stranger, minor host masked)                                   | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N03 | new    | legacy personal snapshot through the view (stranger)                                           | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N04 | new    | logged-out feed: view select=* (anon)                                                          | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N05 | new    | my games: view eq(viewer_is_host) (minor host)                                                 | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N06 | new    | support assistant: HEAD count=exact select=id on the view (minor host)                         | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N07 | new    | leave flow: view host_id, title, date eq id (rostered player sees the host)                    | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N08 | new    | leave button: date, cancel_cutoff_min on the table                                             | ok              | ok             | ok             |                                                                                                                                                  |
| N09 | new    | MCP list-nearby: view columns incl. host_id (stranger)                                         | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N10 | new    | ask to join: insert without host_id, return=minimal                                            | error:23502     | ok             | ok             | (a) null value in column "host_id" of relation "join_requests" violates not-null constraint                                                      |
| N11 | new    | my requests: join_requests_visible select=* (requester)                                        | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N12 | new    | host inbox: view eq(viewer_is_host) eq(status) (minor host)                                    | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N13 | new    | resubmit: update by id, return=minimal, re-read through the view (requester)                   | ok              | ok             | ok             |                                                                                                                                                  |
| N14 | new    | settings: game_payment_settings_visible select=* (approved requester)                          | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N15 | new    | my settings: view eq(viewer_is_holder) (minor host)                                            | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N16 | new    | save settings: update by id (minor host)                                                       | ok              | ok             | ok             |                                                                                                                                                  |
| N17 | new    | first save: insert with host_id, return=minimal (adult host, free family game)                 | ok              | ok             | ok             |                                                                                                                                                  |
| N18 | new    | payer reads an adult payee's settings through the view                                         | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N19 | new    | report game without reported_id (stranger)                                                     | error:23502     | ok             | ok             | (a) null value in column "reported_id" of relation "user_reports" violates not-null constraint                                                   |
| N20 | new    | invitee opens the game page from a personal invite (stranger; masked host, from-check skipped) | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| N21 | new    | invitee checks from= against an adult host's id through the view                               | missing (42P01) | ok             | ok             |                                                                                                                                                  |
| D01 | direct | GET hosted_games?select=host_id (stranger)                                                     | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D02 | direct | GET hosted_games?select=image (cover path) (stranger)                                          | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D03 | direct | GET hosted_games?select=host_snapshot (legacy username) (stranger)                             | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D04 | direct | GET hosted_games?select=id&host_id=eq.<minor> (oracle: lists all their games) (stranger)       | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D05 | direct | GET hosted_games?select=id&order=host_id (stranger)                                            | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D06 | direct | GET join_requests?select=host_id (own request) (requester)                                     | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table join_requests                                                                                                    |
| D07 | direct | GET game_payment_settings?select=host_id (approved requester)                                  | **LEAK**        | **LEAK**       | denied (42501) | (c) permission denied for table game_payment_settings                                                                                            |
| D08 | direct | GET user_reports?select=reported_id (reporter)                                                 | **LEAK**        | denied (42501) | denied (42501) | (c) permission denied for table user_reports                                                                                                     |
| D09 | direct | GET game_position_waitlist?select=reviewed_by (waitlisted player)                              | **LEAK**        | denied (42501) | denied (42501) | (c) permission denied for table game_position_waitlist                                                                                           |
| D10 | direct | join request naming a guessed host (yes/no oracle) (stranger)                                  | denied (42501)  | ok             | ok             | (a) host_id does not match the game host.                                                                                                        |
| D11 | direct | storage: list game-covers/<minor id>/ (stranger)                                               | **LEAK**        | **LEAK**       | ok             |                                                                                                                                                  |
| D12 | direct | HEAD hosted_games?select=* count=exact, as PostgREST builds it (stranger)                      | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D13 | direct | HEAD hosted_games?select=id count=exact (stranger)                                             | ok              | ok             | ok             |                                                                                                                                                  |
| D14 | direct | POST hosted_games return=representation (RETURNING *) (adult host)                             | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D15 | direct | POST hosted_games return=representation select=id (RETURNING id) (adult host)                  | ok              | ok             | ok             |                                                                                                                                                  |
| D16 | direct | PATCH hosted_games?id=eq return=representation (RETURNING *) (adult host)                      | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D17 | direct | PATCH hosted_games?host_id=eq.<me> (filter on the closed column) (adult host)                  | ok              | ok             | denied (42501) | (c) permission denied for table hosted_games                                                                                                     |
| D18 | direct | upsert on_conflict=id, payload without closed columns (adult host)                             | ok              | ok             | ok             |                                                                                                                                                  |
| D19 | direct | upsert on_conflict=id ignore-duplicates (DO NOTHING), payload with host_id (adult host)        | 0 rows          | 0 rows         | 0 rows         |                                                                                                                                                  |
| D20 | direct | upsert on_conflict=game_id,host_id, SET without host_id (arbiter only) (minor host)            | ok              | ok             | denied (42501) | (c) permission denied for table game_payment_settings                                                                                            |
| D21 | direct | GET hosted_games?select=count() / bare count(*) (stranger)                                     | ok              | ok             | ok             |                                                                                                                                                  |

**Release blocker, as 511 asserts it:**

- **Old-client calls that break after phase 2 (c):** O01–O12 and O14–O16. These are the feed, game page and
  logged-out feed (`select=*`); "my games" and the host inbox (filters on `host_id`); the conflicts check and the
  MCP tool (`host_id` in the column list); legacy claim (upsert); ask-to-join and resubmit (`RETURNING *`); "my
  requests" (`select=*`); and payment settings read and save (`select=*`, upsert on `game_id,host_id`). In an old
  bundle that means:
  - the feed, game pages and the host dashboard fail to load;
  - asking to join fails after the row is written, so the user sees an error for a request that exists;
  - payment settings can be neither read nor saved.
- **What still works in an old bundle after phase 2:** request review (O13), waitlist review (O17), game reports
  (O18), and every shared call (B01–B25).
- **Direct-API reads that still expose the minor host's id before phase 2 (b):**
  - D01 `hosted_games?select=host_id`;
  - D02 `select=image` (the cover path);
  - D03 `select=host_snapshot` (a legacy personal snapshot: username);
  - D04 `select=id&host_id=eq.<minor>` (lists every game the minor hosts);
  - D06 `join_requests?select=host_id` (any requester);
  - D07 `game_payment_settings?select=host_id` (approved requester);
  - D11 the `game-covers` Storage listing;
  - the old client's own O01/O02/O06/O08/O09/O10/O14.

  All are closed in (c). D08 (`user_reports.reported_id`) and D09 (`game_position_waitlist.reviewed_by`) leaked in
  r4 and are already closed by phase 1.

- **New client:** no call fails or leaks in (b) or (c). Against the pre-release schema (a) it does fail: views
  missing (N01–N07, N09, N11, N12, N14, N15, N18, N20, N21), and join requests and game reports violate NOT NULL
  (N10, N19). **Deploy order: migration 20261108110000 first, then publish the client.**

PostgREST behaviours pinned by the matrix (all as `authenticated`; PostgreSQL's message names the table even for a
column grant):

| Behaviour                                                                      | (b) | (c)                                     | Probe              |
| ------------------------------------------------------------------------------ | --- | --------------------------------------- | ------------------ |
| `select=*` on a table with a revoked column                                    | ok  | `permission denied for table …` (42501) | O01–O03            |
| `select=id` (only granted columns)                                             | ok  | ok                                      | B01, D13           |
| filter `host_id=eq.X` / `order=host_id` / `PATCH ?host_id=eq.`                 | ok  | 42501                                   | D04, D05, D17      |
| HEAD `count=exact` with `select=*` (pgrst_source still selects `t.*`)          | ok  | 42501                                   | D12                |
| HEAD `count=exact` with `select=id`, or bare `count(*)`                        | ok  | ok                                      | D13, D21, N06      |
| `return=representation` (`RETURNING t.*`) on insert / update                   | ok  | 42501, and the statement is rolled back | D14, D16, O08, O09 |
| `return=representation&select=id` (`RETURNING id`)                             | ok  | ok                                      | D15                |
| `return=minimal` (`RETURNING 1`) with `host_id` in the payload                 | ok  | ok (INSERT/UPDATE grants unchanged)     | B03, N17           |
| upsert, `on_conflict=id`, payload columns all open                             | ok  | ok                                      | D18                |
| upsert with a closed column in `SET … = EXCLUDED.col`                          | ok  | 42501                                   | O07, O16           |
| upsert whose **arbiter** names a closed column (`on_conflict=game_id,host_id`) | ok  | 42501 even if SET omits it              | D20                |
| `resolution=ignore-duplicates` (`ON CONFLICT DO NOTHING`)                      | ok  | ok                                      | D19                |

Inventory shape → probe: `select=*` → O01–O03, O10, O14; `filter:host_id` → O04, O11, O12, O15; `select:host_id`
→ O05, O06; `returning=*` → O08, O09; `upsert|on_conflict=id` → O07; `upsert|on_conflict=game_id,host_id` → O16;
`*|open-columns` → B01–B20, N08, N13, N16, N17, N19; views → N01–N07, N09, N11, N12, N14, N15, N18, N20, N21.

The modelled SQL forms (the `pgrst_source` CTE for HEAD, `RETURNING 1` for minimal) follow PostgREST v12's query
builder. Confirm them on the sandbox with real HTTP requests (procedure P1 below).

### 3. Realtime (sandbox-only)

The local stub (`supabase/tests/support/supabase-stub.sql`) creates only the `supabase_realtime` publication,
`realtime.messages` and `realtime.topic()`. It has no `realtime.subscription`, `apply_rls`, `list_changes` or
`subscription_check_filters`, so per-subscriber behaviour **cannot be tested locally** and is marked sandbox-only.

Publication membership:

| Table                          | Added to `supabase_realtime` by                        | Replica identity | Production (coordinator, read-only catalog) |
| ------------------------------ | ------------------------------------------------------ | ---------------- | ------------------------------------------- |
| `hosted_games`                 | `20260704231101_b34834b3…` (+ `REPLICA IDENTITY FULL`) | FULL             | in publication                              |
| `join_requests`                | `20260704021516_2d465f59…`                             | default (pk)     | in publication                              |
| `game_position_waitlist`       | `20260713170901_b1c3d2fd…` (+ `REPLICA IDENTITY FULL`) | FULL             | in publication                              |
| `game_payment_settings`        | `20260715191330_65d69cb5…`                             | default (pk)     | in publication                              |
| `user_reports`, `team_invites` | not in any migration                                   | n/a              | not in publication                          |

No migration drops a table from the publication. The local replay agrees (`pg_publication_tables`).

Behaviour, read from Realtime's own SQL (`supabase/realtime` main @ `6c829e60`,
`priv/repo/tenant_schema/realtime/functions/{apply_rls,subscription_check_filters,is_visible_through_filters,build_prepared_statement_sql}.sql`).
The production Realtime version is not known here, so P2 must confirm it:

- **Payload columns follow column privileges.** `apply_rls` computes `is_selectable =
has_column_privilege(<subscriber role>, entity, col, 'SELECT')` for every column, and `record`/`old_record` include
  only selectable columns.
  - After phase 2, `authenticated`/`anon` subscribers lose `host_id`, `image` and `host_snapshot` (`hosted_games`,
    including `old_record` on UPDATE, since the table is REPLICA IDENTITY FULL), and `host_id` on `join_requests` and
    `game_payment_settings`.
  - `game_position_waitlist.reviewed_by` is already stripped in phase 1.
  - DELETE payloads on these RLS tables carry only the primary key either way.
- **Before phase 2 this is a direct exposure path.** A hand-made subscription to `hosted_games` with no filter gets
  `host_id`, `image` and `host_snapshot` of every youth game the subscriber's row security admits, on every insert and
  update. A requester subscribed to `join_requests`, or to `game_payment_settings` filtered by game, gets the host's
  id the same way.
- **The row-security check needs only the primary key.** `build_prepared_statement_sql` runs `select exists(select 1
from <table> where <pk> = …)` as the subscriber. `id` stays granted, so no table hits the "401 Unauthorized" or
  "no primary key" branch after phase 2.
- **A filter on a revoked column is refused at subscribe time.** `subscription_check_filters` builds the list of
  allowed filter columns from `has_column_privilege(claims role, …, 'SELECT')` and raises `invalid column for filter
host_id`.
  - So after phase 2 the OLD client's profile channel `profile-join-requests-<id>`, which binds `join_requests`
    with `filter: host_id=eq.<id>` (`_tabs.profile.tsx:224` in r4), **fails to subscribe**. Realtime inserts the
    channel's postgres_changes bindings together, so its `player_id` binding most likely fails with it (P2 confirms).
    The old profile page then stops getting live request updates; its initial reads already fail (O10/O11).
  - A subscription created **before** phase 2 is not re-validated: `is_visible_through_filters` still evaluates the
    filter against the WAL value, whatever the privilege, so it keeps delivering events (without the column) until
    the socket rejoins.
- **Every other subscription keeps working**, old and new alike: filters on `game_id`, `player_id`, or no filter (11
  bindings each, in the inventory).
  - The new client treats `hosted_games`/`join_requests` events as signals and re-reads through the views, so it
    loses nothing.
  - An old bundle that merges `payload.new` into its store (r4 `hosted-games-store.ts`) receives games without
    `host_id`, so its "my game" state can be wrong until it reloads. Its reads fail anyway in (c).

**P2: Realtime sandbox procedure** (sandbox project with this branch's migrations; never production):

1. Users: a minor host H (17, with a guardian), an unrelated adult S, a requester R. H hosts youth game G (custom
   cover, payment settings `requires_approval`); R has a pending request on G.
2. Before phase 2, with supabase-js signed in as S, subscribe
   `channel('t1').on('postgres_changes', {event:'*', schema:'public', table:'hosted_games'})`. As R, subscribe to
   `join_requests` with `filter: player_id=eq.<R>`, and to `game_payment_settings` with `filter: game_id=eq.G`. As H,
   update G's title, update R's request message, and save the settings.
   - Expect S's and R's payloads to contain `host_id` (and `image`/`host_snapshot` on `hosted_games`). This
     confirms the pre-phase-2 exposure.
3. As S, subscribe `join_requests` with `filter: host_id=eq.<H>` and with `filter: player_id=eq.<S>` on one channel.
   Record whether it reaches `SUBSCRIBED`.
4. Apply phase 2 (the sandbox's copy of the migration). Without reconnecting, repeat the writes. The pre-existing
   subscriptions should still receive events, and `host_id`/`image`/`host_snapshot` should be absent.
5. Reconnect every client (or `removeChannel` + subscribe), then repeat steps 2 and 3. Expect:
   - every payload lacks the closed columns;
   - the `host_id=eq.` channel gets `CHANNEL_ERROR` with `invalid column for filter host_id`; note whether its
     `player_id` binding survives;
   - unfiltered and `game_id`/`player_id` channels are `SUBSCRIBED` and deliver.
6. In the database, `select * from realtime.subscription where entity in ('public.hosted_games'::regclass,
'public.join_requests'::regclass)` shows the stored filters and claims role. Repeat with an old (r4) build in one
   tab and the new build in another, and record the console errors of each.
7. Apply the rollback script and repeat steps 3 and 5. The `host_id` filter subscribes again.

### 4. GraphQL

- `pg_graphql` is **not** in the replayed schema: the stub does not create it, and no migration in either folder
  creates, enables or drops it. The only mention is SEC-2's prerequisite comment in
  `20261103150000_helper_oracle_containment.sql`: "pg_graphql must be disabled or must not reflect public
  functions".
- **Production (coordinator, read-only):** PostgreSQL 17.6. The installed extensions are `pg_cron` 1.6.4, `pg_net`
  0.20.3, `pg_stat_statements` 1.11, `pgcrypto` 1.3, `plpgsql`, `supabase_vault` 0.3.1 and `uuid-ossp` 1.1;
  **`pg_graphql` is not installed.** GraphQL is not a current exposure path.
- **If it were enabled:** pg_graphql "fully respects builtin PostgreSQL role and row security … revoking `SELECT`
  access on a table's column will remove that field from the associated GraphQL type"
  (`supabase/pg_graphql` `docs/security.md` @ `29ce5f1c`).
  - Before phase 2, `hostedGamesCollection { node { hostId image hostSnapshot } }` and a `filter: {hostId: {eq: …}}`
    would expose and enumerate exactly as D01–D04 do.
  - After phase 2 those fields, and `hostId` on `JoinRequests`/`GamePaymentSettings`, disappear from the schema for
    `anon`/`authenticated`. `insert…Collection` would keep `hostId` in its input type (INSERT grant), but `records`
    could not return it.
  - The SEC-5 views would be reflected only with a `@graphql({"primary_key_columns": …})` comment, which none has.
- **Sandbox check (P3):** enable `pg_graphql` in a sandbox and introspect `HostedGames` as `authenticated` before and
  after phase 2. Run the collection query with `hostId` and the `hostId` filter. Expect the field before, and
  "Unknown field" after. Then drop the extension again.
- **Production read-only check (coordinator), before phase 2 and again before any enablement:**
  `select extname, extversion from pg_extension where extname = 'pg_graphql';` and
  `select nspname from pg_namespace where nspname in ('graphql', 'graphql_public');` (both empty today). If the
  extension is ever enabled, re-run P3 against that configuration first, and revisit SEC-2's function-reflection
  prerequisite.

### 5. Ownership, organizer authorization, roster, waitlist, invitations: workflows

These run in 511 as the new client's exact calls, in (b) and (c), and as the shared calls in (a). All pass, and none
needed a fix:

| Workflow                        | Probes                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Create / edit / cancel / delete | B03, B04, B07, B06 (`host_cancel_game`, definer), B05; claim legacy game as plain insert (B03 shape)                                                                                                                     |
| Organizer authorization         | B21 stranger edit (0 rows), B22 insert naming another host (RLS 42501), B23 stranger approves (0 rows), B24 stranger cancels (P0001 "Only the host can cancel"), B25 stranger reviews waitlist (0 rows)                  |
| Join: ask / approve / decline   | N10 (no `host_id`, filled by the database), O13/B08 review by id, B09 withdraw, N11/N12 read through `join_requests_visible`, N13 resubmit by id                                                                         |
| Waitlist approve / decline      | B12 join, B13/B14 read listed columns, B15 decline, O17 old-client review sending `reviewed_by` (ignored), B16 remove                                                                                                    |
| Roster                          | B17 host reads the roster, B18 host removes a participant (policies through `is_game_host`), B19 private game read by a requester (policy sub-select on `join_requests`, open columns)                                   |
| Invitations on game pages       | N20 invitee reads a minor-hosted game through the view (masked, `organizer_hidden`; `inviteMatchesHost` skips the `from` check), N21 the `from` check against an adult host's id through the view, then N10 asks to join |
| Report a game                   | N19 without `reported_id` (filled by the database), O18 old client naming it (overwritten), B20 reporter reads own reports                                                                                               |
| Payment settings                | N14/N18 read through the view, N15 "my settings", N16 save by id, N17 first save as insert (`return=minimal`)                                                                                                            |

Catalog sweep (t4o): no SECURITY INVOKER function in `public`/`private_sec` reads a closed column of these tables.
The invoker triggers on them (`validate_hosted_game_policy`, `fill_waitlist_reviewer`, `validate_content_report`,
`touch_updated_at`) read only `NEW`/`OLD`. The only views over them are the three SEC-5 views. Every policy that
sub-selects another of these tables reads open columns (`join_requests.game_id`/`player_id`).

**Changes in this round:**

- No breakage was found in the new client or the migration.
- Added the minimum-client-generation gate (§6).
- Added the phase-2 rollback script and the 511 matrix.
- Added the inventory script and its JSON.

### 6. Phase 2 rollout

**Version gating.** Before this round no build-version or minimum-version mechanism existed. What existed:

- public `app_settings` flags that every build polls (`MaintenanceGate`, `maintenance`);
- reload-once on a stale chunk or a stale server-function id (`__root.tsx`);
- the storage-purge epoch;
- no service worker cache of the app shell (`OneSignalSDKWorker.js` sends navigations to the network), so any reload
  loads the current bundle.

This round adds `src/lib/client-generation.ts` and `src/components/ClientGenerationGate.tsx`:

- the build declares `CLIENT_DATA_GENERATION = 5` ("reads organizers only through the views");
- the gate reads the public `app_settings.client_min_generation` row (`{"min": n, "message": "…"}`), re-reading it
  every 15 minutes and on focus;
- a build below `min` reloads once per 10 minutes (sessionStorage guard) and otherwise shows "Update available";
- 511 checks that anon and signed-in users can read the row.

**Limit:** r4 and older bundles do not contain the gate, so it cannot retire them. For SEC-5 the gate only protects
later builds. Raising the flag is a live data change, so ship it as a migration
(`INSERT … ('client_min_generation', '{"min":5}', …, true) ON CONFLICT (key) DO UPDATE …`) together with, or before,
phase 2.

**Order and adoption window.**

1. Apply 20261108110000 (phase 1).
2. Publish this build (Lovable publish). It must come after the migration: (a) shows the new client fails on the old
   schema.
3. Run the **adoption window**: at least **14 days** after publish (installed PWAs and long-lived tabs), and
   continuing until the old-client measurement below shows **zero old-client fingerprints for 7 consecutive days**.
   Whichever is later.
4. Re-run the preflight.
5. Sandbox rehearsal: P1 (PostgREST over HTTP with an r4 build and this build), P2 (Realtime), P3 (GraphQL, if it is
   ever enabled), and the full `bun run test:db` on a migration copy of the phase-2 file.
6. **Owner approval.**
7. Apply phase 2 as a new timestamped migration, with `lock_timeout` set.
8. Run the post-apply checks.

Expected user impact on a straggler after (c): its feed or game page errors; the root error panel's "Try again"
reloads, which loads the current build. A payment-settings save or a join request from that old tab fails once with
"permission denied" (the join request is written, but the client reports an error).

**Measuring that old clients are gone** (read-only). The fingerprints come from the inventory: requests the new
client never sends to a base table.

- **Supabase API (edge) logs**, the primary source. Count per day the requests on `/rest/v1/hosted_games`,
  `/rest/v1/join_requests` and `/rest/v1/game_payment_settings` whose query string has `select=*` (or `%2A`), any
  `host_id=`, `on_conflict=id` (hosted_games) or `on_conflict=game_id,host_id`. Logs Explorer template:
  `select timestamp_trunc(timestamp, day) d, r.method, r.path, count(*) n from edge_logs cross join unnest(metadata) m
cross join unnest(m.request) r where r.path in ('/rest/v1/hosted_games','/rest/v1/join_requests','/rest/v1/game_payment_settings')
and regexp_contains(r.search, r'select=(\*|%2A)|host_id=|on_conflict=(id|game_id(%2C|,)host_id)') group by 1,2,3 order by 1`.
  The new client sends none of these. Server functions using the service role do not go through the API gateway.
  Hand-written attacker requests also match, so a small residue is not proof of an old bundle; look at user agents
  and referers.
- **`realtime.subscription`** (read-only, production DB). This counts live subscriptions that filter on a column
  phase 2 closes. Only the old profile page creates them:
  `select entity::regclass, count(*) from realtime.subscription where exists (select 1 from unnest(filters) f where
f.column_name in ('host_id','image','host_snapshot')) group by 1;`.
- **`pg_stat_statements`** (installed in production) as a secondary signal. Take deltas over a day of `calls` for
  statements containing `"public"."hosted_games".*`, `"public"."join_requests".*` or `"host_id" =` against these
  tables, and `ON CONFLICT("game_id", "host_id")`. Server-side service-role code also runs `select *` on
  `hosted_games` (`superadmin.server.ts` counts), so split by `userid`. Verify in the sandbox which role
  `pg_stat_statements` records for a PostgREST request before relying on it.

**Phase-2 preflight** (read-only, on the target, immediately before applying):

```sql
-- phase 1 present
select to_regclass('public.hosted_games_public'), to_regclass('public.join_requests_visible'), to_regclass('public.game_payment_settings_visible'),
       to_regprocedure('private_sec.game_organizer_for_caller(text)'), to_regprocedure('private_sec.payment_settings_holder_for_caller(uuid)');
-- current column access: expect reported_id / reviewed_by false (phase 1), the five phase-2 columns true until applied
select v.rel, v.col, r.role, has_column_privilege(r.role, v.rel, v.col, 'SELECT')
  from (values ('public.hosted_games','host_id'),('public.hosted_games','image'),('public.hosted_games','host_snapshot'),('public.join_requests','host_id'),
               ('public.game_payment_settings','host_id'),('public.user_reports','reported_id'),('public.game_position_waitlist','reviewed_by')) v(rel, col)
  cross join (values ('anon'),('authenticated')) r(role) order by 1,2,3;
-- grants phase 2 rewrites: table-level, then column-level (this view also lists columns implied by a table grant; after phase 2 expect 0 rows)
select table_name, grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name in ('hosted_games','join_requests','game_payment_settings') and grantee in ('anon','authenticated','PUBLIC') order by 1,2,3;
select table_name, column_name, grantee from information_schema.column_privileges
 where table_schema = 'public' and table_name in ('hosted_games','join_requests','game_payment_settings') and grantee in ('anon','authenticated','PUBLIC')
   and privilege_type = 'SELECT' and column_name in ('host_id','image','host_snapshot');
-- view drift: every base column is in its view (expect 0 rows)
select c.table_name, c.column_name from information_schema.columns c
 where c.table_schema = 'public' and (c.table_name, c.column_name) not in (select replace(v.table_name, s.suffix, ''), v.column_name from information_schema.columns v
       join (values ('hosted_games_public','_public'),('join_requests_visible','_visible'),('game_payment_settings_visible','_visible')) s(view, suffix) on v.table_name = s.view
       where v.table_schema = 'public') and c.table_name in ('hosted_games','join_requests','game_payment_settings');
-- objects that would break: invoker functions reading the closed columns (expect 0 rows), views over the tables (expect the three SEC-5 views)
select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname in ('public','private_sec') and not p.prosecdef and p.prosrc ~ '(hosted_games|join_requests|game_payment_settings)' and p.prosrc ~ '(host_id|image|host_snapshot)';
select distinct v.oid::regclass from pg_depend d join pg_rewrite r on r.oid = d.objid join pg_class v on v.oid = r.ev_class
 where d.refobjid in ('public.hosted_games'::regclass,'public.join_requests'::regclass,'public.game_payment_settings'::regclass) and v.oid <> d.refobjid;
-- GraphQL and Realtime exposure
select extname, extversion from pg_extension where extname = 'pg_graphql';
select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
   and tablename in ('hosted_games','join_requests','game_position_waitlist','game_payment_settings','user_reports');
select entity::regclass, count(*) from realtime.subscription where exists (select 1 from unnest(filters) f where f.column_name in ('host_id','image','host_snapshot')) group by 1;
-- locks: long transactions touching the tables (set lock_timeout in the migration either way)
select pid, now() - xact_start, state, left(query, 80) from pg_stat_activity where xact_start < now() - interval '1 minute' and datname = current_database();
```

**Post-apply:** re-run the column-access query, expecting all seven to be false. Load the new build's feed, a game
page, a join request, a settings save and the host dashboard. In the sandbox, confirm Realtime payloads (P2 step 5).

**Rollback:** `supabase/phase2/sec5_phase2_rollback.sql`, shipped as a migration. It re-grants the five columns to
every API role that can still read the table, and drops the restrictive cover policy. Phase 1 (views, triggers,
`reported_id`/`reviewed_by` closures) stays. 511 state (r) proves that every probe then answers exactly as in phase

1. Rolling back reopens the direct read of the minor host's id, so it needs the same owner approval.

**P1: PostgREST sandbox check:** with curl against the sandbox REST endpoint, using a user JWT, before and after
phase 2:

- `GET /rest/v1/hosted_games?select=*`, `?select=id`, `?select=id&host_id=eq.<uuid>`, `?select=id&order=host_id`;
- `HEAD … Prefer: count=exact` with `select=*` and with `select=id`;
- `POST` with `Prefer: return=representation`, with `return=minimal`, and with `return=representation&select=id`;
- `POST ?on_conflict=game_id,host_id` with `Prefer: resolution=merge-duplicates` on `game_payment_settings`.

Expect the (c) column of the table above, with HTTP 401/403 and code 42501 where it says denied.

### 7. Open items

1. **Phase 2 is not applied; the release is not complete.** D01–D04, D06, D07, D11 and hand-made Realtime
   subscriptions still expose a minor host's id until it is.
2. Realtime (P2), PostgREST over HTTP (P1) and GraphQL (P3) are sandbox-only and not yet run.
   - The coordinator's production catalog read confirms which tables are in the publication; the per-subscriber
     behaviour above comes from Realtime's source, not from a run.
   - Whether one bad binding fails a whole channel (the old profile channel's `player_id` binding) is unconfirmed.
3. The minimum-generation gate cannot retire r4 bundles. Measurement and the adoption window are the only gate for
   them. The edge-log template and the `pg_stat_statements` role attribution need a sandbox dry run.
4. A personal invite link carries `from=<inviter account id>` (`availability.ts:339`, a notification link to the
   invitee). It is outside the column revokes and unchanged by phase 2. The invitee already sees the inviter on the
   contact request, but a minor's invite link forwarded onward carries their id. Replacing `from` with
   `organizer_ref` would need old-client handling: r4 rejects an invite whose `from` is not the host id.
5. HEAD `count=exact&select=*` from an API role breaks after phase 2 (D12). No new-client call does it; the
   superadmin counts use the service role.
6. Server functions with the user's session switched at deploy; an old server build never coexists with phase 2
   unless it is rolled back past this branch.
7. `scripts/sec5-client-query-inventory.mjs --check` is not wired into CI; regenerate the JSON when the client
   changes.
