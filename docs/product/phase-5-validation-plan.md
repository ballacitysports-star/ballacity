# Phase 5: validation launch

BallaCity will run a free pilot with real users in one city. The pilot measures one funnel, post availability -> invited -> joined -> showed up, from tables that already exist. The counts are computed on the server and shown only as totals. Phase 5 also fixes the blockers that would break that funnel, adds a short in-app feedback prompt for adults and a pilot checklist, and then fixes whatever the data shows.

Sources: the analytics, feedback, pilot and privacy maps and the critique, all at `main` ad917323. Where the maps and the critique disagree, this plan follows the critique. "Not found" means the maps did not find it.

## Status (2026-11-27)

- Shipped to production: WP 5.0 to 5.6 and WP 5.9, with the follow-up migrations through `20261204110000` (release records batch 23 to batch 31).
- Waiting: WP 5.7 and 5.8 wait for counsel. WP 5.10 runs weekly from pilot week 2.
- Open items, one register: `docs/product/open-items.md`. Whether the pilot can start: `docs/product/pilot-checklist.md`.
- The sections below keep the plan and its as-built notes as written at the time. Short corrections in parentheses, checked on 2026-11-27, mark sentences that stopped being true.

---

## What exists

This is the baseline at `main` ad917323, before Phase 5. Several lines no longer hold (the attendance prompt, the funnel card, the pilot checklist, the invite accept); the work packages below say what changed.

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
- The measurement id falls back to the hard-coded `G-MEWLGXSWXC` (`vite.config.ts:51-53`). (2026-11-27: the fallback now lives in `build/ga-measurement-id.ts:14,21`, and the value "off" turns GA off.)
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

Each item gives a recommended default and why. (2026-11-27: the owner took these on 2026-11-21, in the table above. Decision 2 was answered differently: teens join only after counsel.)

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
   - If counsel says GA must stop, commit `GOOGLE_ANALYTICS_MEASUREMENT_ID="off"` in `.env.production` and publish (`build/ga-measurement-id.ts`; updated 2026-11-27). Unsetting the secret is still not enough, because an empty value falls back to a hard-coded id. A non-empty secret in the deploy environment wins over the file, so it must be removed or set to off too.
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
- Known limit (added 2026-11-23, after `20261128110000_age_cohort_at_18`): that migration's daily sweep moves a stored teen cohort up to `adult` at 18. Because "adult" is judged when a day is computed, the activity of a person flipped to adult in the weeks still computed live (about the last 3 weeks) counts in the adult column, including what they did while they were 17. Frozen weeks are unaffected, and the history trigger only removes accounts lowered from adult. This is a minor's activity in an adult metric, so it falls under the counsel item for minors in product metrics (checklist B1). Scale on 2026-11-22: production had one teen under 18 and nobody turning 18 within 30 days. Not changed here; if counsel wants it closed, judge "adult" by the birthday at each day instead of the stored cohort.
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

**As built (2026-11-23, server part, iPhone guidance and reminders on accept)**

