# Open items

One register of the Phase 5 open items, as of 2026-11-27. It gathers the "Still open", "Not done" and owner lines from the plan, the release records, the privacy gap register and the migration headers, after each was checked against `main`. Duplicates are merged into one line that keeps their main sources.

Pilot readiness: `docs/product/pilot-checklist.md`. Plan: `docs/product/phase-5-validation-plan.md`.

How to read the sources:

- `plan` is `docs/product/phase-5-validation-plan.md`, `checklist` is `docs/product/pilot-checklist.md`, `register` is `docs/release/privacy-gap-register.md`.
- `batch-N` is the release record `docs/release/records/*-batch-N.md`. Other records are named by their file name without the date.
- A bare migration version such as `20261204110000:58` is that file in `supabase/migrations/`.
- Line numbers refer to `main` at eae85372, before this PR.

When an item closes, move it to a closed section with the record that closed it. Never write pilot users' names, emails or phone numbers here.

## Needs the owner

### Before the pilot starts

Gate 1 (`plan:647`) holds until the checklist's open A rows are ticked: A1 to A6, A11 and A12.

- **Pilot start date (A2).** Which Monday does the pilot start? Default: the Monday of the first recruiting week, because the funnel counts weeks from a Monday and the setting is unset today. Source: `checklist:17`; `plan:93-95`, `:151`, `:268`; `batch-24:67`.
- **The other three legal pages (A4).** The payment policy, AI disclosure and youth policy pages have no published text in production, so they show the placeholder banner, and the landing page footer links to all three. Publish them, or accept the banner for the pilot? Default: publish the payment policy and AI disclosure before week 1; the youth policy can wait for the teen gate if the owner accepts its banner. Source: `checklist:19`; `src/lib/legal-documents.ts:14`; `src/routes/index.tsx:574-580`.
- **Real push (A3, gate 4).** Will you send the Ops "Push delivery test" to your own phone, then one real invite push, and record both? Default: yes, before pilot week 1, because "sent" in the delivery log only means OneSignal accepted it, and WP 5.4 counts as done only with a received invite push. Source: `checklist:18`; `plan:143`, `:349`, `:377`, `:650`; `batch-26:61`.
- **Support mailbox (A6).** Will you send a test message to the support address and see it arrive? Default: yes, because the Help drawer's only escalation is that mailbox. Source: `checklist:21`; `plan:146`.
- **Free games (A11).** Will each pilot host agree to run free games? Default: yes, ask each host, because there is no switch for host-charged games and PAY-1 is not finished. Source: `checklist:26`; `plan:118-120`, `:150`.
- **Moderation reader (A12).** Which role reads the moderation queue every day of the pilot? Default: the owner, from the AttentionStrip "New reports" chip, because the chip already counts new reports and opens the queue on the New filter. Source: `checklist:27`; `plan:152`.
- **Staging capacity.** Move the staging project to the Small compute size (about $15 a month, 90 connections)? Default: yes, because PGRST003 pool timeouts on a pool of about 11 are behind the E2E failures in runs 1421, 1424 and 1429, and every production apply is rehearsed on staging first. Source: `docs/release/sandbox-verification.md:70-71`; `batch-18:42`; `batch-20:39`; `batch-31:89-96`.
- **Required reviewer on `e2e-sandbox`.** Is it saved? Default: read GitHub Settings, Environments, `e2e-sandbox`, and record yes or no, because the E2E design assumes every run waits for an approval. Source: `docs/release/sandbox-verification.md:72`.
- **Playwright as a required check.** Make it required? Default: not yet. Wait for the staging upgrade and 10 green `main` runs in a row, because it still fails under staging load. Source: `docs/release/sandbox-verification.md:32`; `register:87`.
- **Superadmin E2E fixture.** May a superadmin fixture account, with its password committed to source like the others, exist on staging? Default: yes, staging only, because it unskips `superadmin-funnel` and `free-mode-superadmin`. The fix is then code (a fixture in `TEST_ACCOUNTS` and the CI seed), not a secret. Source: `plan:284`.

### Checks to run later

