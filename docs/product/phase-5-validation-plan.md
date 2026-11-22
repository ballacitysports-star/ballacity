# Phase 5: validation launch

BallaCity will run a free pilot with real users in one city. The pilot measures one funnel, post availability -> invited -> joined -> showed up, from tables that already exist. The counts are computed on the server and shown only as totals. Phase 5 also fixes the blockers that would break that funnel, adds a short in-app feedback prompt for adults and a pilot checklist, and then fixes whatever the data shows.

Sources: the analytics, feedback, pilot and privacy maps and the critique, all at `main` ad917323. Where the maps and the critique disagree, this plan follows the critique. "Not found" means the maps did not find it.

---

## What exists

**Funnel data (server, every age group)**

- Posts: `player_availabilities` (`supabase/migrations/20260622213517_...sql:3-17`). Authors can hard-delete a post (`src/lib/availability.ts:366-371`).
- Invites: `game_invites` (`20261119100000_game_invites.sql:40-53`). It has been in production since 2026-11-18 03:34 UTC (`docs/release/records/2026-11-18-batch-13.md:44`).
  - The invite function now in use is `20261123100000_regular_invites.sql:44-143`.
  - `availability_id` is the invitee's newest open post, picked by the server (`:89-97`). It is NULL for regulars invited without a post (`:98-100`). It becomes NULL when the post is deleted (`20261119100000:45`, ON DELETE SET NULL).
- Invite seen: the `game_invite` notification row has `read_at` (`src/integrations/supabase/types.ts:2584`), and its link carries `inv=<invite id>` (`20261123100000:134`).
- Accept: `game_respond_invite` only approves the join request (`20261119100000:291-303`). Its capacity check counts only `game_participants` (`:279`).
- Roster: `game_participants` (`20260710223919_...sql:3-9`). For free games the browser writes the row when the player next opens the game page (`src/routes/games.$gameId.index.tsx:620-628`). Leaving deletes the row (`src/lib/games-store.ts:392-417`). Cancelling or being removed deletes the request (`src/lib/payments.ts:647-705`).
- Late leaves: `late_cancellations` (`20261008120000_cancel_windows.sql:33-47`).
- Showed up: `game_participants.attended`, `attendance_marked_at` and `attendance_marked_by` (`20260902020101_...sql:7-10`), set by `host_mark_attendance` (`:208-230`).
  - Host UI: the GameDayActionSheet, shown within ±24 h of the start (`games.$gameId.index.tsx:2463-2467`).
  - Host UI: the roster-tab Attendance block, with no time limit after the start (`:2789-2792`).
  - Nothing prompts the host to mark attendance.

**Client analytics**

- GA4 runs for confirmed adults only (`src/components/AnalyticsHost.tsx:33`; `src/lib/analytics.ts:1-8, 77-99`) and sends from published builds only (`AnalyticsHost.tsx:15-18`).
- There are 16 allow-listed events, none for posting availability, invites or attendance (`analytics.ts:12-29`). Unknown events are dropped (`:68`).
- `join_game` also fires when a request is sent (`kind:"request"`, `games.$gameId.index.tsx:1312`), so it does not mean "joined".
- The measurement id falls back to the hard-coded `G-MEWLGXSWXC` (`vite.config.ts:51-53`).
- No consent banner or consent mode exists. The cookie notice and privacy text do not name GA (`src/lib/legal-documents.ts:114-197`, placeholders).

**Admin metrics**

- SuperAdmin Overview shows all-time row counts only: no funnel, no time window, no invites, no attendance (`src/lib/superadmin.functions.ts:31-133`; `src/components/superadmin/OverviewTab.tsx`).
- Small counts are masked below 5 (`src/lib/sport-activity.ts:6-11`).
- The pattern for a metrics function that checks `is_superadmin` itself is `20261023120000_payment_health_metrics.sql:11-27`.

**Feedback and support**

- No feedback, survey or NPS table, route or notification exists.
- The Help drawer stores nothing; escalation is a mailto to support@ballacity.app (`src/lib/trust.ts:11`; `docs/support-assistant.md:56-58`).
- Reviews are adults-only (`20261108100000_minor_review_privacy.sql:9-31`). Minor-authored feedback stays off until a workflow for it exists (`:14-15`).
- Hooks for a prompt:
  - the ended-game banner (`games.$gameId.index.tsx:1676-1707`)
  - `SupportPanel` (`src/components/support/SupportPanel.tsx`)
  - the Settings row (`src/routes/settings.tsx:185-190`)
  - the 5-minute server sweep (`src/lib/game-reminders.server.ts`; `20261108160000_scheduled_jobs.sql:79-84`)

**Privacy patterns to copy**

- No-identity table: `app_error_events` (`20261108150000_app_error_events.sql:4-49`). RLS is on with no policies, and rows are purged after 30 days.
- Age-gating trigger: `20261106200000_telemetry_age_gating.sql:23-92`. It covers only 2 tables, so new tables need their own trigger.
- Do not build on `trackingAllowed()` (`src/lib/child-policy.ts:934-944`). It contradicts the adults-only rule and is called only from tests.

**Pilot docs:** no pilot checklist exists. The closest is `docs/release/staging-test-checklist.md`.

---

## Owner decisions (2026-11-21)