- Migration `20261129100000_notification_push_sent_at.sql`: the nullable column `notifications.push_sent_at`, plus a guard. The plan said "the column only", but its own test ("members cannot write `push_sent_at`") needs more: `authenticated` has table-wide INSERT and UPDATE on `notifications`, and the policies let a member insert and update their own rows. So trigger `notifications_push_sent_at_server_only` (BEFORE INSERT OR UPDATE OF `push_sent_at`, function `private_sec.guard_notification_push_sent_at()`, SECURITY DEFINER, `search_path = ''`, no API role may call it) refuses the write when the request carries a member's identity (`auth.uid()` set, or the `anon`/`authenticated` role). That includes a member's call into a SECURITY DEFINER function. The service role and migrations pass. This is the rule `hosted_games` already uses for its server-owned columns. The existing policies and grants are unchanged.
- The same trigger (now also on updates of `type`, `created_at`, `title`, `body`, `link`, `user_id`) keeps the sweep to the database's own invite rows. A `game_invite` or `game_invite_accepted` row stays unstamped only when it is written inside a member's request for another member (`game_invite_player`, `notify_guardians`, `game_respond_invite`). Every other one is stamped as it is stored, so the sweep never reads it: a member's own row (members may insert their own notifications with any type and `created_at`), a service-role insert (`createNotificationForUser`, which already pushes), the guardian copy written for the caller when a host invites their own child, and a member's edit of what a push would say. Nothing is refused and the in-app list is unchanged. Without this, 50 backdated rows a run would have crowded real invites out of the sweep (review finding, 2026-11-23).
- Partial index `notifications_invite_push_due_idx` on `notifications (created_at) WHERE push_sent_at IS NULL AND type IN ('game_invite', 'game_invite_accepted')`: the sweep's read uses it (checked with the parameters PostgREST sends) instead of scanning the whole table every 5 minutes.
- `notifications.type` has no CHECK constraint, so the new and swept types needed no schema change.
- Function `public.invite_pushes_allowed(uuid[])` (SECURITY DEFINER, `search_path = ''`, EXECUTE for `service_role` only): of the given invitations, the ones a push may still go out for. It asks again what `game_invite_player` asked when it wrote the row: the invitation is still `pending`; the game is still open for invitations (`private_sec.game_open_for_invites`: not cancelled, completed or under way, not hidden by its host, a moderator or its organization, not past its start or sign-up cutoff); the host is not suspended or banned; no block either way; `minor_messaging_block` lets the host reach the player; a minor's guardian still allows games (`child_game_participation_allowed`); and the game's age range still fits the player (`game_age_fits`, with an unknown age refused when the game has a range, as `game_invite_player` does). An invitation stays `pending` through all of those changes (only `game_respond_invite` and `game_cancel_invite` change its status; `host_cancel_game` and moderation do not), so the status alone was not enough (review findings, 2026-11-23). It lives in `public`, not `private_sec`, so the service-role client can call it.
- The sweep is `pushInviteNotifications` in `src/lib/game-reminders.server.ts`. The scheduled run (`/api/public/reminders/run`, every 5 minutes) calls `runScheduledSweeps`, which runs the reminders, then the invite pushes, then the WP 5.6 prompt, one after another under ONE time budget (`RUN_BUDGET_MS`, 3 seconds from the start of the run; pg_net stops waiting after 5 seconds and the Worker's remaining work is then cancelled). So invite pushes and prompts get only the time the reminders leave, and at most `PUSH_CONCURRENCY` (4) pushes are in flight at once, as before. One job failing does not stop the others; the run answers 500 if any failed. The player's own reminder flush does not call it.
  1. It reads `game_invite` and `game_invite_accepted` rows created in the last hour with no `push_sent_at`, oldest first, 50 at a time. While a read comes back full and fewer than 50 pushes went out, it reads again, at most 4 reads a run.
  2. It reads the members' notification settings. If that read fails it takes nothing, so the rows stay due.
  3. It checks that each invitation still stands. An invite is pushed only when its link's `inv=` names an invitation to that row's recipient that `invite_pushes_allowed` still allows (above). An acceptance is pushed only when an invitation to that game from that host was accepted when the row was written (within a minute of it; `game_invites`). Neither is pushed when a block exists, either way, between the host and the invited player (`user_blocks`). If any of these reads or the check fails, or the client cannot call the check, it takes nothing.
  4. It takes a row with an UPDATE that sets `push_sent_at` only where it is still NULL, and uses only the rows that UPDATE returns. Two runs at once split the rows; neither pushes a row twice. Rows that get no push are taken together. Rows that get a push are taken 4 at a time, each group just before its pushes, and the next group only after those pushes finish. Once the run's budget is spent nothing more is read or taken: those rows stay due for the next run, 5 minutes later, while still in the hour.
  5. Each taken row goes to `deliverPush`, which holds a minor's push during quiet hours (or drops it once the game has started: the invite link's `exp`), applies a guardian's off switch, does nothing without `ONESIGNAL_REST_API_KEY`, and logs the outcome in `notification_delivery_log` as before. Not pushed, but still taken: the member switched that category's push off, already read the notification in the app (a design choice; the plan did not say), or the invitation no longer stands (step 3).
  - Not covered: a push held for a minor's quiet hours is checked when the sweep takes it, not again when the flush job sends it (`scheduled_notifications` has no link back to the invitation). Anything `invite_pushes_allowed` checks (a block, a cancelled or hidden game, a banned host, a guardian's switch, a decline) that changes between those two moments still lets it out at the end of quiet hours, unless the game has started by then (the hold expires at the game's start). Closing that needs a change to the flush job and its table, outside WP 5.4. Likewise an acceptance push is not checked against the game's state or the host's suspension (only the block): it goes to the host about their own game.
  - If a later read in the same run fails, the pushes of the rows already taken still go out before the run reports the failure.
  - Delivery is at most once: a row is taken just before its push, so a run cut off after a take loses at most that one group of 4 pushes (best effort, like reminders).
- `push_sent_at` therefore means "taken by the sweep" (pushed, held, or passed over), not "delivered". The delivery log holds what happened.
- Push text: only the notification's own title, body and link. An invite says "You're invited to <game>" and the sport and time; an acceptance names the player who accepted and the game's title. No venue in either, for anyone. The acceptance push puts the accepting player's display name, possibly a minor's, on the host's lock screen; that is the existing notification text.
- Settings (`src/lib/notification-prefs-core.ts`): `game_invite` follows Invitations (already so); `game_invite_accepted` now maps to Game updates by name (it did before only through the `game_` fallback). Both switches are on Settings > Notifications (`src/routes/account.notifications.tsx`). Guardians' copies of an invite (`notify_guardians`, link `/parent`) are `game_invite` rows too, but no invitation names the guardian, so they are taken without a push; the guardian keeps the in-app notice. (The first build pushed them; changed in review on 2026-11-23 so a copy is never pushed after the child's invitation was withdrawn or a block was made. Pushing them again needs a way to tie the copy to the child's invitation.)
- iPhone guidance: `memberPushPrompt` returns `"home_screen"` instead of null when permission is "unsupported" in an iPhone or iPad browser tab (`isIosBrowserTab`: iOS, or a touch Mac, not opened from the Home Screen). The Alerts tab's prompt (`PushPrompt` in `src/components/NotificationsPanel.tsx`) then shows "Get alerts on your iPhone" with the Share > Add to Home Screen steps. Not for a managed child or after dismissal; elsewhere "unsupported" still shows nothing.
- Rollback: `docs/rollbacks/20261129100000_notification_push_sent_at.down.sql`. Revert the sweep code first: the run reads the column and calls `invite_pushes_allowed`. It needs `app.confirm_notification_push_sent_at_rollback=yes`, and `app.push_sent_at_exported=yes` while any row has a stamp. It refuses if either function, the trigger, the index or the column changed, if anything else depends on the column, or if another function names it. It drops `invite_pushes_allowed`, the index, the trigger, the guard function and the column.
- Tests: SQL `982_notification_push_sent_at.test.sql` (also: a member's own invite-typed rows, backdated or edited, a service-role insert and a function's copy for the caller are stamped as stored; the index and its use; `invite_pushes_allowed` is service-role only and, for invitations made through `game_invite_player`, drops each after `host_cancel_game`, a moderator's hide, a host ban, a block, a decline, a guardian turning messaging or games off, and an age range that no longer fits); unit `src/lib/invite-push-attendance-sweep.test.ts` (pushed once, two runs at once, rows over an hour old skipped, other types ignored, quiet hours held and expired, guardian switch, no OneSignal key, settings and read rows, a failed settings read takes nothing; no push after a block either way, a cancelled, declined or missing invitation, a guardian's copy, an acceptance with a block or with no accepted invitation behind it; no push for a game cancelled or hidden after the invite, a banned or suspended host, a guardian's messaging or games switch; a failed invitation check takes nothing; a run cut off mid-push leaves at most one group stamped, a run out of time takes nothing more; the three jobs run one after another on one budget; a later failed read still sends the pushes already taken; an acceptance link with a query still matches; 50 planted rows ahead of a real invite do not crowd it out), `push-prompt.test.ts` (the guidance), `notification-prefs.test.ts` (the mapping).
- Not done from the review: a per-recipient cap per run. Only rows the database wrote for another member reach the sweep, inside invites and acceptances that are already limited (100 invitations a day per host, 50 waiting per game).
- Reminders on accept (deferred in the first build, now built): when `game_respond_invite` answers `accepted`, `GameInvitationsSection.tsx` and `GameInviteBanner.tsx` call `saveDefaultRemindersOnAccept` (`src/lib/game-invites.ts`) with the invitation's game. It saves `DEFAULT_GAME_REMINDER_OFFSETS` (`src/lib/game-reminders.ts`: 1 day and 2 hours before), the lead times the game page's RSVP picker starts from when a player joins, through `saveMyGameReminderOffsets` with the new option `keepExisting`. That makes the write insert-only (`ignoreDuplicates`, so ON CONFLICT (game_id, user_id) DO NOTHING): a choice the player already made for that game, "no reminders" included, is kept, even one saved at the same moment. Nothing is read first, so a failed read cannot replace a choice. It is best-effort and not awaited: it never throws, the call sites also catch, and the success toast and the rest of the accept stay as they were. Declined, full, expired and cancelled answers save nothing. An accept that still needs a payment or a guardian's approval gets the reminders too, as a request to join a game that needs the host's approval does when sent from the game page (the accept is a host-approved request). The game page's other two paths save later or not at all: a guarded minor asking a parent on an open game saves nothing with the request, only at the free join after the parent's yes, and a paid game with no host approval goes to the pay page, which saves none. Until the place is final the sweep sends that row's reminder in the app only, with no push (`readRecipients` in `game-reminders.server.ts`: an open request, not a place); a declined or withdrawn request has its row deleted. The game page's own join and request still save the picker's choice over it, as before. No schema change: `game_reminders` already has UNIQUE (game_id, user_id) and an own-rows policy for all commands.
- Tests for it: unit `src/lib/game-invite-reminders.test.ts` (a game with no choice gets 1 day and 2 hours; a saved choice, and a saved "no reminders", is kept; the write is insert-only; a refused or failed save does not throw; nothing without a signed-in player; an explicit save still replaces a choice), `GameInvitationsSection.test.tsx` and `GameInviteBanner.test.tsx` (an accept saves for that game; declined, full, expired and cancelled save nothing; a failed save keeps the success toast and shows no error; the toast does not wait for the save). e2e (2026-11-24): `e2e/invite-accept-roster.spec.ts`. On the real database, the fixture host invites the fixture player to a free game. The player accepts from My availability, and the spec checks that a `game_reminders` row with `{1440,120}` exists for that game, read as the player. The same spec covers WP 5.5 (below).
- **Still open:** the acceptance gate, one real invite push received on a real phone in production and recorded, is the owner's.

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

**As built (2026-11-23), narrowed by the owner**

The owner narrowed WP 5.5 on 2026-11-23, after a 26-file version kept growing. What shipped:

- Migration `20261127120000_invite_accept_roster.sql` replaces only `public.game_respond_invite`. The signature, grants, `SECURITY DEFINER` and empty `search_path` are unchanged. No other database object changes: the join gate, payment and funnel functions and the triggers are untouched, there is no new trigger, and no stored row is rewritten.
- **Free game, no guardian step.** Accepting also writes the player's `game_participants` row in the same transaction, after the game-row lock the function already took, as the invitee. Every roster trigger runs. If one refuses (a host block, an unconfirmed age, a guardian who turned games off), the whole accept is undone and the invitation stays pending.
  - "Free" is the join gate's own fee rule: the payee's newest `game_payment_settings` row, else `hosted_games.price`; free when that is 0 or missing.
  - "Guardian step outstanding" is the roster trigger's own rule: a minor with an active guardian link whose request for this game has no approval from a guardian who still has authority.
  - Capacity on this path counts the other players' roster rows (the player's own row, if any, is not counted) against `max_players`. A full game answers `full` and writes nothing.
  - A player already on the roster gets no second row.
- **Paid games and guardian-held places** keep the old path exactly: the request is approved, no roster row is written, and capacity counts every roster row as before. (Since `20261204110000` a paid game's accept also counts approved requests with no roster row; see the follow-ups below.)
- **Taken-back invitations (a bug that was live).** If the player's request for that game was declined at or after the invitation was created, whether it is still declined or the player has since sent it again, the accept approves nothing and marks the invitation `expired`. The decline's time is `last_rejected_at`, which the server stamps; `reviewed_at`, which the host's device writes, counts only on a declined request with no `last_rejected_at` (a host whose clock runs ahead would otherwise take back invitations sent after the decline). A request declined before the invitation is still approved by the accept.
  - **Only the host takes an invitation back.** Two declines the host never made are not counted while the request still carries the note they write: the payment window running out (`release_expired_payment_holds`) and a guardian's no (`guardian_approve_join_request`). Neither ends the invitation, and a host's re-invitation returns that same pending invitation (created before the decline), so counting them would refuse a deliberate re-invite. They accept as before. A guardian's no also clears the guardian's approval, so the guardian rule still keeps the child off the roster until a guardian says yes again.
  - **Limitation:** sending the request again clears that note, so a released or guardian-declined request that the player then resends reads as the host's decline, and the old invitation answers `expired`. SQL 980 records this by name.
  - **Known gap:** the rule reads only the player's own request row, and the player can erase that evidence: delete the request (RLS allows it; the app's Cancel request does it on a resent one), or clear or back-date `last_rejected_at` in the update that sends a declined request again (the resubmit trigger does not pin it). The accept then goes through, and on a free game puts them on the roster, as the old app's auto-join would have. SQL 980 records both bypasses by name. Closing it needs an object outside this WP (see the follow-ups). (Closed for host and moderator declines by `20261129130000`, below.)
- Every answer now carries `on_roster`.
- The app, minimally:
  - `joinGame` (`src/lib/games-store.ts`) counts a refusal as joined when the player's own roster row already exists. The join gate can answer "full" before the unique key when that row took the last place.
  - A host's Remove (`hostRemoveParticipant`) and Decline (`reviewJoinRequest` with `rejected`) end the player's pending invitation to that game through the existing `game_cancel_invite`, best-effort.
  - A host's Decline no longer lands on a request that is already approved. This happens when the player accepted the host's invitation while the host's request list was stale, or in a real race. The accept now writes a roster row, so turning its approval into a decline would leave the player on the roster with a declined request. The host is told the player already has a place and pointed to Remove. The roster's Remove (`RosterPlayerRow`) still declines an approved request on purpose, then deletes the roster row.
  - The Players tab's accept toast says "You're in." when `on_roster` is true. Otherwise it keeps "You're in. Open the game to finish joining." The game page's invite banner already said "You're in. The host has been told." and keeps it. (Since the 2026-11-24 follow-up below, both say the place waits for the parent when it is held for the guardian.)
  - The game page's invite banner says "This invitation has ended." for an `expired` invitation. It used to add "the game is no longer taking players", which is false for a taken-back invitation on an open game.
- The planned capacity rule ("participants plus approved requests that have no roster row") was not built. Paid games keep today's count. (Built later for a paid game's accept only, by `20261204110000`, below.)
- Tests: SQL 980 (and one 880 assertion that stated the old behaviour, now stronger), a race in `scripts/db-test.mjs` (two invitees accept the last free place, one gets it, the other is told `full`), and unit tests for the store, the host cleanup and the toast. e2e (2026-11-24): `e2e/invite-accept-roster.spec.ts`. The player accepts a free game's invitation from My availability (`GameInvitationsSection`), and the spec checks four things: `game_respond_invite` answers `accepted` with `on_roster`; the toast is exactly "You're in."; the roster row exists while the player's page stays on `/availability` and never writes `game_participants`; and the host's game page lists the player. The host's page is opened after the accept and checked on a fresh load, not over realtime.
- Rollback: `docs/rollbacks/20261127120000_invite_accept_roster.down.sql` restores the `20261119100000` definition and grants verbatim. It needs `app.confirm_invite_accept_roster_rollback=yes` and refuses if the function changed since. Roster rows written by accepts, and invitations marked `expired`, stay.
- **Release order (replaces step 5 of the order table):** publish the app first, then apply the migration. The published app reads `on_roster`, treats it as false when missing, and tolerates its own roster row already existing. The new function also works with the old app: its auto-join meets an existing row, a duplicate it already counted as joined, except when that row took the last place.
- **Follow-ups not done:**
  - ~~Paid games can still be over-approved by invitations; capacity for them still counts roster rows only. **Known limit, recorded (owner decision 2026-11-24): fix it before the pilot has paid games.**~~ **Closed by `20261204110000_paid_invite_capacity.sql`** (owner decision 2026-11-27, "Approve all as you'd recommend": option A, an approved player on a paid game holds the place until they pay, leave, are removed or declined, or the payment window releases it). The notes below the as-built lines are kept as written at the time.
    - As built: `game_respond_invite` is the `20261130110000` body apart from the capacity check. On a paid game (the fee the function already works out above 0, so a price above 0 with no settings row counts as paid) the check adds every approved request for the game that is not the accepting player's own and has no roster row. At `max_players` the accept answers the existing `{"status":"full","on_roster":...}`: nothing is written, the invitation stays pending for when a place frees, and the host is not told. The app already shows that answer, so there is no app change. Free games, the guardian-held place on a free game included, count roster rows only, as before. Same signature, owner, `SECURITY DEFINER`, `search_path` and grants; no table, trigger or policy changes. The guard requires md5 `79fa287fb3126c74dce0f902542d3e4e` (Postgres 16) and the new definition is `7372bcebab32979448f5327cd9f74413`.
    - Tests: SQL 999 (38 assertions; on the old definition 14 fail, all of them PAID ones) and a race in `scripts/db-test.mjs` (two invitees accept the last paid place at once: one approved, one told full, no deadlock). 989's pins of `game_respond_invite` now name `20261204110000` (one assertion added, 133). Rollback: `docs/rollbacks/20261204110000_paid_invite_capacity.down.sql` (needs `app.confirm_paid_invite_capacity_rollback = 'yes'`, puts the `20261130110000` body back verbatim); the rollback of `20261130110000` refuses until this one is rolled back.
    - Release: migration only, no app change. Before applying, record in production the function's md5 (Postgres 17 text may differ, in which case the guard refuses and a person looks first) and the read-only count of approved requests with no roster row on upcoming paid games (expected 0); both queries are in the migration's Release order section. Facts at 2026-11-27: no upcoming paid games and no payments ever. (Both recorded in batch 31: the count was 0.)
    - Not done: the host's own approval of a request has no capacity check and can still approve more players than there are places (the host's choice). The game page's places count, `game_invite_player`'s send-time `GAME_FULL`, `payment_claim_block`, PayPal and the join gate still count roster rows only, so a host can send an invitation that is then answered full, and among players already approved the first to pay takes the place. Stale approved requests with no roster row hold a place until someone clears them: requests left approved by removals before `20261129130000`, a leave whose best-effort request delete failed, and a deleted account's approved request (the account purge leaves `join_requests`, and the host may not see that player to remove them; leaving those out is an owner item). No backfill: a paid game already over-approved stays so and its invitees are answered full until places free. An approval whose payment window ran out still counts until the release sweep runs.
    - Facts at 2026-11-24: production has had 4 paid games ever, 0 payments, and no paid game upcoming.
    - What happens: on a paid game the accept approves every invitee while the roster has room, so several invitees can be approved for the last paid place (the host also gets one "accepted" notice each). The roster never exceeds `max_players`: placing a paid player checks the roster, and once the game is full an approved player who has not paid is refused before any money moves (the PayPal precondition and the manual claim answer `GAME_FULL`). Until then, the extras can pay; each payer after the one who takes the place keeps a verified payment and an approved request with no place, receives the `payment_not_placed` notice, and the host refunds them by hand. Nothing refunds automatically.
    - PayPal's double-charge window (two payers whose captures overlap within a few seconds) is independent of invitations: it exists whenever two approved players pay for the last place at once, however they were approved.
    - (Decided 2026-11-27: it does; built by `20261204110000`, above.) The fix (counting approved requests with no roster row in the paid accept's capacity) needs an owner decision first: whether an approved player who has not paid reserves a place on a game with no payment hold (`payment_hold_minutes` unset, the default). If it does, such a player blocks invitees until the host removes or declines them; if not, over-approval stays possible on those games.
  - ~~A host's Remove still deletes the player's request, which host rules do not allow, so it stays approved and the player's auto-join can put them back.~~ **Closed by `20261129130000_host_removal_and_decline_end_invites.sql`** (owner's choice, 2026-11-23). The game page's Remove (`hostRemoveParticipant`) calls `public.host_remove_player`, which only the game's host may call (exactly the roster DELETE rule). In one transaction it takes the roster row, declines the request as a host's decline does (`rejected`, "Removed by host", `last_rejected_at` stamped by the server), and cancels the pending invitation (`cancelled`, as `game_cancel_invite` writes). The app falls back to its old statements while the function is missing, and tries a removal Postgres ended in a deadlock once more. SQL 988 and the races in `scripts/db-test.mjs` cover it. e2e (2026-11-24): `e2e/host-removal-stays-removed.spec.ts`, two tests. The first runs on a free game that needs approval: the player requests, the host approves, and the game page's auto-join puts the player on the roster. The host then taps Remove on the roster. The test checks that the request is `rejected` ("Removed by host") and the roster row is gone. It then opens the game in a fresh browser as the player and checks that the page reads the declined request, writes no roster row, and the database has none. A player with an approved request is listed by `RosterPlayerRow`, whose Remove declines the request and deletes the row through PostgREST. That path predates this migration, so the first test guards the outcome, not `host_remove_player` (since 20261202100000 that Remove is one `host_remove_player` call, which test 1 asserts). With the request left approved, it fails: the page writes the roster row again. The second test uses an open game, where the player joined without a request, and taps the roster's bin and "Remove player". It checks that `host_remove_player` answers `removed: true` and the row is gone. Re-joining there is not asserted (see below; since 20261202100000 test 2 asserts it is refused). No test has a pending invitation, so the decline trigger has no e2e coverage. Still open, by scope:
    - Requests left approved by removals made before the migration stay approved. There is no one-off.
    - ~~On an open game (`requires_approval` false), the join gate never reads the request, so a removed player can still join again directly. 988 records this by name.~~ **Closed by `20261202100000_removal_sticks.sql`** (owner decisions 2026-11-24: "Removal sticks on open games"; the way back, "Ask the host, or an invite"). As built:
      - `host_remove_player` records the removal in the new table `public.game_removals` (game, player, `removed_at`; no `removed_by`), only when the player had something in the game (a roster place, a request of any status, a pending invitation) and never for the host's own seat. A stranger's id, an id with no account, or a deleted account's leftover request (`join_requests` has no foreign key to `auth.users`; the insert's foreign-key error is caught) writes nothing and gets the same answer as before, with no error. Its answer keeps its shape.
      - The join gate refuses a removed player (`REMOVED_BY_HOST`) on any game, for the player's own join and the server's place after a payment. Anyone else's insert for that player gets the roster's row-level refusal, as for a player not removed, so nobody can probe who was removed. `payment_claim_block` answers the same code, so PayPal, the manual claim and the payment terms refuse a removed player before money moves; a verified payment stays, and PayPal answers `ALREADY_PAID` to its payer. Both waitlist pickers (`notify_waitlist_on_spot_open` and `release_expired_payment_holds`) skip a removed player.
      - The only way back is an approved request for the game: an accepted invitation, or the host approving the request the player sends from the game page ("Ask the host to let you back in", the ordinary request; a resend of a declined one meets its 15-minute cooldown and 3-attempt cap). A trigger on `join_requests` deletes the record when the status becomes `approved`. A resend alone, a guardian's approval, a host's no, or an accept answered full does not lift it.
      - Two older holes that defeated this are closed in the same migration (found by the independent verifier). (1) Seat move: a player who hosts any game could UPDATE her own roster row in it and set `game_id` to another game (the one she was removed from, a full one, one that needs approval); "Users can update their own position" checks only `user_id`, `guard_participant_self_update` returns early for the row's host, and the join gate, capacity, approval and joined-count triggers run on INSERT and DELETE only. A new trigger `a0_game_participants_identity_locked` reuses `private_sec.lock_row_identity('user_id', 'game_id')` (20261125100000's waitlist and payment lock, unchanged): `game_id` and `user_id` are fixed for the API roles (`ROW_IDENTITY_FIXED`). No code moves a seat (the only database UPDATE of the roster is `host_mark_attendance`; no app, server or admin code updates the table), so the service role and definer code are left as they are. Position and attendance updates are unchanged. (2) Reopened claim: the claim check runs on INSERT only, so a removed player could move her own cancelled, declined or disputed claim back to `pending`. A new trigger `zz_payment_claim_reopen_removed` (function `private_sec.removed_player_claim_reopen_block()`) refuses only that move, by the player, while her removal record stands, with `REMOVED_BY_HOST` and the insert path's words. Her dispute or cancel, the host's changes (Mark unpaid included), the service role and players not removed are unchanged; after a lift she may reopen again. A claim still pending at the removal stays pending for the host to decide.
      - App: the game page treats a removed player (record present, not the host, not on the roster, request not approved) as request-to-join on any game. A banner says the host removed them and how to come back. The main button reads "Ask the host to let you back in". It is never "Confirmed", even with a verified payment, and a pending payment keeps "Payment pending · Tap to withdraw" (`viewerJoinFlags` in `src/lib/host-removal.ts`). A guarded minor's ask also waits for the guardian, and the host now sees it even when it carries the guardian-only key (`withoutGuardianOnly`). A guardian in force can read their child's removals (a third read rule, the expression of the guardian rule on `join_requests`), so the Parent Center says the host has to agree too instead of "it's up to you", and the child's Me tab line waits on the host as well. On a full or closed game the banner says the ask waits for a spot (the waitlist never tells a removed player) or that signups are closed. A player who already paid reads on the pay page that the payment is still recorded. The pay page shows a `removed` block in place of new payment options; the claim's status and withdraw stay. The roster row's Remove now calls `host_remove_player` directly (one call, shared 40P01 retry with the bin's Remove). The host's "paid, not on the roster" notice for this code says to invite the player back or approve their request, or refund them, and the host's toast after verifying no longer says "give them a spot" (it points to the notice). The data export lists the player's `game_removals` (game, time).
      - Tests: SQL 996 (removal, gate, privacy, the way back, paid, guarded minor, age range, capacity, waitlist, the seat move and the reopened claim refused with position, attendance, host, service-role and not-removed flows unchanged, RLS, cascades, pinned definitions; on the rolled-back schema its key assertions fail). 988's line now reads "CLOSED". The e2e spec's first test asserts the roster row's Remove is one `host_remove_player` call. Its second test opens the open game as the removed player and checks for the removed state; a direct insert is refused with `REMOVED_BY_HOST`.
      - Not done: no backfill of removals made before the migration (owner call; a partial one could use requests noted "Removed by host"; decided 2026-11-27: no backfill, batch 31). Remove and block still writes no record (`20261204100000` and `20261204110000` do not change that; recording it is an app change outside them). (2026-11-27: the app's Remove and block now calls `host_remove_player` first, so the removal is recorded.) `game_invite_player` is unchanged, so a removed adult with no post and no past game, or a removed minor, cannot be invited; their way back is the request. ~~The ask is not rate limited beyond the request row: the cooldown and cap live on the request, and a player may delete their own request ("Players withdraw own join requests"; the pending ask's cancel does this) and send a new one at attempt 1, notifying the host each time. That gap is older (20261129130000 and 20261130110000 record it) and holds on every approval game; 996 pins it as NOT CLOSED. Owner item: limit asks on the removal record, or stop players deleting a declined request.~~ Closed for removed players by `20261204100000` (next item); for players who were not removed it is still open. Rollback: `docs/rollbacks/20261202100000_removal_sticks.down.sql`. Hash pins that change: `docs/release/p0-1-verify.sql` (the gate) stops matching. The rollbacks of 20261119200000, 20261125100000 and 20261129130000 pin the replaced definitions and refuse to run until this one is rolled back (20261125100000's also lists the triggers that run `lock_row_identity`). This migration's rollback drops the roster lock and the claim reopen block first, and the two older holes open again after it. The rollback of 20261103140000 has no definition guard: run while this migration is applied it would silently overwrite the join gate and the release sweep (removals recorded, not enforced), so it must not run before this one. (2026-11-27: that rollback now has a definition guard and refuses while `game_removals` exists or any of its seven pinned bodies differs.)
      - **Ask limits and the block on resend: closed by `20261204100000_removal_ask_limits.sql`** (owner decision 2026-11-27, "Approve all as you'd recommend"). Two columns, one function and three triggers; no existing function, policy, grant or trigger changes and no stored row is rewritten.
        - Ask limits: `game_removals` gains `asks` (integer, not null, default 0) and `last_ask_at`, read under the table's three read rules and written by no API role. `private_sec.removed_player_ask_limits()` (`SECURITY DEFINER`, empty `search_path`, no API grant) runs AFTER a new request and AFTER a declined request is sent again (`trg_join_request_removed_ask_insert`, `trg_join_request_removed_ask_resend`), only for writes made as `anon` or `authenticated` (a trigger `WHEN` on `CURRENT_USER`), only for the player's own request, and only while a removal record stands. It refuses a fourth ask ("You have reached the maximum of 3 resubmit attempts for this game.") and an ask within 15 minutes of the previous one ("Please wait N seconds before resubmitting this request."), both P0001, the request row's own sentences, so the app needs no change. Deleting the request and asking again no longer starts over. A refused ask is not counted. An accepted invitation (inside `SECURITY DEFINER` code `CURRENT_USER` is the owner), the host, a guardian and the service role are never counted, and never refused by these limits (the older rules still refuse the host's and a guardian's resend). The host's approval lifts the record and its counts with it; a later removal starts at 0, a repeated removal keeps the count.
        - Block on resend: `enforce_host_block` ran on INSERT only, so a player the host blocked could move a declined request back to pending. A new trigger `enforce_host_block_resend` (BEFORE UPDATE OF status, `rejected` to `pending`) runs the unchanged function and refuses with the insert path's `BLOCKED_BY_HOST: you can't join this host's games.` It sorts before the resend limits, so a blocked player reads the block, not a cooldown. Only the player acting for themselves is checked, as on insert.
        - Tests: SQL 998 (105 assertions; without the migration 47 fail, among them the counter, cooldown, cap, definer exemption, budget, block on resend, column read rules and pins). 996's NOT CLOSED line now asserts the gap is closed (the record's cooldown after delete-and-ask-again, then a fourth ask refused). Rollback: `docs/rollbacks/20261204100000_removal_ask_limits.down.sql` (needs `app.confirm_removal_ask_limits_rollback = 'yes'`; drops the three triggers, the function and the two columns with their counts). The rollback of `20261202100000` refuses while this migration is applied: roll this one back first. No existing pinned md5 changes.
        - Release: apply after `20261202100000`; no app change. Applies before or after `20261204110000` (neither pins the other's definitions). The apply locks `join_requests` and then `game_removals` under a 5 s `lock_timeout`; a host's removal at the same moment can end the apply in a deadlock or the timeout, which leaves nothing behind and can be run again. Facts at 2026-11-27: production has no removal records and no `user_blocks` rows.
        - Not done: after the third ask the only way back is an invitation (the host cannot approve a declined request, `DECISION_FINAL`, and some removed players cannot be invited, `INVITE_NOT_AVAILABLE`). The cooldown runs from the previous ask, not from the host's no, and the first ask after a removal is immediate. Asks made before the migration are not counted (production had 0 removal records at apply). A refused ask sends no host notice (the app writes the notice after a successful ask). For players who were not removed the limits stay on the request row, with the delete-and-ask-again reset and a player's own INSERT able to set any `attempt_count` (owner item). A block declines and cancels nothing: a pending request stays pending for the host to answer. Remove and block still writes no record (an app change outside these migrations; since done, see above). `scripts/db-test.mjs` has no race for a removed player's ask against an invitation accept; the lock order is argued, not raced. (2026-11-27: `scripts/db-test.mjs` now races a removed player's resend against the accept of the host's later invitation, 24 rounds.)
  - A guardian's decline, or the payment window running out, does not end a pending invitation. The accept treats neither as a take-back (above), so the invitation stays open to accept, as before this WP.
  - A deliberate re-invitation after a decline gets the old pending invitation back from `game_invite_player`. This WP leaves that function alone, so a server-side fix is a follow-up: expire and replace a pending invitation whose request was declined after it was created. (Since `20261129130000` a host's decline cancels the pending invitation, so a later invite creates a new one.)
  - ~~**The known gap above.**~~ **Closed by `20261129130000_host_removal_and_decline_end_invites.sql` for every host decline made from then on.** The trigger `trg_join_request_host_decline_ends_invites` (AFTER UPDATE OF status on `join_requests`) cancels the player's pending invitation to that game when a request becomes `rejected` by the host's or a moderator's decision. It skips the two declines the taken-back rule excludes (the payment window and a guardian's no, even when the host is that guardian) and declines with no signed-in user. Deleting or resending the request no longer reopens the invitation, because it is already `cancelled`. The trigger waits for whoever holds the invitation (an accept that then times out, a player deleting the availability post it came from), so a holder that writes nothing does not leave it pending; races in `scripts/db-test.mjs` cover both. Still open: if Postgres ends the trigger's wait in a deadlock with an accept or a removal under way, the decline commits without cancelling and relies on that holder reading the declined request; a holder that then fails leaves the invitation pending. Also still open: invitations already pending under a request declined before the migration rely on the taken-back rule alone, because no one-off was run (production had 0 pending invitations at apply, batch 28, so none exist) (980's KNOWN GAP fixtures still behave as recorded there). The note below is kept as written at the time. The owner's choice of fix, each outside this WP: end the player's pending invitations to the game on the server when a request is declined (for example in `enforce_join_request_resubmit_rules`, which already stamps `last_rejected_at`), or pin `last_rejected_at` on a player's resubmit and stop players deleting a declined request, plus a one-off expiry of invitations that are pending under a request declined since they were sent. Until then the app's cancel at decline time is the only protection that survives a deleted or rewritten request, and invitations already pending in production under a declined request have none.
  - A host who invites again while a taken-back invitation is still pending (declined before this release, or the app's cancel failed) gets that same invitation back from `game_invite_player`, with its old `created_at`; the player's accept then expires it. Inviting once more after that creates a new one.
  - The accept still takes the invitation, the game, then the request, the order it always used. `host_remove_player` (`20261129130000`) takes them in that same order, so the two queue rather than deadlock. The decline trigger holds the request and waits for the invitation, so a host's decline at the same moment as an accept under way for the same player can deadlock. Postgres ends one side: either the accept (nothing of it is kept; the app tries it once more and the player sees `cancelled`) or the trigger's wait, which the trigger gives up so that the decline still commits and the accept answers `expired`. The removal shares the accept's residual, though: the accept and the removal hold the game and then the request, while `release_expired_payment_holds` and `guardian_cancel_child_game` hold the request and then update the game (the roster delete's joined count). So these can deadlock (`40P01`) when they start within a few milliseconds of each other: a guardian's cancel against a removal of the same child or against that child's invitation accept, and the sweep against a removal or an accept of the same player or of another player in the same game whose hold has also run out (the sweep locks every expired request in the game up front). Postgres ends one of the two whole; nothing half-done is kept. A removal can also deadlock with the player's own Leave (a bare roster delete, which takes the roster row and then, through the joined-count trigger, the game). A later study (2026-11-24) reproduced these on a scratch replay. Each "game first" order it tried moved the deadlock onto the guardian's cancel or the sweep against the child's own Leave, because Leave takes the roster row before the game (a "game last" order was not tried). So they are handled in the app, not the database: an ended removal (`hostRemoveParticipant`), an ended invitation answer (`respondToGameInvite`) and an ended guardian cancel (`cancelChildGame`) are each tried once more, and only a second deadlock reaches the screen, as the existing "try again" message; an ended sweep runs again on its next schedule; an ended Leave (`leaveGame`) shows no message: it puts the player's "joined" mark back when the page had it, and otherwise the page shows them as left until its next roster sync (the next load or realtime event), after which they can leave again.
  - ~~The e2e test (accept from My availability, the player shows on the host's roster).~~ Written 2026-11-24: `e2e/invite-accept-roster.spec.ts`.

**As built (2026-11-24): deadlock retry, a guardian's cancel keeps a declined request, a reopened declined request needs the guardian again, and a held accept is told to the guardian**

- **Retry on a deadlock (app only).** `respondToGameInvite` (`src/lib/game-invites.ts`) and `cancelChildGame` (`src/lib/guardian-activity.functions.ts`) try their call once more when Postgres ended it in a deadlock (`40P01`), the same shape as `hostRemoveParticipant`. Both database functions (`game_respond_invite`, `guardian_cancel_child_game`) are single PL/pgSQL calls, so each runs in one transaction with no `COMMIT` and no exception handler of its own; a deadlock ends it whole, and repeating it is safe. The retry reads what the other side did: an accept after a host's decline that won answers `cancelled` or `expired`; an accept after a guardian's cancel that won finds no request, or a declined one whose guardian approval the cancel took back (below), so it approves a request with no guardian approval and the guardian rule keeps the child off the roster, as a second tap by hand would; a guardian's cancel after a removal that won finds the removal's declined request (kept, below). `respondToGameInvite` checks the database error's code before it wraps the error, so every other caller of the shared `call()` sees the same errors as before; any error other than `40P01` is not repeated. A second deadlock reaches the screen as before ("Something went wrong. Please try again." for an invitation; "Couldn't cancel your child's spot. Please try again." for the guardian). Unit tests: `src/lib/deadlock-retry.test.ts`.
- **A guardian's cancel keeps a declined request** (`20261130110000_guardian_cancel_keeps_declined_request.sql`, owner decision 2026-11-24). `guardian_cancel_child_game` deleted the child's request for the game whatever its status, so a request the host had declined (any Decline, the removal's "Removed by host") went too, and with it `last_rejected_at` and `attempt_count`: the child could ask again at once, with no cooldown and a fresh attempt cap. The function now deletes only a request that is not `rejected`; a declined one, whatever its note (a guardian's own "Declined by guardian" included, on purpose), stays as it was (status, note, `last_rejected_at`, `attempt_count`), except that any guardian approval left on it is taken back. A host's decline or removal leaves the guardian's earlier approval on the request; the old delete took it away with the row, and kept, it must not outlive the guardian's own cancel (her no on a request takes back her approval too). Whether a later invitation seats the child no longer hangs on this: the reopen rule below holds a guarded minor on any reopened declined request; the take-back keeps the kept row consistent (a resend, a later approval, what the request shows). Everything else is unchanged: unreviewed payment claims are deleted and verified ones kept, pending and approved requests and the roster row are deleted with their triggers, the host is told when a place opens, the answers are the same (`cancelled`, `withdrawn` (also when the only row was a declined request), `nothing`), and so are the signature, owner, `SECURITY DEFINER`, `search_path` and grants.
  - What people see: the app ignores the answer. The Parent Center lists only pending and approved requests, so a guardian meets a declined request only through a list loaded before the host decided; the cancel then reports success ("Spot cancelled." or "Request withdrawn.", as before) and the game leaves the list. The child keeps seeing the request as declined (game page, Me tab), as they did before the cancel, and may ask again after the 15-minute cooldown and within the 3-attempt cap. Whether a minor comes back through a resend or by accepting a new invitation from the host, they are seated only once the guardian approves again.
  - Not done: declined requests already deleted by a guardian's cancel are not put back. A player can still delete their own declined request through the API (the app never does) and send a new one, as before.
- **A reopened declined request needs the guardian again** (same migration, owner decision 2026-11-24, "Fix it in this PR"). With no guardian cancel at all, a host's decline or removal, and the payment window running out, left the guardian's approval on the declined request, and an invitation the minor then accepted (`game_respond_invite` moves the request from `rejected` straight to `approved`) seated them on it on a free game, or, on a paid game, let the roster row written after the payment through without the guardian. The rule since `20261110120000` is that a reopened request does not ride on an approval given for an earlier attempt that was turned down, but its trigger (`trg_join_request_reopen_needs_guardian`) fired only on the child's resend (`rejected` to `pending`). Two changes close it:
  - the trigger now also fires on `rejected` to `approved` (same name, timing and function; only its `WHEN` is widened), so whoever reopens a declined request to approved, the approval on it is taken back. In practice that is `game_respond_invite`; the service role writing the row directly is covered too. Clients cannot: the host is refused by `DECISION_FINAL` (`20261125100000`) and the player's update rule allows `rejected` to `pending` only;
  - `game_respond_invite` (the `20261127120000` body plus two tests and two variables) treats a request it moves from `rejected` as carrying no guardian approval when it decides whether the place is held. Without that it would read the approval from the row as it was before its own update, try to seat the minor, and the roster's guardian rule would end the whole accept with an error. The exception is a guarded minor (a minor with an active guardian link, the same test the held decision uses, worked out once) still on the roster under a host's decline that did not remove them: the accept leaves that request declined, with its approval, and answers as before (`accepted`, `on_roster: true`, also on a full game). Reopening it would take the approval back from a child who keeps the place, leave an item in the guardian's list she could not act on (`ALREADY_ON_ROSTER`, for Approve and Decline alike), and make a full game answer `full`. A later rejoin, after leaving or being removed, still needs a fresh approval; because the request stays declined, a later removal leaves it as it is (no "Removed by host", no fresh cooldown), and the child's resend waits for the guardian. For adults and minors with no active guardian link the accept does exactly what `20261127120000`'s did: it reopens the declined request to approved ("Invited by the host"), so the host's later removal declines it again ("Removed by host") and the 15-minute resend cooldown applies. How a player gets there: `game_invite_player` refuses a player on the roster (`ALREADY_IN_GAME`) and a host's decline cancels the pending invitations, but a player with a declined request can be seated after an invitation was sent if the host opens the game (approval off): the player takes a place directly (the join gate allows it on an open game; the game page's UI for this was not checked) and then accepts. An adult or a minor with no guardian link can do that; a guarded minor's own join on a declined request is refused by the roster's guardian rule, so a guarded minor gets there only if the guardian link is made after such a join (run on a scratch replay with a 17-year-old), or through older data or a direct invitation write.
  - What people see: a guarded minor who accepts such an invitation gets 980 section 5's guardian-held path: the answer is `accepted` with `on_roster: false` (both accept toasts, My availability's and the game page banner's, say the place waits for the parent, see below; the game page says "The host said yes · waiting for your parent" and its auto-join waits for the guardian), the request is approved with no guardian approval and no roster row is written. It appears in the guardian's Parent Center list (pending and approved requests with no guardian approval); the guardian approves it there and the child then takes the place from the game page, or after paying on a paid game. The accept's reminders are saved as on any accept and go out in the app only until the place is final. Adults, and minors with no active guardian link, are seated on a free game as before. The child's resend, the taken-back rule, the decline trigger (`20261129130000`), capacity and payment rules are unchanged. The guardian notice and the accept words are app changes (below).
  - Not done: minors already seated on an old approval stay seated. Requests a live `20261127120000` accept already reopened with the old approval on them and no roster row (a paid game's accept writes none) are not rewritten, so the roster write after a payment still passes on that approval; the rollback file's PRODUCTION CHECK has the read-only count to record (approved, not on the roster, `guardian_approved_at` older than `last_rejected_at`; expected 0), and clearing any would be an owner decision. (Recorded 0 in batch 29.) On a paid game with a payment hold, the hold's window starts at the accept but a held minor cannot pay before the guardian approves, and her approval does not restart it, so the sweep can release the place first (already so on 980 section 5's path).
  - Two races end differently, both with the child's declined request moved out of `rejected` while the guardian's cancel runs. The cancel's delete no longer waits for a declined row, and its clearing update, which does wait, finds the row no longer declined and skips it; the cancel still answers `withdrawn` (the app reports success). An accept reopening the request: the request the accept commits as approved stays, with no guardian approval and no roster row: it is back in the guardian's list, held for her (the old delete waited and deleted it); a guarded child on the roster under the decline ends with the request declined, no approval and no place. The child's resend (`rejected` to `pending`, after the cooldown): the pending request stays, with no guardian approval (the resend's trigger cleared it), the child is not seated, and it shows in the guardian's Parent Center list, which is what a resend right after the cancel gives too (the old delete waited and deleted it). Either way the child gets no place without a fresh guardian approval. All were run by hand on scratch replays.
  - Locks: `CREATE OR REPLACE TRIGGER` (one statement, SHARE ROW EXCLUSIVE on `join_requests`: writers wait, readers do not; `lock_timeout` 5 s) rather than `DROP TRIGGER` and `CREATE TRIGGER`, so there is no moment without the trigger and readers never wait. The functions are replaced first, so a partly applied migration never makes an accept fail.