- **Attendance coverage (WP 5.6 acceptance).** In pilot week 2, record the raw counts behind "marked" coverage before and after 2026-11-23? Default: yes, raw counts, because the funnel masks rates below 5 at pilot volume. Source: `plan:500`.
- **Diagnostics purge (WP 5.9 acceptance).** On or after 2026-12-12, check read-only that the rows from 2026-09-11 are gone? Default: yes, and reword the acceptance to say production, because the sandbox has no pg_cron. Source: `plan:613`.
- **Weekly review (WP 5.10).** From pilot week 2, write `docs/product/pilot-week-N.md` each week with totals only, the drop-off chosen and the WP opened? Default: yes. Source: `plan:625-639`, `:667`.

### Game and invite rules

- **Way back after the third ask.** May a host always invite back a player they removed from that game? Default: yes, for adults, by letting a removal record count as a relationship in `game_invite_player`, because today a removed player with no post and no past game has no way back after the third ask. Source: `plan:447`, `:453`; `batch-31:70`; `20261204100000:78-79`; `20261202100000:131-132`.
- **Request caps for players not removed.** Force `attempt_count` to 1 on a player's own new request? Default: yes, because an inserted 0 or negative count widens the resend budget. The alternative also stops players deleting a declined request (the app never does that). Source: `plan:447`, `:453`, `:466`, `:483`; `batch-31:73-74`; `20261204100000:86-88`.
- **Blocks.** Should a block also decline the player's pending requests and cancel their pending invitations to the blocker's games? Default: no change for the pilot, because the host still sees the request and the roster gate refuses the player. Source: `plan:453`; `batch-31:75`; `20261204100000:89-90`.
- **Deleted accounts.** Should a deleted account's join requests stop counting against a place? Default: yes, delete them in the account purge, because the host may not see that player to remove them. Source: `plan:433`; `batch-31:80-81`; `20261204110000:67-71`.
- **Free-game capacity.** Should a free game's accept also count host-approved players who have not opened the page yet? Default: leave free games as they are, because counting them would also let stale approvals block invitees. Revisit if hosts report full-roster surprises. Source: `plan:424`.
- **Paid places count.** Should the game page's places count and the send-time `GAME_FULL` include approved unpaid places? Default: defer until paid games return, because the pilot runs free games. Source: `batch-31:78-79`; `20261204110000:62-66`.
- **Name in the accept push.** Should the host's "accepted your invitation" push hide the player's name? Default: keep it while teens are out. Before teens, write "A player accepted your invitation" when the invitee is not a known adult. Source: `plan:369`; `batch-26:62-63`.
- **"We've let them know" wording.** Drop it from the minor wait copy? Default: yes, end at "...in their Parent Center.", because the ask limits make it untrue in some cases. Source: `plan:478`.
- **A guardian's no and a pending invitation.** Should it cancel the child's pending invitation to that game? Default: yes, built with the teen launch after counsel. Source: `plan:454`, `:483`.
- **A held minor's payment window.** Should the guardian's approval restart it? Default: yes, but only once teens and paid games are both on. Source: `plan:471`, `:483`; `batch-29:49-50`.
- **Realtime tables outside the publication.** Add `notification_delivery_log`, `trainer_org_join_requests` and `subscriptions` to the publication? Default: leave as is for the pilot, because they are low traffic and staging compute is already strained. Source: `batch-31:82-83`.

### Managed accounts and age

- **Handover second factor.** Require more than the emailed link? Default: no, for the pilot, because the guardian starts it, the link lasts 7 days and there are 3 starts a day. Revisit before the first real handover. Source: `three-owner-decisions:85`; `managed-notice-production:64`.
- **Age hold.** Keep the age and roster-row hold until the person saves Privacy settings? Default: keep it as built, because its rollback alone can remove it later. Source: `three-owner-decisions:87`; `managed-notice-production:66`.
- **Adult behaviour from the 18th birthday.** Accept adult comments, reactions and reviews from the flip on? Default: accept as built, and add a "who may comment" switch only if counsel or the owner asks. Source: `three-owner-decisions:87`; `20261128110000:60-62`.

### Privacy register and the teen gate