| Topic           | Decision                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pilot city      | New York City (on Eastern time; no time-zone work needed).                                                                                                                                                                                                                                                                                                               |
| Who joins       | Teens are included. Before any teen is recruited, counsel signs off on counting minors in product metrics and on the teen safety texts; that is a gate in the WP 5.0 checklist. Until then the funnel shows adults, and its separate under-18 column stays hidden behind a legal-review flag. Feedback from minors stays off (WP 5.7 and 5.8) until counsel approves it. |
| Feedback        | Kept 90 days, then purged. Optional "You may contact me" box; superadmins see who wrote a note only when it is ticked. Counsel confirms the period before WP 5.7 ships.                                                                                                                                                                                                  |
| Build order     | WP 5.0 to 5.6 now, through the usual route (PR, green CI, sandbox, then production). WP 5.7 and 5.8 wait for counsel.                                                                                                                                                                                                                                                    |
| Everything else | The recommended defaults below, unless the owner says otherwise.                                                                                                                                                                                                                                                                                                         |

The under-18 "legal-review flag" is built in WP 5.2 as the server-side `funnel_minor_counts` switch: off by default, turned on only by a superadmin through a recorded act. See WP 5.2, "As built", and checklist row B1.

## Owner decisions needed

Each item gives a recommended default and why.

1. **Which city is the pilot?**
   - Default: New York City, or another city on US Eastern time.
   - Why: `src/lib/format.ts:3` hard-codes `America/New_York`, and reminder pushes use it (`game-reminders.server.ts:30, 416, 438`). A city in another time zone would show times that disagree between screens. NYC is already in `src/lib/launch-cities.ts:37`.
2. **Is the pilot adults only (18+)?**
   - Default: yes. Do not recruit minors.
   - Why:
     - Safety texts still carry "LEGAL REVIEW REQUIRED" (`src/lib/legal-review.ts:14-19`).
     - Youth privacy items are open (`docs/release/privacy-gap-register.md:79-89`, `:34`).
     - Minors cannot give feedback under current rules.
     - GA cannot count minors.
3. **Are minors' rows counted in the funnel?**
   - Default: the funnel counts adults only. Add one combined count of accounts that are "not a confirmed adult" (minors plus unknown age), masked below 5, visible to superadmins only.
   - Why: no written rule allows counting minors in product metrics, and that needs owner and counsel sign-off. The combined count is the minimum needed to know how much the adults-only funnel misses (critique B6).
4. **Who can see the metrics?**
   - Default: superadmins only, totals only, through a function that checks `is_superadmin` itself.
   - Why: this matches `payment_health_metrics`. Admins and moderators do not need product metrics.
5. **How do we tell pilot users from everyone else?**
   - Default: every real account active after a pilot start date the owner sets. Exclude `*@lovable.test` accounts (`docs/e2e-test-accounts.md`) and staff accounts. Add no tag table in the first cut.
   - Why: there is no `is_test` flag, no invite code and no waitlist, and `signups_enabled` does nothing (critique B4; pilot map I5).
6. **When does the feedback prompt appear?**
   - Default: on the ended-game banner the next time a player opens the game, once per game, for up to 14 days. No push in the first cut. Add an always-available "Send feedback" entry in the Help drawer and Settings.
   - Why: this reuses existing screens and sends no extra notifications. Add a push only if response is low.
7. **Do minors (and unknown-age accounts) see feedback prompts?**
   - Default: no. Hide every prompt unless the account is a confirmed adult with no age review pending (the same gate as `AnalyticsHost.tsx:33`), and have the server refuse such writes too.
   - Why: `20261108100000_minor_review_privacy.sql:14-15`.
8. **Analytics consent.**
   - Default: add no new GA events in Phase 5, because the funnel is measured on the server. Ask counsel now whether GA needs a consent banner or a notice update before real users arrive.
   - If counsel says GA must stop, that takes a code change. The id falls back to a hard-coded value (`vite.config.ts:51-53`), so unsetting the secret is not enough.
   - Why: no consent UI exists, and the cookie and privacy texts do not mention GA.
9. **May adults write free text, and may we contact them?**
   - Default: free text is optional and capped at 500 characters. Include a "You may contact me about this" checkbox. The superadmin view shows who wrote an entry only when that box is ticked.
   - Why: follow-up is useful in a pilot, and the box limits exposure of who said what.
10. **How long is feedback kept?**
    - Default: 90 days, removed by a scheduled purge. Counsel confirms the period.
    - Why: it matches the existing diagnostics promise (`src/lib/retention.ts:121`). `LEGAL_REVIEW.retention` is `false`.
11. **Is a delay of up to 5 minutes acceptable for invite pushes?**
    - Default: yes.
    - Why: the existing 5-minute sweep gives one server path that already applies minors' quiet hours through `deliverPush`.
12. **Enforce the 90-day diagnostics promise or change the text?**
    - Default: enforce it with a purge job (WP 5.9).
    - Why: `retention.ts:120-134` promises 90 days for `auth_signin_events`, `location_denial_events` and `notification_delivery_log`. No purge job exists for them.
13. **Host-charged games during the pilot.**
    - Default: ask pilot hosts to run free games, as a checklist item. No code change.
    - Why: there is no switch for host-charged games (`docs/monetization-free-mode.md:270+`).
14. **Success targets.**
    - Default: collect a 2-week baseline first, then set targets per step.
    - Why: there is no earlier data to set them from.

---

## Work packages

Rules for every WP:

- Migrations are additive and reversible.
- Each migration ships with a down script that restores the previous state.
- A rollback that would drop rows refuses to run while rows exist, unless the operator passes an explicit flag after taking an export.
- Apply to the sandbox first, then production, and write a release record in `docs/release/records/`.
- SQL tests go in `supabase/tests/` (numbered files, listed in `supabase/tests/README.md`), run by `node scripts/db-test.mjs` and in CI.

### WP 5.0 Pilot checklist and owner checks (docs only)

- **Goal:** one page that says whether the pilot can start.
- **Scope:** new `docs/product/pilot-checklist.md`. No code.
- **Checklist items (owner checks, each with a recorded date):**
  - The pilot city is chosen and on Eastern time (decision 1).
  - `ONESIGNAL_REST_API_KEY` is set in production. One real push has reached a real phone, recorded via the Ops PushTester (`src/components/superadmin/OpsTab.tsx:372-407`).
  - The legal documents are published in production `legal_documents`, or the owner accepts the placeholder banner (`src/components/legal/LegalDocumentBody.tsx:35-38`; `LegalConsent.tsx:97`).
  - Counsel's answer on GA consent (decision 8).
  - The support@ballacity.app mailbox receives mail (pilot I9).
  - Sandbox status is settled (`docs/release/sandbox-verification.md:63` against `docs/release/records/2026-11-21-batch-22.md:61`). `schema_migrations` is recorded for applies made through the SQL Editor.
  - Production has `20261124100000` and `20261125100000` applied. The funnel SQL depends on which invite function is live.
  - `seedTestAccounts` was never run in production, or its rows are removed.
  - Pilot hosts agree to run free games.
  - The pilot start date is set (decision 5).
  - There is a named person who reads the moderation queue daily during the pilot.
- **Never record:** names, emails or phone numbers of pilot users in the repo.
- **Tests:** none.
- **Migration:** none.
- **Acceptance:** the file exists. Every item is either checked with a date or marked as a blocker with an owner.

### WP 5.1 Operator fixes before the pilot (no migration)

- **Goal:** operators see true numbers and cannot be misled by switches that do nothing.
- **Scope:**
  - Overview "open reports" counts `new`, `pending` and `open`, using the same mapping as `src/lib/moderation.functions.ts:102-108`. Today it counts only `open` (`superadmin.functions.ts:69`), while new reports are written as `new` (`src/lib/moderation.ts:217`).
  - Add a reports item to AttentionStrip (`src/components/superadmin/AttentionStrip.tsx:7-12`).
  - Overview "Availability posts" shows open posts next to the all-time total (`superadmin.functions.ts:65`).
  - In Ops, label `signups_enabled`, `games_creation_enabled`, `reels_enabled` and `announcement_banner` as "not enforced", or hide them (`OpsTab.tsx:125-143`). Nothing in `src` reads them.
  - `seedTestAccounts` refuses to run in production (`src/lib/seed-test-accounts.functions.ts:23-24`).
  - Remove `trackingAllowed()` or make it match the adults-only rule (`src/lib/child-policy.ts:934-944`, `child-policy.test.ts:311-316`).
  - Doc fixes:
    - `docs/data-retention.md` lists `app_error_events` (30-day purge), `session_activity`, `game_invites` and `late_cancellations`.
    - `docs/monetization-free-mode.md:187` gets the payments token fact right (`.env.production:4`).
- **Never record:** nothing new is recorded.
- **Tests:**
  - Unit: the reports count includes `new`.
  - Unit: the seed function refuses in production.
  - Unit: `trackingAllowed` returns no analytics for anyone under 18, or the function is removed.
- **Migration:** none.
- **Acceptance:**
  - A test report filed as `new` appears in the Overview count and in AttentionStrip.
  - Ops shows the unenforced flags as such.
  - The seed refuses in production.

### WP 5.2 Funnel report (server-side, aggregated)

- **Goal:** superadmins see the weekly funnel with no new client tracking.
- **Scope:**
  - New function `public.superadmin_funnel(_from date, _to date)`, SECURITY DEFINER with a fixed `search_path`. It checks `is_superadmin` itself, as `payment_health_metrics` does, and returns jsonb with one row per week (Eastern time).
  - Server function in `src/lib/superadmin.functions.ts` and a "Funnel" card in SuperAdmin.
  - Tables read:
    - `player_availabilities`
    - `game_invites`
    - `notifications`
    - `join_requests`
    - `game_participants`
    - `late_cancellations`
    - `hosted_games`
    - `profiles`
    - `auth.users` (test-account filter only)
- **Steps (adults only, per decision 3):**
  1. Posters: distinct `user_id` with a post created in the week.
  2. Posters invited: posters whose id appears as `game_invites.invitee_id`. Join on the user, not on `availability_id`.
  3. Invites sent.
  4. Invites seen: the matching notification has `read_at` set (link `inv=<id>`).
  5. Answered, and accepted.
  6. Joined: the invitee has a participant row **or** an approved request.
  7. Game started and not cancelled.
  8. Attendance marked.
  9. Showed up.
  10. Late leaves.
  - Secondary line: posters who joined any game by their own request in the week. This is approximate, because nothing links self-joins to posts.
  - Show "marked" coverage next to the show-up rate.
- **Filters:**
  - Exclude `*@lovable.test` accounts and staff.
  - Exclude rows with `hidden_at` set.
  - Exclude the host's own participant row (`user_id = host_id`).
  - Report cancelled games separately.
  - Invites before 2026-11-18 03:34 UTC are out of scope.
  - Games with a `series_id` are counted separately, and empty series games are left out of game totals (critique B3).
  - Rows created before the pilot start date are excluded.