- Tests: SQL 989 (132 assertions). Against the definitions before the migration (the rollback applied on a scratch replay) 43 of them fail: in sections 1 to 8 the declined requests are deleted and the children's resends go straight through (KEPT; the two STAMP ones read the kept row's approval); in sections 9 and 10 the guarded minor is seated on the old approval after a removal or a decline, the paid place is taken without the guardian, the approval stays after the payment window's release and after the service role's write, a guarded minor still on the roster has the declined request reopened (and, once he leaves, takes the place again on the old approval), and the pinned definitions differ (REOPEN). Section 9h's adult checks (the accept reopens the declined request, and the host's later removal declines it again with a fresh cooldown) pass on both. Section 8's checks that the re-invited child is held pass with or without the cancel's take-back (the reopen rule holds him either way). A race in `scripts/db-test.mjs` runs the cancel against the host's removal of the same child: Postgres ends the cancel whole (`40P01`), the removal commits, and the cancel tried once more answers `withdrawn`, keeps "Removed by host" and takes back the approval; the cancel waits until it sees the removal waiting on it (`pg_locks`), not for a fixed time. SQL 760, 980, 982 and 988 pass unchanged.
- Rollback: `docs/rollbacks/20261130110000_guardian_cancel_keeps_declined_request.down.sql` restores the `20261008160000` body of `guardian_cancel_child_game`, the `20261127120000` body of `game_respond_invite` and the `20261110120000` trigger condition, verbatim. It needs `app.confirm_guardian_cancel_keeps_declined_rollback=yes` and refuses if any of the three, the trigger's enabled state, the functions' owner (`postgres`) or their grants changed since (md5 of each function, and of the trigger's `pg_get_triggerdef` with its `tgenabled`, as the `20261129130000` rollback does); its post-check reads the same. Requests kept meanwhile stay as they are, and approvals taken back stay taken back. Run it before the `20261127120000` rollback, whose guard expects that body of `game_respond_invite`. After applying in production, record the three md5 values its PRODUCTION CHECK lists (`791f8fe8e4412acd7fe80b34a516809a`, `79fa287fb3126c74dce0f902542d3e4e`, `5480c92ea0314eef6701e1b2d266ddce/O` on Postgres 16, and both owners `postgres`) and its read-only count of approved requests carrying a pre-decline approval.
- **The guardian is told when an accept is held for them, and the accept says so** (owner decision 2026-11-24, "Fix both in the PR"; app only, no database change). Both gaps were older than this change and shared with 980 section 5's guardian-held accept.
  - Notice. After an accept answered `accepted` with `on_roster` false (or missing), `respondToGameInvite` asks the server once, after the final answer (a `40P01` retry asks once, not per try), fire-and-forget: `notifyGuardiansOfPending` with the new kind `invite_accept`, naming the invitation. `planGuardianApprovalPush` (`src/lib/guardian-push.server.ts`) reads everything with the service role and sends nothing unless the invitation is the caller's and `accepted`, its `join_request_id` is the caller's request for that game, the request is `approved` with no `guardian_approved_at`, and the child has no roster row: exactly an item in the guardian's Parent Center list that waits for them. From there it is the pending request's own path: the child's notifications switch (`child_controls.notifications`), the guardian links in force (`guardian_links_in_force`: nobody for an adult unless the account is managed, an 18-year-old's old link, or a minor with no link), one `guardian_approval_needed` row per guardian linking to the Parent Center named by the request (`/parent?request=<join request id>`; the page ignores the parameter), then a push through `deliverPush`, with the same send function and gate as the pending request's push (its quiet-hours and off-switch check on the recipient, and the delivery log). It says "<child> accepted an invitation to <game>. Review it in the Parent Center." under "Approval needed". Blocks are treated as for the pending request (not checked by the notice; the invitation itself was refused across a block).
  - Not twice. The request row cannot say what it was before the accept, so the guardian's notices are the record: a guardian who already has a `guardian_approval_needed` notice about this request, written since the request's current attempt began (the later of its insert and its last decline, `last_rejected_at`, which the host's decline, "Declined by guardian" and a released payment hold all stamp), is not told. A notice is about this request when its link names it; a notice written before links named the request (plain `/parent`) counts when its words are the pending request's or this one's for this child and game. So a request the accept created, or reopened from a decline, is told once; a request already waiting for the guardian (pending, or approved by the host) was told when it was sent and is not told again; a retry, a second tap or an invitation answered again finds the notice, however long ago it was written. A notice that names another request (another game with the same title, or another child with the same name) does not count; a plain-`/parent` notice written before this release, in the same attempt, still matches by its words. The send's one-hour duplicate check now matches the link as well as the words, and for a held accept looks back only to the start of the attempt, so a held notice, a decline and a new accept inside the hour still tell the guardian; it remains the backstop for two pings inside one attempt. A failed read of the notices counts as not told (as the pending request's send does), so the guardian is told. The pending request's notice now carries the request's link too, built from the stored request's id and not from the id text the child sent: Postgres finds a uuid however it is spelt (letter case, braces, no hyphens), so a link from the caller's spelling would differ on each call and pass the one-hour check every time. Its words, gate and one-hour check are otherwise unchanged. Limits: the ping is client-initiated and best effort, as for a pending request, so a lost ping tells nobody; two pings at the same moment from two devices can both send (check, then insert, as for a pending request); and with the child's notifications switched off nobody is told, as for a pending request. The accept toast therefore does not say the guardian was told (see Words). The game page's banner (`playerWaitCopy`, shared with a pending request, and the open-game copy in `guarded-open-join`) still says "we've let them know", which these limits make untrue in those cases; that wording predates this change and is left for the owner.
  - Words. Whether the place waits for the guardian is the game page's own rule (`joinWait`: a guardian link in force and a request with no guardian approval), read after the answer by `acceptWaitsForGuardian` (`src/lib/game-invites.ts`; never throws, and a failed read keeps the usual words). When it does, `GameInviteBanner` and the Players tab's `GameInvitationsSection` both say "Invitation accepted. Your parent has to approve before you're in." (`src/lib/invite-accept-copy.ts`). It does not claim the guardian was told: the ping is best effort and not awaited, and tells nobody with the child's notifications off, so the toast cannot know. Otherwise the banner keeps "You're in. The host has been told." (free and paid games) and the Players tab keeps "You're in." (on the roster) and "You're in. Open the game to finish joining." (a paid game). The banner closes and the page refreshes as soon as the accept is committed; the words follow the check, so a slow read delays only the toast. The game page's "The host said yes · waiting for your parent ... we've let them know" is now true for a held accept, within the limits above.
  - Not done: the guardian's in-app `game_invite` copy written when the host invites (`game_invite_player`) is a separate, older notice and is unchanged.
  - Tests: unit `src/lib/guardian-push.server.test.ts` (invite_accept: who is told, only the invitee, the invitation's and the request's states, a seated child, an adult, an unlinked minor, notifications off, already told while pending, told again after a decline, a held notice then a decline then a new accept inside the hour told again through the send, a same-titled game's notice not counted by the plan or the send, a notice naming the request counted whatever its words, other games' and other types' notices, sent once across repeats however old the notice, a failed or throwing read tells; the request link on the pending notice and the plain link on a team invite), `src/lib/guardian-approval-kinds.test.ts` (the server function's input accepts `invite_accept` and refuses an unknown kind), `src/lib/game-invites-held-accept.test.ts` (one ping after the final answer, also after a deadlock retry; none when seated, declined, full, expired, cancelled or failed; the held check; the words), `GameInviteBanner.test.tsx` and `GameInvitationsSection.test.tsx` (held and not held; the banner closes and the row is freed while the check is still reading).
- Release order: either order; the app does not depend on the new definitions.
- Still open, for the owner (older than this change): a held minor's payment-hold window (above); and an invitation sent before a guardian's "Declined by guardian" can still be accepted (the take-back rule excludes that note), so the request reopens to approved and is back in the guardian's list after she said no (held, not seated). The older gaps recorded above (a player deleting their own declined request through the API; invitations pending under declines made before `20261129130000`) are unchanged.

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

**As built (2026-11-23)**

- Migration `20261129110000_attendance_prompt.sql`: the nullable column `hosted_games.attendance_prompted_at`, guarded like `push_sent_at` (trigger `hosted_games_attendance_prompted_at_server_only`, function `private_sec.guard_hosted_game_attendance_prompted_at()`, SECURITY DEFINER, `search_path = ''`). No member or visitor sets, changes or clears it, on insert or update, directly or through a SECURITY DEFINER function, so a host can neither silence nor replay their prompt. The host's other edits and `host_mark_attendance` are unchanged.
- `notifications.type` has no CHECK constraint (checked in the replayed schema), so the new type `game_attendance_prompt` needed no schema change.
- The sweep is `promptHostsForAttendance` in `src/lib/game-reminders.server.ts`, in the same 5-minute run. A game gets a prompt when all of these hold:
  - it is not cancelled (`status = 'cancelled'` or `cancelled_at`);
  - 2 hours have passed since its end, by the app's rule (`gameEndsAt`: `ends_at`, else the start plus its duration), but not more than 24 hours past that point. Without that limit every past game would prompt at once when this ships;
  - it has a roster row for someone other than the host;
  - no roster row has `attended` or `attendance_marked_at` set;
  - `attendance_prompted_at` is NULL.
- Each game of a series is its own row and is prompted once.
- Who gets it: the game's host (`hosted_games.host_id`). `host_mark_attendance` and the `guard_participant_attendance` trigger let the host (and moderators) mark, once the game has started and unless it is cancelled; a prompt 2 hours after the end of a game that is not cancelled meets those rules.
- Reads at any volume (review findings, 2026-11-23): cancelled games are dropped in the query (`cancelled_at IS NULL`, status not `cancelled`), and every unprompted game started in the last 3 days is read page by page (`range`, ordered by date and id, until a page comes back empty), so the API's row cap never hides a due game behind games that will never be prompted. A run reads at most 10 pages; past that it works on the oldest games it read and the rest wait. The games in the window are then walked soonest due first, 50 at a time; each batch's roster is read page by page too, so "already marked" and "has a player besides the host" are decided on the whole roster. A batch whose roster is not read whole within 20 pages gets no prompt this run. The run stops at 50 prompts or when the run's shared 3-second budget is spent (the prompt runs last, after the reminders and the invite pushes; a run whose time is already up reads nothing); the rest wait for the next run. Known limit: a game that is marked or has only its host is never stamped, so every run checks it again while it is in the window; at very high volume the budget could run out before newer games are reached. Not a concern at pilot volume.
- Once only, in one transaction: function `public.send_attendance_prompt(text, text, text, text)` (SECURITY DEFINER, `search_path = ''`, EXECUTE for `service_role` only) sets `attendance_prompted_at` only where it is still NULL, checking again that the game is not cancelled, has a non-host participant and has nothing marked (so a host who marks attendance while the sweep runs gets no prompt), then writes the host's in-app notice and returns its id. NULL means nothing was sent. A run cut off between the claim and the notice (pg_net's 5-second limit cancels the Worker) can therefore never leave a game stamped without its notice, and a notice that cannot be written leaves nothing stamped, so the next run retries (review finding, 2026-11-23). The push follows the host's Game reminders push switch and goes through `deliverPush` (a minor host's quiet hours, a guardian's switch). The function's update, called by the service role, passes the `hosted_games` guards, as server writes do, and `touch_updated_at` stamps `updated_at`.
- The notice and push: "Who showed up at <game title>?" / "Mark who showed up. It builds your host reliability score." No player names (the sweep never reads profiles) and no venue.
- The link is `/games/<id>?tab=overview#attendance`. There is no roster tab: the tabs are Overview and Payments (paid games only), and the Attendance block is in the roster section of Overview (`games.$gameId.index.tsx`, now about line 2812). That block is now `HashScrollTarget` with the stable id `attendance` (`src/components/game-detail/HashScrollTarget.tsx`). It appears only after the roster loads, so it scrolls itself into view when it first renders and the URL's hash names it. `?tab=overview` brings a paid game's page back to Overview.
- Settings: `game_attendance_prompt` maps to Game reminders (its description now mentions the nudge). The prompt goes 2 hours after the end, whatever the hour: a late or all-day game prompts an adult host around midnight to 2 a.m. (all-day games end at local midnight). Quiet hours apply only to minors.
- Rollback: `docs/rollbacks/20261129110000_attendance_prompt.down.sql`. Revert the sweep code first: the run reads the column and calls `send_attendance_prompt`. It needs `app.confirm_attendance_prompt_rollback=yes`, and `app.attendance_prompted_at_exported=yes` while any game has a stamp; it refuses if either function, the trigger or the column changed, if anything else depends on the column, or if a function other than those two names it. It drops `send_attendance_prompt`, the trigger, the guard function and the column. Roll back WP 5.6 before WP 5.4.
- Tests: SQL `984_attendance_prompt.test.sql` (also: `send_attendance_prompt` is SECURITY DEFINER and service-role only, prompts a due game once, nothing for a cancelled, marked or host-only game, and a notice that cannot be written leaves the game unstamped); unit `src/lib/invite-push-attendance-sweep.test.ts` (once per game and for two runs at once, the 2-hour and 24-hour edges with `ends_at`, none for cancelled games, none once attendance is marked, none without a non-host participant, series games each once, no names or venue in the text, the push setting, a minor host's quiet hours, nothing stamped when the notice fails, a run cut off mid-prompt never leaves a game stamped without its notice, a run out of time reads nothing, the anchor wiring; at volume against a 1000-row cap: a marked row past the cap still counts, a due game behind 1200 cancelled and host-only games is found, the oldest games are prompted when more exist than a run reads, any row cap is paged through, and an unreadable roster prompts nobody).
- e2e (2026-11-24): `e2e/attendance-prompt-link.spec.ts`. The fixture player is on the roster of a game that has ended. The fixture host opens `/games/<id>?tab=overview#attendance` cold, in a new browser on a phone-sized page, and the spec checks that the Attendance block is scrolled wholly into view. Opened without the hash, the page stays at the top and the block is below the fold. A run with `Element.scrollIntoView` made a no-op fails, so the spec checks `HashScrollTarget`'s own scroll. Seeding: the database refuses a self-join to a game that is over by the clock, and RLS refuses a host writing another member's roster row. So the game is created 30 minutes after its start, the player joins, and the host moves the start 2.5 hours back. The game then ended 30 minutes earlier, inside the 2 hours before the sweep would prompt, so no prompt notice is written.

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
  - The server equivalent of the client's "age review pending" check is not in the maps. Find it before building. (Found: `profiles.age_review_required`, read as `age_cohort = 'adult' AND NOT age_review_required` in `20261127100000_superadmin_funnel.sql:234`.)
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

**As built (2026-11-23)**

- Decision 12 was taken as its default, "enforce". The first production run waits for the owner: the migration purges nothing itself, so applying it to production is the go-ahead, and the first deletion is the job's next 03:37 UTC run after that. (Applied in batch 27; the first run, on 2026-11-24, succeeded and deleted nothing, batch 28.)
- Migration `20261129120000_diagnostics_purge.sql`. Rollback `docs/rollbacks/20261129120000_diagnostics_purge.down.sql`. It needs `app.confirm_diagnostics_purge_rollback=yes` and refuses if either function, their grants or the job changed since. It unschedules the job, then drops both functions. Rows already deleted cannot be restored; the release record must say so.
- `public.purge_diagnostics(_older_than interval DEFAULT '90 days', _max_rows integer DEFAULT 100000)` follows `purge_app_error_events`: SECURITY DEFINER, `search_path = ''`, EXECUTE for `service_role` only. It returns the count per table and `capped` as jsonb. It deletes rows whose `created_at` is strictly older than the window, so a row exactly 90 days old stays until the next night. It refuses a window under one day.
- Each table's timestamp is `created_at` (`timestamptz NOT NULL DEFAULT now()`). A DELETE fires nothing: the only triggers, the two `aa_anonymise_minor_*`, run before insert or update. No foreign key points at the three tables, and no view or function reads them. What the app reads fits inside the window: the push problems card reads the last 7 days, and the superadmin card reads the newest 10 rows. The admin location analytics page offered "Last 180 days"; since the 2026-11-27 open-items change it offers at most "Last 90 days" (live from the first publish after that change).
- Bounded, not batched. A function with a SET clause cannot commit part-way, so each call is one transaction. It deletes at most `_max_rows` per table, and a larger backlog drains over the following nights. The function sets `lock_timeout = 5s`. A DELETE takes ROW EXCLUSIVE, which the app's inserts and reads do not wait on. No index was added: `notification_delivery_log` has no index on `created_at` alone, so the daily run scans it.
- `private_sec.schedule_diagnostics_purge()` (no API role can call it) schedules `purge-diagnostics` at `37 3 * * *` (03:37 UTC) where pg_cron is installed. Otherwise it does nothing. 03:37 is not used by another job: the daily jobs run at 03:17, 04:17, 04:41, 04:47, 04:51 and 08:47, one hourly job runs at :23, and the rest run every 5 minutes or every minute.
- SQL test `986_diagnostics_purge.test.sql`: each table at the boundary (400 days, 90 days and 1 second, exactly 90 days, just under, now); only the service role purges (a member, an admin and a visitor are refused), and no API role, the service role included, reschedules the job; a second run deletes nothing; the cap and the nights after it; the job only with pg_cron.

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