- **Youth privacy items (B4).** B4 is part of the teen gate, so it stays unticked until each item below is rebuilt or accepted by the owner for teens. The adults-only pilot needs no B4 action, and accepting these for adults does not tick B4. Which items does the owner accept for teens, and which are rebuilt first? Default: rebuild them before any teen is recruited, because most change how minors' data and locations are handled. Some are not teen-only (for example SEC-1 and the decision on moderators closing escalated reports); section A does not list them, so they do not hold the adults-only start. Source: `checklist:43`; `plan:84`.
  - G1: location guard on team posts, the public venue and moderator read (`register:29`, `:57`).
  - SEC-4, SEC-5 and the rest of SEC-7 and SEC-8 (`register:30`).
  - PRIV-2A youth game locations, with the coarsening runs that depend on it (`register:53`, `:72`, `:86`).
  - PRIV-2B age eligibility and the host identity snapshot (`register:54`).
  - PRIV-2C and G5 client caches: accept, then rebuild the storage-key manifest test before teens (`register:55`, `:69`).
  - PRIV-2D free text and invitations (`register:56`).
  - G2 team facility details and the youth-team definition (`register:58`, `:89`).
  - G4 organizer lookup and minor host privacy (`register:61`).
  - G6 human review of location disclosures (`register:70`).
  - R1 host id in public rows: decide `host_ref` before teens (`register:62`, `:84`).
  - SEC-1 open list (`register:66`, `:81`).
  - The S0 to S11 sandbox rehearsal (`register:73`; `docs/release/sandbox-verification.md:44`).
  - The five owner decisions at `register:89` (peers carve-out, a minor who hosted, moderators closing escalated reports, youth team, public-venue exceptions).
  - Host payment handles still returned by the API to a guarded 16 or 17 year old without guardian approval (low; `guardian-manual-claim:86-87`; `pay-fresh-viewer:61-62`).
- **Guardian consent on a real phone (B3).** Run the flow end to end? Default: after B1 and B2, because no teen joins before then. Source: `checklist:42`.
- **Image staging (G3b, F06).** Rebuild private upload staging and direct uploads on `main`? Default: yes, migration first, after the G3 stripping in this PR. Source: `register:32`, `:60`, `:85`.
- **Historical images with GPS data.** Approve a read-only assessment (an object download and EXIF scan)? Default: yes, after G3 ships, so new uploads stop adding to the backlog. Source: `register:71`, `:85`.
- **Alpha-channel scan residual.** Accept it for the pilot? Default: accept and record it, because closing it needs an image runtime decision. Source: `register:33`.
- **PAY-1 payment-path fixes.** Re-audit them before any pilot host charges? Default: yes, because A11 is what keeps host-charged games out, not free mode. Source: `register:68`.
- **Codex review.** Allow an independent review that sends code to another vendor? Default: only for the teen-gate rebuilds. Source: `register:82`.
- **Backups.** Record production's backup and PITR window? Default: yes, low urgency until coarsening runs. Source: `register:95`.
- **Log retention.** Record the hosting and Supabase log retention in `docs/data-retention.md`? Default: yes. Source: `register:99`.

## Needs counsel