- **No city breakdown in v1.** `hosted_games` has no city column (critique B2). With one pilot city the total is the city.
- **Never record or return:**
  - user ids, names or emails
  - game or invite ids
  - per-host, per-game or per-person rows
  - any breakdown that differs by age group
  - Counts from 1 to 4 show as "<5" (`maskSmallCount`).
  - The function writes nothing.
- **Tests:**
  - SQL:
    - refused for anon, members, admins and moderators
    - allowed for a superadmin
    - minors and unknown-age rows are excluded from step counts
    - test accounts are excluded
    - the host row is excluded
    - an approved request without a roster row counts as joined
    - small counts are masked
    - a deleted post does not break the count
  - Unit: the card renders the masked values and the "marked" coverage.
  - e2e: a superadmin opens the card. A member gets no access.
- **Migration:** yes: `20261127100000_superadmin_funnel.sql` (functions, two `app_settings` rows, one guard trigger on `app_settings`). Rollback: `docs/rollbacks/20261127100000_superadmin_funnel.down.sql`, guarded (confirmation setting; refuses if any object changed since, or while WP 5.3 is applied).
- **Acceptance:** the card shows weekly counts for steps 1-10 against the sandbox seed, and the numbers match a hand-run SQL query in the release record.

**As built (2026-11-21)**

