# SEC-5: public organizer reference (approval C, SEC-1 open item D-5)

Migration `supabase/migrations/20261108110000_public_organizer_ref.sql` (phase 1). Prepared phase 2:
`supabase/phase2/sec5_phase2_close_host_id_columns.sql` (not a migration, not applied). Tests:
`supabase/tests/510_public_organizer_ref.test.sql` (69 assertions, phase 2 applied inside the rolled-back
transaction), plus `src/lib/organizer-access.test.ts`, `src/lib/hosted-games-store.organizer.test.tsx` and
`src/lib/payments.join-request.test.ts`.

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

| Path                                                                                    | Who could read it                                 | Disposition                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `hosted_games.host_id`                                                                  | anyone who can read the game                      | masked in view (phase 1), column revoked (phase 2)                                           |
| `hosted_games.image` (cover path)                                                       | same                                              | masked in view, revoked in phase 2                                                           |
| `hosted_games.hosting_approval_id`                                                      | same                                              | single-use per game (not a linker); masked in the view anyway                                |
| `storage.objects` (`game-covers/<id>/...`)                                              | any signed-in account, for covers of public games | phase 2 restrictive policy                                                                   |
| `join_requests.host_id`                                                                 | the requester, their guardians, the host          | masked in `join_requests_visible`, revoked in phase 2                                        |
| join-request insert (`validate_join_request` mismatch error)                            | any signed-in account                             | closed in phase 1 (fill trigger)                                                             |
| realtime `hosted_games`, `join_requests`                                                | subscribers passing row security                  | client uses events as signals only; phase 2 strips the columns                               |
| `game_payment_settings.host_id`                                                         | host, approved requesters, payers, participants   | holder is the payee (adult) or, for a free game, the host; open item 2                       |
| `payment_submissions`, `paypal_orders`, `payment_verification_events` `.host_id`        | payer and payee                                   | always the payee (`enforce_payment_destination`), an adult; never the minor                  |
| `game_participants`, `game_position_waitlist`                                           | the person, the host, the roster                  | related only (roster = shares a game)                                                        |
| `conversations` / `conversation_participants`                                           | participants                                      | related only (shares a chat)                                                                 |
| `notifications`                                                                         | the recipient                                     | game links only; no host id in player-facing content                                         |
| `reviews`                                                                               | public                                            | minors are never reviewable (`my_reviewable`, PRIV-1)                                        |
| `user_reports.reported_id`                                                              | the reporter                                      | client-supplied; the report-host button needs a known host, so it is not offered when masked |
| `minor_hosting_approvals`                                                               | the minor, approver, guardians                    | related only                                                                                 |
| `skill_ratings`, `team_members`, `team_posts`, `post_comments`, `post_reactions`, reels | R1                                                | already hidden for minor hosts (sweep confirms)                                              |
| RPC `get_game_organizer`                                                                | signed-in                                         | neutral for strangers (G4)                                                                   |
| RPC `get_game_host_payment_methods`, `get_game_host_paypal`                             | signed-in / anon                                  | refuse a non-adult host id; return the payee's methods / merchant id only                    |
| RPC `my_reviewable`                                                                     | adults                                            | excludes non-adults                                                                          |
| RPC `host_attendance_stats(uuid)`, `player_activity_stats(uuid)`                        | signed-in                                         | take an id, return counts; no game linkage                                                   |
| RPC `game_payee_id`                                                                     | service role only                                 | n/a                                                                                          |
| Views                                                                                   | none existed                                      | two added                                                                                    |

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
report-host buttons are not offered (they were already hidden for neutral hosts on cards); "games hosted" counts on
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
2. `game_payment_settings.host_id` is readable by approved requesters who are not yet on the roster; for a free
   minor-hosted game it is the host. That is the host's own approval decision, but `can_see_minor_name` does not
   include them. Decide whether to mask it too (a third view) or add approved requesters to the relation.
3. `enforce_payment_destination` runs before the approval check, so any signed-in account can test whether an
   account is the payee of a game (for a minor host, the adult payment manager, usually a guardian). Fix the same way
   as join requests: fill the payee from the game.
4. The view computes the organizer per row with a definer lookup, and `viewer_is_host` filters scan the visible
   rows. Fine at today's size; an index-backed `my_hosted_games()` RPC would be the next step.
5. Strangers lose a minor-hosted game's custom cover. Storing minor covers under a neutral path
   (`game-covers/games/<organizer_ref>/...`) would give it back.
6. Everyone `can_see_minor_name` allows (including accepted followers and anyone who ever shared a game or chat)
   can link all of a minor's games; they already learn the name from `get_game_organizer`.
7. Realtime column stripping and PostgREST `return=minimal` behaviour cannot be exercised locally; verify on staging
   before phase 2.
8. No guard yet stops new client code from reading `host_id` from the table again before phase 2 lands (after
   phase 2 the database refuses it).
9. Unknown-age hosts are treated as not adult (masked), the same as the neutral snapshot rule.
10. No helper wrapped by SEC-2 is redefined, so `private_sec.wrap_oracle_helpers()` was not re-run.