- **GA4 (A5, gate 5, decision 8).** Does GA4 for confirmed adults need a consent banner, or a line in the published privacy and cookie texts, which do not name GA today? Default: add a notice line naming GA, because GA runs for confirmed adults only. Turning GA off (`GOOGLE_ANALYTICS_MEASUREMENT_ID="off"` in `.env.production`, then publish; a non-empty deploy secret must be removed or set to off too) stops GA but does not tick A5 or meet gate 5, which ask for counsel's answer before the pilot starts. Starting with GA off and no answer is an owner decision that changes gate 5, and it is not recorded anywhere today. Source: `checklist:20`; `plan:32`, `:102-105`, `:145`, `:651`, `:677`.
- **Published legal texts.** Is version 2026-09-11 of the privacy, terms and cookie texts fine for an adults-only pilot? Default: use it as published, because it carries no placeholder or review markers. The GA line is the question above. Source: `plan:678`.
- **Minors in metrics (B1).** May minors be counted in aggregate, masked product metrics? Default: keep the switch off and recruit adults only. Also ask whether someone who turns 18 should be judged by birthday per day in the live weeks (today their activity at 17 counts as adult). Default: leave it while the pilot is adults only. Source: `checklist:40`; `plan:66`, `:71`, `:87-89`, `:247`, `:680`.
- **Teen safety texts (B2).** Sign off on the safety acknowledgments and host disclaimer? Default: none, this is counsel's call. Then set `LEGAL_REVIEW.safetyAcknowledgments` in a reviewed change, and bump `SAFETY_ACK_VERSION` if the wording changes. Source: `checklist:41`; `plan:66`, `:83`.
- **Feedback (WP 5.7 and 5.8).** Is the Privacy Policy wording for feedback acceptable, and may adults' free text with an opt-in contact box be kept 90 days? Default: plan decisions 6, 7, 9 and 10 (adults only, 500 characters, 90 days, then purged). Source: `plan:42-44`, `:67-68`, `:96-111`, `:523-581`, `:583-601`.
- **Retention periods.** Confirm the 90-day diagnostics purge, shipped as decision 12's default rather than as counsel's approval, together with the feedback period? Default: 90 days for both. Source: `plan:679`; `batch-27:3-5`.
- **Minors' feedback and recruiting minors.** When may minors give feedback, and when may the pilot recruit them? Default: adults only until B1 to B4 are ticked, because each needs counsel's sign-off first. Source: `plan:681-682`.
- **Messaging exceptions E1 to E5.** Add the `minor_dm_requires_connection` rule? Default: no change while the pilot is adults only, because it affects teens only. Source: `plan:683`; `register:64`.
- **Report retention (MOD-1).** How long may reports be kept? Default: keep today's flow for the pilot, with the purge unscheduled. Source: `register:65`, `:88`.
- **Handover consent or notice.** Does handing a managed account to its now-adult person need consent or notice wording? Default: none until counsel answers, bundled with issues #306 to #313. Source: `three-owner-decisions:85-86`; `managed-notice-production:64-65`.
- **Cohorts at 13 and 16.** Should age cohorts move at 13 and 16, and how is a stale under-13 cohort on a known adult handled? Default: leave as is, which is stricter. Source: `three-owner-decisions:87-88`; `20261128110000:56-57`.

## Settled by read-only checks on 2026-11-27

Production (ledger 430, fingerprint 3538 d61b6719):

- **Legal documents (A4).** One live published version each of privacy, terms and cookie preferences, version 2026-09-11, real text with no placeholder or review markers. None names Google Analytics (see Needs counsel). `payment_policy`, `ai_disclosure` and `youth_policy` have no row (checked 2026-11-28), so A4 stays open (Needs the owner). Source: `checklist:19`; `plan:144`.
- **Seed accounts (A9).** 0 `*@lovable.test` accounts. Source: `checklist:24`; `plan:149`.
- **Free mode (A10).** `platformFreeMode` is true. Source: `checklist:25`.
- **Funnel history live (A13).** `private_sec.funnel_daily` has 11 rows through 2026-11-26, and the last 5 runs of `snapshot-funnel-daily` succeeded (read-only check 2026-11-27). This shows the nightly rows only, not the frozen-day half of the WP 5.3 acceptance. Source: `plan:302`.
- **Pilot start date.** `funnel_pilot_start` is `{"date": null}`, so it is unset. The owner sets it (A2 above). Source: `batch-24:67`.
- **Stale approved requests.** 0 approved requests with no roster row on upcoming games. There are 0 upcoming games. Source: `plan:433`, `:439`; `batch-28:36`; `20261129130000:64`; `20261204110000:67-71`.
- **Decline trigger residual.** 0 pending invitations under a later decline. The deadlock path can still leave one, so read it again each batch. Source: `plan:456`.
- **Minors seated on an old approval.** 0 on upcoming games, since there are 0 upcoming games. Source: `plan:471`.
- **`sandbox_exec`.** `rolcanlogin` is false. The fingerprint cannot see this role, so read it once per batch. Source: `register:34`.

Staging:

- **Ledger and isolation (A7, gate 1).** All five SQL Editor versions (`20261112150000`, `20261113120000`, `20261114100000`, `20261114110000`, `20261114120000`) are in `schema_migrations` (ledger 81). The owner verified isolation on 2026-11-14. The "for the owner to check" line carried in batches 22 to 30 is stale and can be dropped from future records. Source: `checklist:22`; `plan:147`, `:647`; `docs/release/sandbox-verification.md:63`, `:67-69` (four versions; `20261114120000` from the read-only check 2026-11-27); `batch-22:61` and later.

## Built in this PR