- `public.superadmin_funnel(_from date, _to date)`: SECURITY DEFINER, `search_path = ''`, STABLE (it cannot write). It checks `private_sec.is_superadmin(auth.uid())` itself. Default window is the last 8 weeks, at most 26, never past today. Weeks run Monday to Sunday in `America/New_York`. The helpers are in `private_sec` and no API role can call them.
- Whole weeks only. `_from` moves back to its Monday and `_to` moves on to its Sunday. Only the current week stops at today, and it grows only as time passes. Otherwise two answers whose `_to` differ by one day could be subtracted to give that day's exact count, including a 1 to 4 the masking hides. The same holds for frozen history days and for the under-18 column. The card asks for a number of weeks and computes `_from` from the New York date (`funnelWindowFrom`), not the UTC date, so "4w" is four columns on a Sunday evening too.
- Who is counted: every account except `auth.users.email` ending `@lovable.test` and anyone with a `user_roles` row (admin, moderator, superadmin). Adults are `profiles.age_cohort = 'adult'` with no age review pending, the same gate as `AnalyticsHost.tsx`. "Adult" is judged when a day is computed, not when the row was written. An adult found later to be a minor also leaves the stored history (WP 5.3, "As built").
- One host rule for every step that reads a game: a game whose host is a test or staff account counts nowhere. It adds no invite, join or self-join, and it is not held. Before this, a staff-hosted game added invites, joins and show-ups but never a game held, and a self-join into a test account's game counted. SQL test 970 checks that a staff-hosted game and a test-hosted self-join change no adult number.
- Nothing a minor or an unknown-age account does moves an adult number. Adult invites and self-joins count only in games whose host is a confirmed adult: a minor may host under a team (`20261121100000`). Only a player of the same group makes a series copy "held". SQL test 970 adds and removes a minor's roster row and a minor's invite and checks that no adult number changes.
- How each step is counted (a post counts on the person's first post day in the week; an invite on the day it was created; a game on its start day):
  1. Posters: distinct `player_availabilities.user_id` with `hidden_at IS NULL` and a post created in the week.
  2. Posters invited: those posters with a `game_invites` row (`invitee_id`) created from their first post of the week to 7 days after their last. The plan named no time window; without one, an invite months later would count.
  - Secondary line: those posters who got a place in the same window on their own: a `game_participants` row, or an approved `join_requests` row whose `idempotency_key` is not `invite:…`, in a game they did not host and had not accepted an invite to.
  3. Invites sent: `game_invites.created_at` in the week, from 2026-11-18 03:34 UTC. Invites to games with `hosted_games.hidden_at` set, or hosted by a test account, are left out. For adults, so are invites to games whose host is not a confirmed adult.
  4. Seen: the invitee's `game_invite` notification whose `link` carries `inv=<invite id>` has `read_at` set, **or** the invite was answered. Answering from the game page leaves the notification unread, so `read_at` alone undercounts.
  5. Answered: `responded_at` is set (accepted, declined, or an accept that found the game closed). Accepted: `status = 'accepted'`.
  6. Joined: a `game_participants` row for the invitee in that game (never the host's own row), or an approved `join_requests` row.
     - One place is credited to one invite. A person can have several invites to one game: a host can cancel and invite again at once, or invite again after a decline. Only one pending invite at a time is enforced. Of those invites, only the deciding one is credited with steps 6 to 10: the accepted one, or else the latest. It is credited only while it is pending or accepted, so a declined invite is not "joined" when the player later joins on their own. The other invites still count as sent, seen and answered.
  7. Game started and not cancelled: joined, `hosted_games.date` has passed, and neither `cancelled_at` nor `status = 'cancelled'`. `status` is NULL on most games, so the check is NULL-safe.
  8. Attendance marked: `game_participants.attended IS NOT NULL`.
  9. Showed up: `attended = true`.
  10. Late leaves: a `late_cancellations` row with `kind = 'game'`, `ref_id` = the game, `user_id` = the invitee.
  - Also returned: joined then the game was cancelled; invites to series games; games held (empty series copies left out), of which series games; games cancelled; empty series games left out. An "empty" series game has no player other than the host. A player is someone in the same group with a roster row or an approved request, as for step 6. A free game's roster row is written later by the browser.
  - Rates: marked coverage = marked / game started; show-up rate = showed up / marked. Both come from the raw counts and are returned only when both counts are 0 or at least 5.
- The window must be real dates. `-infinity` or `infinity` is refused with `INVALID_WINDOW`: `-infinity` passed every clamp, and the day series over it never ended (SQL test 970).
- Cost: every step is a join or a keyed lookup. Posters invited was an `EXISTS` over the materialized invites for each poster, which grows as posters times invites. On a scratch replay with 20k users, 40k posts over 26 weeks, 10k games, 30k invites, 20k roster rows, 20k approved requests and 200k notifications, the default 8 weeks took 18.7 s, and 26 weeks with the under-18 column took 51 s. The API cancels calls at 8 s. Now these take 1.3 to 1.6 s and 1.5 to 2.2 s (JIT off and on). The nightly snapshot runs the same query over about 4 weeks.
- Masking: every count from 1 to 4 leaves the database as the string `"<5"`; 0 stays 0. The card masks again with `maskSmallCount`'s threshold (`src/lib/funnel.ts`).
- Pilot start date: `app_settings` key `funnel_pilot_start`, `{"date": "YYYY-MM-DD"}`, set in Ops & config. Days before it are left out. Use a Monday. A date that is not a Monday counts from the next Monday, so the first week is whole and no day before the start is counted.
- **The under-18 switch (owner decision 2026-11-21, checklist B1).** `app_settings` key `funnel_minor_counts`, `{"enabled": false}`, never public.
  - Off (the default): the funnel neither computes nor returns any number about accounts that are not confirmed adults. SQL test 970 proves the non-adult counting query never runs.
  - On: each week also carries one combined column, `not_confirmed_adult` (under 18, unknown age, review pending), with the same steps, masked the same way, always computed live. The card shows it only then.
  - Only `public.superadmin_set_funnel_minor_counts(_enabled, _reason)` changes it. It needs a superadmin and a reason: at least 20 characters to turn it on, naming counsel's sign-off and its date. It writes an `admin_audit_log` row (`feature_flag.update`, who, why, before, after).
  - A trigger on `app_settings` refuses any other write that would turn it on: the Ops raw editor, server code, the SQL editor. The Ops editor also refuses the key and points at the card. Turning it off from anywhere is allowed.
  - In the app: the Funnel card's "Turn on…" asks for the reason and the typed word COUNSEL.
- App: `superadminFunnel` and `superadminSetFunnelMinorCounts` in `src/lib/superadmin.functions.ts`, both run as the signed-in user. The Funnel card is on the Overview tab (`src/components/superadmin/FunnelCard.tsx`). When the function is missing (PGRST202/42883) the card shows "Not available yet", so the app can ship before or after the migration. Errors are worded through `src/lib/user-error.ts`.
- What the plan got wrong or left open, checked against the code:
  - `maskSmallCount` masks 0 as well (`n < 5`). The plan's rule is 1 to 4, so the funnel shows 0 as 0.
  - Nothing adds the host to `game_participants`. A host has a roster row only if they joined their own game, so the host-row rule is a guard, not a common case.
  - `hosted_games.hidden_at` is the combined moderator-or-owner hide (`sync_listing_hidden`). `org_hidden_at` is separate and not used here.
  - `game_invites` rows are deleted with their game (ON DELETE CASCADE), not only when posts are deleted. WP 5.3 matters for that too.
  - Production had no `game_invites` rows before 2026-11-18 03:34 UTC (the table did not exist), so that filter only matters on the sandbox.
  - Tables read also include `user_roles` (the staff filter) and `app_settings` (the switch and the pilot start).
  - The rollback cannot be only `DROP FUNCTION`: it also removes the trigger and the two settings rows.
  - e2e: `e2e/superadmin-funnel.spec.ts` (the superadmin test needs `E2E_SUPERADMIN_ACCOUNT`, like `free-mode-superadmin.spec.ts`). It was not run here.

### WP 5.3 Keep funnel history (must be live before pilot day 1)

- **Goal:** the funnel survives hard deletes and leaves (pilot B4).
- **Scope:**
  - New table `funnel_daily(day date, metrics jsonb, computed_at timestamptz)`. RLS is on with no policies (the `app_error_events` model).
  - New function `snapshot_funnel_daily()` recomputes the last 21 days each night and upserts by day. Days older than 21 days are frozen.
  - A pg_cron job, created only if pg_cron is present, as in `scheduled_jobs.sql:77-90`.
  - `superadmin_funnel` reads frozen days from the snapshot.
- **Never record:** any user id or row id. Store totals only, with the same masking and adults-only rule as WP 5.2.
- **Note:** a post deleted on the day it was created is still lost. Accept this rather than change deletion behaviour.
- **Tests:**
  - SQL: the snapshot holds no identifiers.
  - SQL: a post deleted after the snapshot is still counted.
  - SQL: rerunning the snapshot is idempotent.
  - SQL: the cron job is created only when pg_cron is present.
- **Migration:** yes (table, function, cron). Rollback unschedules the job and drops the function. Dropping the table is refused if it has rows unless the export flag is set.
- **Acceptance:** a nightly row appears in the sandbox. Deleting a seeded post does not change a frozen day.

**As built (2026-11-21)**

- Migration `20261127110000_funnel_daily_history.sql`. Rollback `docs/rollbacks/20261127110000_funnel_daily_history.down.sql`. It needs `app.confirm_funnel_daily_history_rollback=yes`, and `app.funnel_daily_exported=yes` while the table has rows (it always has them: the migration takes the first snapshot at once). It refuses if anything changed since.
- `private_sec.funnel_daily(day, metrics, computed_at)` is in `private_sec`, not `public`, so the API never exposes it. RLS is on with no policies and no API role has a privilege. A CHECK allows only an object of whole, non-negative counts, so no identifier can be stored. Adults only: the under-18 column is never stored, even with the switch on.
- Stored counts are raw, not masked. Daily values masked at 1-4 could not be added into weekly totals. They never leave the database unmasked: `superadmin_funnel` masks every weekly total it returns.
- `private_sec.snapshot_funnel_daily(_now)` (scheduler only) works by whole weeks:
  - It rewrites every day from the frozen line to yesterday. The frozen line is the Monday of the week holding today minus 21 days.
  - A day of a complete frozen week is never rewritten.
  - A frozen week the table holds only part of is recomputed and written whole, all seven days in one run, from what exists then. This happens on the first run, or when the job missed enough nights that the line passed a week it had begun. Filling only the missing days would count a person again on a later day of the week if their earlier post was deleted in between.
  - The first run covers 2026-11-16 onward.
- Job `snapshot-funnel-daily`, 08:47 UTC (after the New York day ends), through `private_sec.schedule_funnel_snapshot()`. It schedules only where `cron.schedule` exists, which means pg_cron is installed.
- `superadmin_funnel` reads a frozen week from the table only when the table holds all seven of its days. It computes every other week live and whole. A week is never part history and part live, so nobody is counted twice in it. Each week says `history` or `live`.
- **An adult found later to be a minor leaves the history (checklist B1).** "Adult" is judged when a day is computed, and a frozen day is never rewritten. Without a fix, an account counted as an adult and later found to be a minor would stay in the adults' numbers of every frozen week. Its birthday can be corrected, which lowers the cohort at once (`sync_age_category_from_birthdays` holds only raised ranks for review), or an admin can correct its age. That would put a minor's activity in a product metric while the switch is off.
  - The stored days hold no identifiers, so the account cannot be taken out of them. Trigger `funnel_forget_lowered_adult_trg` on `profiles` (AFTER UPDATE OF `age_cohort`, `age_review_required`) fires only when a confirmed adult stops being one. It deletes every stored day from the Monday of the week the account was created. Nothing the account did can be older.
  - Those weeks are then computed live, without the account, and the next night writes them whole again.
  - The cost: in those weeks the history no longer keeps rows deleted since.
  - Test and staff accounts were never counted, so their age changing deletes nothing.
  - The snapshot locks `funnel_daily` (SHARE ROW EXCLUSIVE) first. A lowering that commits while a snapshot runs waits for it, then deletes what it wrote.
  - A staff role or a test address given later does not change the history: the account was a pilot user when the day was counted.
  - SQL test 975 freezes a week, lowers one counted adult's cohort, and checks that the week comes back live without that adult and with no under-18 number, then is stored whole again without them.
  - The rollback also drops the trigger. That takes ACCESS EXCLUSIVE on `profiles`, so it is the last change before COMMIT and waits at most 200 ms. If `profiles` is busy, it fails cleanly and can be run again.
- Correction to the note above: the history protects only frozen days. A post deleted, a leave, or a game deleted while its day is still inside the window (up to about 4 weeks) is lost, because those days are recomputed each night. The plan said only same-day deletes are lost. Outcomes after a day froze (a game more than about 3 weeks after its invite) are not added to that day.

### WP 5.4 Invites reach people

- **Goal:** fix pilot B1 and B2. An invite reaches the phone, and an accepted player gets reminders.
- **Scope:**
  - Add the nullable column `notifications.push_sent_at`.
  - In the 5-minute sweep (`src/lib/game-reminders.server.ts`), push `game_invite` and `game_invite_accepted` rows from the last hour that have no `push_sent_at`, through `deliverPush` (which applies minors' quiet hours), then set `push_sent_at`.
  - Map the categories in `src/lib/notification-prefs-core.ts:82-90`, and respect members' notification settings.
  - On a successful accept in `GameInvitationsSection.tsx:53-56` and `GameInviteBanner.tsx:53-56`, save the default reminder offsets with `saveMyGameReminderOffsets` (`src/lib/game-reminders.ts:31-49`).
  - Where `memberPushPrompt` returns null for "unsupported" (`src/lib/push-prompt.ts:24`), show iPhone "Add to Home Screen" guidance instead.
- **Never record:** push text beyond the existing notification title and body. No location detail in the push for minors. No new delivery data beyond what `deliverPush` already logs.
- **Tests:**
  - Unit:
    - the sweep pushes each invite once
    - it skips rows older than 1 hour
    - it respects quiet hours
    - it does nothing without the OneSignal key
    - accept saves the default offsets
    - iPhone guidance shows when permission is "unsupported"
  - SQL: members cannot write `push_sent_at`.
  - e2e: invite, then accept, then a reminder row exists.
- **Migration:** yes, the column only. Ship the migration first, then the sweep code. Rollback drops the column after the sweep code is reverted.
- **Acceptance:**
  - Gate: one real invite push received on a real phone in production, recorded.
  - An accepted invitee gets the reminder before the game.

### WP 5.5 Accepting an invite puts the player on the roster

- **Goal:** "joined" means on the roster, and games cannot be over-accepted (critique A3).
- **Scope:**
  - Replace `game_respond_invite` (`20261119100000:279-309`).
  - On accept for a free game, using the same free/paid test as the client auto-join at `games.$gameId.index.tsx:620-628`, insert the `game_participants` row in the same transaction.
  - The capacity check counts participants plus approved requests that have no roster row.
  - Paid games and invites that still need guardian approval keep today's path.
  - The client auto-join stays as a fallback and must tolerate an existing row.
- **Never record:** nothing new is recorded.
- **Tests:**
  - SQL:
    - accept on a full game is refused
    - a second accept writes no second row
    - a paid game gets no roster row
    - an invite awaiting guardian approval gets no roster row
    - two concurrent accepts for the last spot let only one through
    - a decline writes nothing
  - Unit: the client auto-join does not error when the row already exists.
  - e2e: accept from My availability and the player appears on the host's roster without opening the game page.
- **Migration:** yes, a function replacement. Ship it alone; the app needs no change. Rollback restores the previous definition verbatim.
- **Acceptance:** in the sandbox, accepted invitees are on the roster, and no game exceeds `max_players`.

### WP 5.6 Prompt hosts to mark attendance

- **Goal:** fill the "showed up" step, which today depends on hosts remembering.
- **Scope:**
  - Add the nullable column `hosted_games.attendance_prompted_at`.
  - The 5-minute sweep sends the host one in-app notice plus a push, 2 hours after the game ends. Conditions: the game is not cancelled, has at least one non-host participant, and nobody's attendance is marked yet.
  - The notice links to the roster-tab Attendance block (`games.$gameId.index.tsx:2789-2792`).
  - Map the category in `notification-prefs-core.ts`.
  - Whether `notifications.type` has a CHECK constraint is not in the maps. Check before building.
- **Never record:** player names in the push text.
- **Tests:**
  - Unit: one prompt per game; none for cancelled games; none when attendance is already marked; series games each prompt once.
  - SQL: members cannot write `attendance_prompted_at`.
  - e2e: the link opens the Attendance block.
- **Migration:** yes, the column. Ship the migration first, then the sweep. Rollback drops the column after the code is reverted.
- **Acceptance:** "marked" coverage in WP 5.2 rises above the pre-prompt baseline.

### WP 5.7 Feedback storage and "Send feedback" entry

- **Goal:** adults can send feedback that is stored and read.
- **Scope:**
  - New table `product_feedback`:

    | Column       | Rule                              |
    | ------------ | --------------------------------- |
    | `id`         |                                   |
    | `created_at` |                                   |
    | `user_id`    | deleted on account purge          |
    | `context`    | `help`, `settings` or `post_game` |
    | `game_id`    | nullable, ON DELETE SET NULL      |
    | `score`      | 1-5                               |
    | `tags`       | from a fixed list                 |
    | `body`       | ≤500 characters, scrubbed         |
    | `contact_ok` | boolean                           |
    | `release`    |                                   |

  - RLS is on with no policies.
  - Writes go through `submit_product_feedback`:
    - signed-in members only
    - confirmed adult with no age review pending
    - rate-limited to one per game and a few per day
  - A BEFORE INSERT trigger also refuses non-adults. The telemetry trigger does not cover new tables.
  - Reads go through `superadmin_list_feedback`. It shows who wrote an entry only when `contact_ok` is true.
  - The purge function and cron run at the day count set in decision 10.
  - Bookkeeping updates:
    - `RetentionCategory` and `RETENTION_RULES` (`src/lib/retention.ts:15-35`)
    - `docs/data-retention.md`
    - a data-export category (`src/lib/data-export.ts:60-130`)
    - account purge (`src/lib/account-purge.server.ts`)
  - UI:
    - "Send feedback" in `SupportPanel`
    - the Settings row (`settings.tsx:185-190`)
    - both hidden for anyone who is not a confirmed adult
  - The server equivalent of the client's "age review pending" check is not in the maps. Find it before building.
- **Never record:**
  - location, user agent or IP
  - who wrote an entry, in the superadmin view, unless `contact_ok` is ticked
  - GA events carrying feedback content
  - any public display of feedback
  - any message or notification to another member
- **Tests:**
  - SQL:
    - anon is refused
    - minors and unknown-age accounts are refused at both the RPC and the trigger
    - a direct insert is refused
    - `body` over 500 characters is refused or cut
    - rate limits hold
    - the superadmin read hides `user_id` unless `contact_ok`
    - the purge removes old rows
    - account purge removes the member's rows
  - Unit: the entry is hidden for non-adults; the form validates.
  - e2e: an adult sends feedback and a superadmin sees it.
- **Migration:** yes (table, RPCs, trigger, purge job). Migration first, then app. Rollback refuses to drop the table while rows exist unless the export flag is set.
- **Acceptance:**
  - Gate: counsel approves the Privacy Policy wording for feedback (`legal-documents.ts:129-141`) and the retention period, or the owner records acceptance.
  - Feedback from the sandbox appears in SuperAdmin.

### WP 5.8 Post-game "How did it go?" prompt

- **Goal:** ask players after a game while it is fresh.
- **Scope:**
  - New `my_feedback_prompt(_game_id)`, which decides on the server whether to show the prompt. It is shown when all of these hold:
    - the viewer is a confirmed adult
    - the viewer was a participant not marked absent (`attended IS DISTINCT FROM false`, the rule in `20261012120000_review_integrity.sql:58-63`)
    - the game started and was not cancelled
    - it is within 14 days of the game
    - the viewer has not answered yet
  - The prompt is a card in the ended-game banner (`games.$gameId.index.tsx:1676-1707`): score, tags, optional text. It writes through `submit_product_feedback` with `context='post_game'`.
  - Do not reuse `my_reviewable`. Reviews are about people; this is about the product.
- **Never record:** ratings of named people, the other players' identities, or location.
- **Tests:**
  - SQL: refused for minors, unknown age, non-participants, players marked absent, cancelled games and after 14 days; shown once.
  - Unit: the card renders only when the RPC says so.
  - e2e: a participant answers once and the card does not return.
- **Migration:** yes, the function. Migration first. The app may ship first only if the card stays hidden when the function is missing. Rollback drops the function.
- **Acceptance:** post-game feedback rows appear for pilot games. The response rate appears in the WP 5.2 card as one total.

### WP 5.9 Enforce the 90-day diagnostics promise (if decision 12 is "enforce")

- **Goal:** the retention text in `src/lib/retention.ts:120-134` becomes true.
- **Scope:** a purge function and a daily cron for `auth_signin_events`, `location_denial_events` and `notification_delivery_log`, deleting rows older than 90 days. Update `docs/data-retention.md:48`.
- **Never record:** nothing new is recorded.
- **Tests:**
  - SQL: only rows older than 90 days are deleted.
  - SQL: members cannot call the purge.
  - SQL: the cron job exists only with pg_cron.
- **Migration:** yes. Rollback unschedules the job and drops the function. Deleted rows cannot be restored; say so in the release record.
- **Acceptance:** after the first run, no rows older than 90 days remain in the sandbox.

### WP 5.10 Fix what the data shows

- **Goal:** turn the pilot data into fixes.
- **Scope:**
  - Hold a weekly review of the WP 5.2 card and the WP 5.7 and 5.8 feedback.
  - Write each fix as its own WP using this plan's template.
  - Starting rules (owner may change them):
    - Fewer than half of invites seen: work on notification reach.
    - A large accepted-to-joined gap: check WP 5.5 in production.
    - "Marked" coverage under half: consider player self check-in (not found today).
    - Few posters: add a "post your availability" step at the end of onboarding (`src/routes/onboarding.welcome.tsx:533-543`).
- **Never record:** individual users' paths through the funnel. Decide from totals only.
- **Tests:** per follow-up WP.
- **Migration:** per follow-up WP.
- **Acceptance:** each weekly review is written up in `docs/product/` with the counts, the drop-off chosen and the WP opened.

---

## Release gates and order

**Global gates (all must hold before the pilot starts)**

1. WP 5.0 checklist complete. The sandbox status record is settled and `schema_migrations` is correct.
2. Production is confirmed to have `20261124100000` and `20261125100000` applied.
3. Unit, SQL and e2e tests are green for each WP. Each migration runs on the sandbox before production, with a release record.
4. One real production push is recorded before WP 5.4 counts as done.
5. Counsel answers or owner acceptance are recorded before WP 5.7 and 5.8 ship. GA consent (decision 8) is answered before the pilot starts.

**Order**

| Step | WP   | Order inside the WP                                                                                                       |
| ---- | ---- | ------------------------------------------------------------------------------------------------------------------------- |
| 1    | 5.0  | docs only                                                                                                                 |
| 2    | 5.1  | app only                                                                                                                  |
| 3    | 5.2  | migration first, then the card. The card may ship first only if it shows "not available yet" when the function is missing |
| 4    | 5.3  | migration only; live before the pilot start date                                                                          |
| 5    | 5.5  | migration only; the app is unchanged and tolerates both versions                                                          |
| 6    | 5.4  | migration first (column), then the sweep code; the reminder and iPhone parts can ship any time                            |
| 7    | 5.6  | migration first, then the sweep code; within the first pilot week                                                         |
| 8    | 5.7  | migration first, then app; after the legal gate                                                                           |
| 9    | 5.8  | after 5.7; the app may go first only if the card hides when the function is missing                                       |
| 10   | 5.9  | any time after decision 12                                                                                                |
| 11   | 5.10 | weekly from pilot week 2                                                                                                  |

Pilot start requires WP 5.0 to 5.5 to be shipped.

---

## Out of scope

- Paid access, subscriptions or any required payment. This is the owner's rule (`docs/monetization-free-mode.md`); free mode stays on (`src/lib/monetization/config.ts:152`).
- Anything that needs legal sign-off until it is given:
  - a GA consent banner and its wording
  - Privacy Policy and cookie text changes
  - retention periods
  - counting minors in product metrics
  - any feedback from minors
  - recruiting minors for the pilot
  - changes to messaging exceptions E1-E5 (`docs/privacy/r7-messaging-audit.md:21-27`)
- New GA events for the funnel.
- A city column, or multi-city reporting.
- Time zone support beyond US Eastern (`src/lib/format.ts:3`).
- Player self check-in, QR or geo check-in (until WP 5.10 shows a need).
- Invite-a-friend or share flows.
- A pilot invite code or waitlist, or making `signups_enabled` work.
- Email for game events.