- **Rollback guard for `20261103140000`.** The rollback now stops, changing nothing, while `public.game_removals` exists, unless each of the seven functions it puts back still has the md5 `20261103140000` created, and while any other function still calls a helper it drops. So it cannot overwrite the later join gate and release sweep, or leave functions calling a dropped helper. Source: `plan:447`.
- **Game page writers.** `onSettingsSaved` and the host's optimistic approve or decline now claim the read order (`claimLocalWrite` in `src/lib/read-order.ts`), so a read sent before them cannot land after them. The undo of a failed review puts back only the tapped row, and only while that row still carries the tap's `reviewed_at` (`src/lib/optimistic-review.ts`), then reads the list again, so a read dropped by the tap loses nothing. Source: `batch-31:84-85`.
- **90-day cap on admin location analytics.** The page offers 7, 14, 30 and 90 days, and never charts past the 90 days the purge keeps. Source: `plan:620`.
- **Removed-ask race.** `scripts/db-test.mjs` races a removed player's resend against the accept of the host's later invitation: 24 rounds at once, four orders, games with room and full games. At most one approval, the removal record goes exactly when the accept approves, and asks count only a resend that changed the request. Source: `plan:453`; `20261204100000:91-92`.
- **G3 image metadata stripping.** `finalizeImageUpload` and `finalizeMessageAttachment` strip JPEG, PNG and WEBP metadata (Exif with GPS, XMP, text chunks) before the safety scan and write the clean bytes back. Orientation and colour profiles are kept. A picture that cannot be parsed is refused, never kept as sent. Paths with no server step (team covers, payment proofs) strip in the browser, and staff photos are stripped in the browser and again in `createTeam` and `updateTeam`. Details: `docs/release/privacy-gap-register.md`, section "G3 on `main` (2026-11-27)". Source: `register:59`.
- **`p0-1-verify.sql` note.** The file says it checks the P0-1 state only. Its rows for the join gate, the release sweep and the host payment methods were superseded by later migrations, so they read not ok on a current database, which is not drift. Source: `plan:447`.
- **This register and the pilot checklist.** Every checklist row is ticked with a date or marked as a blocker with an owner (WP 5.0 acceptance). Source: `plan:156`.

## Deferred, buildable later

- **Quiet hours for held minor pushes.** A held push is checked at the sweep, not again when the flush sends it. Deferred: it needs a migration (an invitation link on `scheduled_notifications`) and matters only for minors, who wait for counsel. Source: `plan:365`.
- **A resend clears the decline note.** A released or guardian-declined request that is sent again then reads as the host's decline. Deferred: the fix touches md5-pinned functions and affects only paid and guardian cases, both off in the pilot. Source: `plan:415`.
- **Leave's request delete is best effort.** Two call sites swallow the error. Deferred to its own small app change. Do it before approval games run in the pilot, because a failed delete can seat the player again on their next visit. Source: `plan:433`.
- **E2E for the decline trigger.** No spec has a pending invitation that the host's decline then ends. Deferred while staging capacity is short. SQL test 988 covers the trigger meanwhile. Source: `plan:438`.
- **Payment channel catch-up.** The payment submissions channel does not read again after a reconnect. Deferred: free mode has 0 payments, and the owner already approved the fix with the other channels. Source: `batch-30:69-70`.

- **G3 residuals.** An original picture sits in Storage between upload and finalize, and a CDN could cache it on a public bucket (G3b, the private staging bucket on the unmerged branch #268). Team covers and payment proofs are stripped in the browser only, so a direct Storage PUT keeps metadata, and a team owner can write `teams.staff` directly. Pictures stored before this change keep their metadata; cleaning them is a separately approved backfill. Video and PDF metadata is untouched, except a child's reel, which is already remuxed. Source: `register`, G3 section.
- **Participant removal on the game page.** `handleRemoveParticipant` still filters the host request list optimistically and restores it wholesale on failure, without the read order. Its `finally` re-reads, so the window is short. Source: this PR's review.
- **The `20261103140000` rollback drops hotfix helpers.** A rehearsal showed it also drops `private_sec.game_payee` and `private_sec.can_manage_game_payment_settings`, which `20261102100000` created, and leaves different `game_payment_settings` policies than before `20261103140000`. Its guard now refuses while `game_removals` exists, while any of its seven bodies differs, and while any other function still calls one of the four helpers it drops (on main: `get_game_join_policy`, `game_respond_invite`, `paypal_payment_block`, `get_game_payment_terms`), so it cannot break those. Restoring the hotfix helpers and policies instead of dropping them is a separate fix, needed only if someone ever rolls back that far. Source: this PR's rehearsal; `docs/release/p0-1-reconciliation-runbook.md` section 4.

## Closed, docs were stale

Pilot checklist and gates:

- A1 pilot city: decided on 2026-11-21, New York, no time-zone work (`plan:61`, `:65`). The owner still ticks A1.
- A8 and gate 2: `20261124100000` applied in batch 17, `20261125100000` in batch 22 (`checklist:23`; `plan:648`).
- A13: WP 5.0 to 5.5 shipped in batches 23 to 26 (`checklist:28`; `plan:669`).
- Gate 3: tests and release records exist for every shipped WP (`plan:649`).
- The pilot checklist exists (`plan:57`), and the owner decisions were taken on 2026-11-21 (`plan:73-123`).
- WP 5.1 code and doc items shipped in #457, `trackingAllowed()` included (`plan:55`, `:162-180`).

The plan's "What exists" baseline:

- The host attendance prompt exists, WP 5.6 (`plan:24`).
- The accept writes the free-game roster row, and a paid accept counts approved requests (`plan:18`).
- Removal declines the request and cancels the invitation on the server (`plan:19`).
- The Overview shows the funnel card (`plan:36`).
- GA has an "off" switch, `build/ga-measurement-id.ts` (`plan:31`, `:104`).

Work package follow-ups:

- WP 5.2: the hand-run acceptance is met by SQL test 970's hand-counted values, and the plan's corrections record what was built (`plan:240`, `:276-283`).
- The player-erases-the-decline gap is closed by `20261129130000` (`plan:416`; `batch-25:50-51`).
- Paid over-approval by invitations is closed by `20261204110000`, with its pre-checks and a count of 0 recorded in batch 31 (`plan:429`, `:432`, `:433`; `batch-25:52`; `batch-29:45-46`; `batch-30:71-72`; `20261204110000:72-73`).
- Removal backfill: decided, no backfill (`plan:447`).
- Remove and block writes a removal record, because the app calls `host_remove_player` first (`plan:447`, `:453`; `batch-30:64`).
- Asks before the ask-limit migration: 0 removal records at apply (`plan:453`; `batch-31:72`).
- A re-invite after a host decline gets a new invitation, because the decline cancels the old one (`plan:455`, `:457`).
- Invitations pending under declines before `20261129130000`: 0 at apply (`plan:456`, `:483`; `batch-28:36-38`).
- The e2e specs for the accept roster and the attendance link are written (`plan:459`; `batch-25:54`; `batch-26:64`).
- Old approvals reopened by an accept: 0, recorded in batch 29 (`plan:471`).
- WP 5.7's server age-review check exists, `profiles.age_review_required` (`plan:559`).
- WP 5.9's first production run succeeded on 2026-11-24, and batch 27 says deleted rows cannot be restored (`plan:617-618`; `batch-27:59`).
- Removal stays on open games, and deleting a request no longer resets a removed player's ask limits (`batch-28:34-35`; `batch-30:67-68`).
- A host's request delete after a removal is moot, because the removal declines the request (`batch-25:52-53`).
- The host is told when a removed player asks to come back (`20261202100000:135`).

Release records:

- The sandbox isolation carry-over line: verified on 2026-11-14 (`plan:647`; `batch-22:61` to `batch-30:98`).
- Profile reads check blocks and suspension, `20261125100000` (`batch-18:43`; `batch-20:38`).
- `listOrgMembers` uses the caller's client (`batch-19:48`; `batch-20:37`).
- Guardian links end at 18 and are applied to production (`guardian-links-end-at-18:81`; `guardian-manual-claim:83-84`; `pay-fresh-viewer:63`).
- The managed handover at 18 and cohort aging are built, `20261128100000` and `20261128110000` (`guardian-links-end-at-18:30-32`, `:82-83`).
- The "ask your parent" copy no longer reaches adults (`guardian-links-end-at-18:84`; `guardian-manual-claim:85`; `pay-fresh-viewer:64`).
- Payment handles for the two cited viewers are closed by `20261128120000`. The guarded-teen residual is under the teen gate above (`guardian-manual-claim:86-87`; `pay-fresh-viewer:61-62`).
- A fresh player sees the host's payment set-up (#450), and payment terms show before approval (`guardian-manual-claim:88-89`; `pay-fresh-viewer:58-60`).
- The #452 notice is reworded, `20261130100000` (`three-owner-decisions:85`).
- `20261130110000` is applied at ledger 425 (`managed-notice-production:68`).
- Cron run history retention is applied, and the other session's `20261202100000` is covered by batch 30 (`scheduled-jobs-health-production:87-90`).
- The first runs of the guardian-link, age-cohort and handover-expiry sweeps: all jobs' last runs succeeded on 2026-11-27 (pg_cron status only; the age-cohort sweep's per-person result was not read). Source: `cron-run-history-retention-production:102-105`.
- `purge-diagnostics`' first run is recorded in batch 28 (`batch-27:59`).

Privacy gap register:

- The header's "No privacy change is merged ... NO-GO" (`register:3`), for the adults-only pilot. The teen gate (B4) still depends on the register's open items.
- PRIV-1 applied, covered by the catalog fingerprint (`register:28`, `:52`).
- F03 and F04 applied, and F05's refusal is on `main` (`register:31`).
- `sandbox_exec`: login disabled, no longer an open question (`register:34-44`).
- R2 applied (`register:63`, `:86`).
- SEC-2 applied (`register:67`).
- R6: the sandbox is verified (`register:87`).

## Out of scope

Accepted limits recorded in the plan:

- GA has no funnel events, and `join_game` also fires on a request (`plan:29-30`).
- The age-gating trigger covers two tables, so a new table brings its own (`plan:54`).
- WP 5.3: deletes inside the live window are lost, and an adult correction costs those weeks their history (`plan:295`, `:319`, `:325`).
- WP 5.4: the accept push is not checked against the game's state, delivery is at most once, guardians' copies are not pushed, and there is no per-recipient cap (`plan:365-374`, `:480`).
- WP 5.5: the host's own approval is uncapped (`plan:433`; `batch-31:77`; `20261204110000:58-61`).
- WP 5.5: the places count and the send-time `GAME_FULL` count roster rows only; the paid question is under Needs the owner (`plan:433`).
- WP 5.5: an expired payment window counts until the sweep (`plan:433`; `20261204110000:74-75`).
- WP 5.5: extra payers are refunded by hand, and PayPal's window stays (`plan:435-436`).
- WP 5.5: the cooldown runs from the previous ask, and a refused ask sends no notice (`plan:453`; `batch-31:71`; `20261204100000:84-85`).
- WP 5.5: deadlocks are retried in the app, including the guardian-cancel lock order (`plan:458`; `batch-25:53`; `batch-28:39-40`; `20261129130000:57-61`).
- WP 5.5: a decline trigger holder that fails leaves the invitation pending (`20261129130000:55-56`).
- WP 5.5: declined requests a guardian's cancel deleted are not put back (`plan:466`; `batch-29:47`).
- WP 5.5: the guardian ping is best effort (`plan:478`).
- WP 5.6: unstamped games are checked every run, and a late game prompts near midnight (`plan:514`, `:518`).
- WP 5.9: no `created_at` index, so the daily run scans (`plan:621`).
- WP 5.10's starting rules wait for pilot data (`plan:631-635`).

During the pilot:

- C1 to C3 start with the pilot (`checklist:49-51`).

Product scope:

- Paid access stays off (`plan:675`).
- New GA events, multi-city, other time zones, self check-in, share flows, invite codes and event email (`plan:684-690`).

Decided or by design:

- No backfill of earlier removals, and a removed player keeps a verified payment (`batch-30:63`, `:65-66`).
- The one declined request with a guardian approval keeps it until reopened (`batch-29:47-48`).
- PayPal's refusal order for a removed minor, the roster identity lock on API roles only, and a removed player's pending claim (`20261202100000:133-147`).
- Consents are kept at 18, and the child participation triggers are unchanged (`20261125200000:32-38`).
- The handover's design limits: no minors, no plain token, consent records kept, the switched-in guardian's password replaced (`20261128100000:25-34`).
- The age sweep skips managed, unknown-birthday and age-review accounts, and changes no other reader (`20261128110000:58-59`).

Process:

- Stacked PR housekeeping, the runbook's process items and the documented residuals (`register:77`, `:83`, `:96-98`).
