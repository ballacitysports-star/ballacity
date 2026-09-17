# Guardian → Player minor-safety, consent & compliance audit (2026-09-17)

**Not a legal compliance certification.** This documents technical controls found,
confirmed, and (where approved) additively fixed in the codebase, and flags every item
that still requires review by qualified legal counsel or a business/product decision —
consistent with the standing caveat in `docs/child-teen-compliance-audit.md`.

**Method: static audit only**, by explicit decision. Five prior audit documents in this
repo (`docs/family-architecture-final-verification.md`, `-part2.md`,
`docs/rls-cohort-verification.md`, `docs/payment-architecture-audit.md`,
`docs/child-teen-compliance-audit.md`, all dated through 2026-09-06) verified this same
architecture live, against the production Supabase project, using throwaway fixture
accounts created and deleted through the Data API. This audit deliberately did **not**
repeat that: it re-verifies everything by reading the actual current migrations, RLS
policies, RPC/trigger definitions, and every client call site directly, and stops there.
No writes were made to production, no fixture accounts were created. **Residual gap this
leaves, stated plainly:** a static read confirms what the code says will happen; it
cannot observe an actual live query result the way the prior docs' black-box testing
did. The SQL-editor recipes added to `docs/rls-cohort-verification.md` (§6–8) are
written so a human with production access can close that gap before or after deploying
this round's changes.

Production project confirmed: `supabase/config.toml` → `cpqihhcqeivbgxqbzatv`, documented
in `docs/supabase-cli.md` as the canonical/production project. This session held only
the Supabase publishable/anon key — no service-role key, no DB password, no CLI/MCP
write access — so executing SQL against production was not something this session was
capable of, independent of the static-only decision. Every change below is a git commit
of a new file under `supabase/migrations/` or an ordinary application-code edit, exactly
like the existing 282 migrations already in this repo; nothing takes effect until this
team's own review/deploy pipeline (Lovable) picks it up.

---

## A. Current state

### Already implemented correctly (re-confirmed, not re-derived)

- **Cohort derivation**: `child_under_13` / `teen_13_15` / `teen_16_17` / `adult` /
  `unknown`, computed server-side from `profile_birthdays` (RPC-only, append-only,
  immutable) via `guard_profile_age_fields`, never client-asserted.
  `profiles.age_cohort` is not `SELECT`-able by `authenticated` at all; the only reads
  go through `age_cohort_of()` / `my_age_cohort()` / `guardian_children_overview()`.
- **Guardian/consent lifecycle**: `guardian_links`, `parental_consents`,
  `parental_consent_events`, `child_controls` — all writes gated through
  `SECURITY DEFINER` RPCs (`request_parental_consent`, `approve_parental_consent`,
  `revoke_parental_consent`, `set_child_controls`, `revoke_guardian_link`), each with
  its own authorization check inside the function body, not just a client guard.
- **Feature policy engine**: `src/lib/child-policy.ts`'s `PERMISSION_MATRIX` + `can()`
  already centralizes feature availability by cohort across messaging, hosting, AI,
  location, social — this substantially pre-existed the request that prompted this
  audit; the work here was confirming a server-side mirror exists for every entry, not
  building the engine itself.
- **Messaging**: `create_direct_conversation` is the *only* way to create a conversation
  (`INSERT` on `conversations`/`conversation_participants` is fully revoked from
  `authenticated`); message **send** is independently re-gated on every single message
  by a `BEFORE INSERT` trigger, not just at conversation creation.
- **Comments, team rosters**: gated by `can_comment_on_minor_content` /
  `roster_row_visible` (moved into a non-public `private_sec` schema on 2026-09-07 for
  defense-in-depth — same logic, no longer independently RPC-callable).
- **AI**: a single layered gate (kill-switch → guardian lock → consent → cohort
  allow-list → quota) used by every entry point but one (see §B); CSAM screening
  confirmed gate-*independent*, running unconditionally regardless of consent state.
- **Location**: minors clamped to city-level, exact coordinates/address stripped on
  write for availabilities; confirmed current and unchanged in effect.
- **P2P game-fee payments**: cohort-gated via `game_payments_allowed` +
  `enforce_game_payment_cohort`, both client- and server-checked; ballaCity never
  touches these funds (Venmo/CashApp/etc., host-confirms-only model).
- **Admin/superadmin**: every capability touching `age_cohort`/consent/`guardian_links`
  is backed by a real server-side authorization boundary (a role check inside the
  `SECURITY DEFINER` function itself, or an EXECUTE grant restricted to `service_role`
  entirely) — no instance found of a client-only `isAdmin &&` guard.
- **Audit trail (partial)**: `family_audit_log` (append-only, DB-trigger-written only)
  correctly covers every `child_controls`/`parental_consents`/`guardian_links` change,
  field-for-field matching the UI's expectations.
- **External social media integration**: does not exist as a feature.
  `ProfileLinks.tsx` is plain-text vanity URL fields (Instagram/TikTok/YouTube/etc. a
  user types in), not an OAuth linking/posting integration. The only OAuth in the repo
  is normal Google/Apple sign-in and an unrelated MCP-protocol surface (ballaCity's own
  API exposed to AI coding tools). This section of the requested audit is answered by
  "the feature doesn't exist," not forced into a finding.

### Partially implemented (fixed this round — see §B)

- `regenerateReelStyle` bypassed the full AI gate (consent-only check; no kill-switch,
  cohort allow-list, or quota; and — a second bug found along the way — shipped
  regenerated overlay text with zero moderation).
- `post_reactions` (likes) had a minor-content gate on read but not on write.
- `create_direct_conversation` had no block-check (a blocked pair could still get an
  empty conversation shell created).
- `post_comments`/`post_reactions` had no block-check at all.
- Stripe subscription checkout had **no** age-cohort gate anywhere — the most severe
  finding in this audit (see §D, §J).
- The audit trail didn't cover restricted-action *attempts* (only state changes) — the
  AI-gate-denial case is now covered; the messaging-block case is not (see §J).

### Missing / explicitly out of scope this round (not fixed — see §J)

- Guardian-approval-routed subscriptions for 16-17 (superseded by the hard-block
  decision actually taken).
- Messaging-block audit logging (needs a new server-function wrapper; deferred).
- `follows` INSERT has no minor-cohort gate (open product/legal question, not a
  regression).
- `public.blocks_exist_between` is a directly-callable, unrestricted "does A block B"
  oracle for any two arbitrary users (pre-existing, unrelated to this audit's trigger).
- `message_reactions` and `follows` have the same no-block-check gap as
  `post_comments`/`post_reactions` did.

---

## B. Changes made

All delivered as new files under `supabase/migrations/` (never hand-applied to
production) plus ordinary TypeScript edits, on branch `claude/compassionate-mayer-da15bw`.

| # | Change | Type | Files |
|---|---|---|---|
| 1 | **Stripe subscription checkout is now adult-only.** New `subscription_payments_allowed()` (checks `age_cohort_of = 'adult'`) + `BEFORE INSERT` trigger `enforce_subscription_payment_cohort` on both `subscriptions` and `purchases` (INSERT only — renewal/status webhook syncs on pre-existing rows are untouched even if a cohort is later corrected). App-code check added to `createCheckoutSession` before any Stripe call. `createPortalSession` deliberately left ungated — it only manages an *existing* subscription, and RLS gives guardians no visibility into a child's subscription row today, so gating the portal would remove a minor's only self-service cancel path with nothing to replace it. New `subscription_payments` `FeatureKey` added to the policy engine for consistency (`blocked` for all three minor cohorts, `allowed` for adult). | New migration + app code | `supabase/migrations/20260917174500_subscription_payments_cohort_gate.sql`, `src/utils/payments.functions.ts`, `src/lib/child-policy.ts` |
| 2 | **`regenerateReelStyle` now goes through the same AI gate as every sibling entry point.** Routed through `withAiSession`/`assertAiAllowed` (kill-switch, cohort allow-list, quota); pre-flight validation (reel-not-found, not-completed, no-analysis) stays outside the session so its specific error messages aren't flattened. Fixes a second bug found along the way: the restyled overlay-text regeneration previously called `generateReelPackage` with no session at all, which meant its moderation pass was silently skipped. Zero schema change. | App code | `src/lib/reels.functions.ts` |
| 3 | **`post_reactions` INSERT now respects the minor-content gate** its own SELECT policy has had since 2026-09-15, mirroring `post_comments`' INSERT policy exactly (same `private_sec.can_comment_on_minor_content` helper). | New migration | `supabase/migrations/20260917174600_reaction_and_block_gates.sql` |
| 4 | **`create_direct_conversation` now refuses a blocked pair before creating anything** (checked before the minor-messaging check, so a block always reads as "one of you blocked the other" rather than a more specific reason that would leak past an intentional block). Message *sending* was already covered by the existing `enforce_block_on_message` trigger — this closes the "empty conversation shell" gap only. | New migration (function replace) | `supabase/migrations/20260917174700_conversation_block_check.sql` |
| 5 | **`post_comments` and `post_reactions` now also respect blocks**, via a new `private_sec.blocked_from_interacting()` wrapper (kept out of the public schema, unlike the pre-existing `public.blocks_exist_between`). | Same migration as #3 | `supabase/migrations/20260917174600_reaction_and_block_gates.sql` |
| 6 | **AI-gate denials are now logged to the guardian-facing audit trail** (`family_audit_log`, action `ai_gate.denied`) at all three `PARENT_APPROVAL_REQUIRED` throw sites in the AI gate — logged only for the minor-driven branches (never for an adult's plain `CONSENT_REQUIRED`), wrapped in try/catch so a logging failure can never mask the real denial. Added a matching readable case in the activity-log UI. **Messaging-block denial logging (the harder case, since it has no server-side hop today) was explicitly deferred, by decision** — see §J. | App code | `src/lib/ai/gate.server.ts`, `src/lib/family-activity.ts` |
| — | Generated Supabase types updated for the one new client-callable RPC (`subscription_payments_allowed`) so the app type-checks; `private_sec.blocked_from_interacting` needs no type entry since it is never called via `.rpc()` — only from within RLS policy evaluation. | Generated file | `src/integrations/supabase/types.ts` |
| — | Test coverage added (no existing test's assertions edited): `regenerateReelStyle` added to `entry-points.test.ts`'s tracked-entry-point list; a `subscription_payments` gate describe block added to `child-policy.test.ts` (mirrors the existing `game_payments` block); a `gate.test.ts` case confirming the new audit-log insert fires only for a minor's denial, never an adult's. | Tests | `src/lib/ai/entry-points.test.ts`, `src/lib/child-policy.test.ts`, `src/lib/ai/gate.test.ts` |
| — | SQL-editor verification recipes added for all four migration-only changes above, in the existing style of this repo's own established place for RLS verification (`docs/rls-cohort-verification.md`'s own stated reason: "RLS policy correctness cannot be asserted from unit tests"). Not executed by this audit — for a human with production access to run before/after deploy. | Docs | `docs/rls-cohort-verification.md` |

**Explicitly not changed:** no table dropped, no column dropped, no existing RLS policy
removed (only replaced with a strictly narrower version via the repo's own
`DROP POLICY IF EXISTS` / `CREATE POLICY` idiom, which every one of the 282 pre-existing
migrations already uses the same way), no existing function's *decision logic* altered
for anyone already passing today's checks (adults are unaffected by every change above),
no authentication provider touched, no existing guardian/player relationship touched,
no user, consent record, audit record, message, game, team, post, reel, or other content
deleted.

---

## C. Guardian → Player verification

Confirmed by direct code/schema reading (static, not live — see method note above):

- **Adult can create a Player**: `createPlayer()` (`src/lib/player-profiles.ts`, used by
  `/players/add`) creates a `player_profiles` row with `account_id = auth.uid()`,
  `user_id = null` (no login for the managed player) — RLS scoped to
  `account_id = auth.uid()` on all four policies (SELECT/INSERT/UPDATE/DELETE),
  unchanged since the table's creation.
- **Adult can approve a Player** (the under-13 consent flow): `request_parental_consent`
  → guardian opens `/parent/consent/$token` → `approve_parental_consent` records method,
  timestamp, scope, and legal-document versions — all three `SECURITY DEFINER`, consent
  state unwritable by any other path.
- **Adult can manage multiple Players**: `guardian_children_overview()` returns every
  linked child for the calling guardian and nothing for anyone else (confirmed by the
  prior live-tested docs and unchanged by any of the 44 post-2026-09-06 migrations).
- **Guardian controls work**: `set_child_controls` succeeds only for the linked
  guardian (`NOT_AUTHORIZED` otherwise, confirmed unchanged); each control
  (`messaging`, `media_visibility`, `ai_analysis`, `game_participation`,
  `notifications`, `notification_curfew_lifted`, and now `subscription_payments`'
  *matrix* row though not a `child_controls` column — subscriptions are hard-blocked,
  not guardian-toggleable, per the decision in §J) is read by a real server-side gate,
  not just surfaced in the UI.
- **Guardian revocation works**: `revoke_guardian_link` / `revoke_parental_consent`
  immediately re-lock the child's account (`child_features_locked` flips), confirmed
  unchanged by any of the 44 post-cutoff migrations, and `guardian_links`/
  `parental_consents`/`parental_consent_events` were untouched by any of them (zero DDL
  hits — only two prose-comment mentions in a migration header).

---

## D. Restricted feature matrix

Reflects `src/lib/child-policy.ts`'s `PERMISSION_MATRIX` as of this audit (rows this
audit added or re-verified are marked; the full matrix has more rows than reproduced
here — see the source file for the complete, current list).

| Feature | Adult | Minor (all cohorts) | Guardian required? | Server enforced | Tested |
|---|---|---|---|---|---|
| `subscription_payments` **(new)** | allowed | blocked (hard, all 3 cohorts) | n/a (hard block, not routed) | Yes — `enforce_subscription_payment_cohort` trigger on `subscriptions`+`purchases` (INSERT) | Unit: yes (`child-policy.test.ts`). Live: no — SQL recipe added to `rls-cohort-verification.md` §6 |
| `game_payments` | allowed | blocked (<16) / protected (16-17) | Yes, 16-17 | Yes — `enforce_game_payment_cohort` (pre-existing, re-confirmed unchanged) | Unit: yes (pre-existing). Live: pre-existing docs, not re-run |
| `direct_messaging` / `game_chat` | allowed | restricted per `child_controls.messaging` | Yes (`guardian_only`/`teammates`/`peers`) | Yes — double-gated: RLS at conversation creation + `BEFORE INSERT` trigger on every message | Unit: yes (pre-existing `minor-messaging.test.ts`). Live: pre-existing docs |
| `ai_analysis` | opt-out (allowed by default) | parent_controlled | Yes | Yes — `ai_analysis_allowed()`, checked in both the signed-in path and the service-role worker | Unit: yes (`gate.test.ts`, `entry-points.test.ts`, extended this round). Live: pre-existing docs |
| `comments` | allowed | restricted (owner/guardian/teammate on minor-owned content) | No (self/guardian/teammate, not guardian-toggle) | Yes — `private_sec.can_comment_on_minor_content`, INSERT+SELECT, now +block-check | Unit: none dedicated (RLS-only feature). Live: SQL recipe added §7 |
| `post_reactions` (not a named `FeatureKey` — piggybacks the comments rule) | allowed | now restricted the same as comments **(fixed this round)** | No | Yes — same helper, INSERT policy now matches SELECT, +block-check | Live: SQL recipe added §7 |
| `team_membership` (roster read) | public | teen_16_17: signed-in only; under-16: self/guardian/manager only | No | Yes — `private_sec.roster_row_visible` | Live: pre-existing docs |
| `precise_location` | allowed | never (all minor cohorts) | No | Yes — `enforce_minor_privacy_floor` + `apply_availability_location_privacy` | Live: pre-existing docs; latent (currently unreachable) `'precise'`-vs-`'exact'` clamp gap noted in §J |
| `parent_controls` (guardian-controls feature itself) | allowed | parent_controlled | n/a | Yes | Live: pre-existing docs |
| `follows` | allowed | **not gated** (open product question, see §J) | No | No (deliberately not proposed as a fix) | n/a |

---

## E. Messaging verification

Every pathway identified and traced from client entry point to server-side
enforcement (static trace; see method note):

| Pathway | Enforcement | Result |
|---|---|---|
| 1:1 DM / game-chat creation (`create_direct_conversation`, the only conversation-creating RPC — direct `INSERT` on `conversations`/`conversation_participants` is fully revoked from `authenticated`) | `minor_messaging_block_reason` (age/guardian rule) **+ now also `blocks_exist_between` (fixed this round, #4)** | Confirmed enforced; no bypass found in static trace |
| Message send (any conversation, including a pre-existing one) | RLS policy + `BEFORE INSERT` trigger re-checking the minor rule on **every** message, not just at creation | Confirmed enforced |
| Message attachments | Storage bucket pinned `public=false` | Confirmed, not independently re-verified beyond the flag |
| Message reactions | Inherits the DM gate (can't be a participant without passing it) | Confirmed enforced |
| Comments | `can_comment_on_minor_content` (INSERT+SELECT) **+ now also block-check (fixed this round, #5)** | Confirmed enforced |
| Reactions/likes | SELECT gated since 2026-09-15; INSERT **now gated to match (fixed this round, #3)**, **+ now also block-check (#5)** | Fixed — was a real, narrow gap |
| DMs from search/"nearby players" discovery | No separate contact mechanism found — same RPC as above, no parallel path | Confirmed, no bypass |
| Notification-triggered messaging | Deep-links into `/messages/:id`; the conversation itself was already gated at creation (and, since the Sept 8 fix, cannot be joined by direct insert either) | Confirmed enforced |
| Game/team messaging | Same RPC and trigger as 1:1 DM — no separate team/game-chat RPC exists | Confirmed enforced |
| Blocking | Enforced server-side for messages, follows, team invites, availability/trainer contact requests, and now (#4/#5) conversation creation, comments, and reactions | Confirmed enforced for the surfaces listed; **not** enforced for `follows` itself or `message_reactions` (see §J) |
| Notification curfew (push) | The only code path that calls the OneSignal send API checks the curfew before dispatch — not a UI-only label | Confirmed enforced |
| Direct-API / RPC bypass attempts (static reasoning, not live-executed) | Every write path traced back to a `SECURITY DEFINER` function or an RLS policy with a matching helper; no client-only guard found anywhere in the messaging/social surface | No bypass found in static trace |

**Was bypass possible?** One historical gap **existed through the 2026-09-06 baseline
and was fixed after it, before this audit began** (documenting as history, not a current
finding): any authenticated user could previously insert themselves directly into
`conversation_participants` for any conversation id, reading a minor's message history
without ever passing `create_direct_conversation`'s checks. `INSERT` on both tables was
fully revoked from `authenticated` on 2026-09-08, closing this. No other bypass was
found current as of this audit.

---

## F. Security

- **RLS**: every table in the guardian/consent/messaging/social surface has RLS
  enabled; every permissive policy this audit reviewed resolves through a helper
  function rather than a raw column comparison where a cohort/relationship check is
  needed. Two narrow gaps closed this round (#3, #5); zero disabled/removed policies
  found anywhere in the 44 migrations since the last audit.
- **RPC**: every `SECURITY DEFINER` function touching age/consent/guardian data has its
  `EXECUTE` grant reviewed — confirmed revoked from `anon`/`PUBLIC` except two
  deliberately anon-facing, boolean-only helpers that back public SELECT policies
  (`private_sec.can_comment_on_minor_content`, `age_cohort_rank`). One gap closed this
  round (#4, block-check added to `create_direct_conversation`).
- **API**: no client-only authorization guard found protecting any sensitive action —
  every admin/superadmin capability, every consent-state mutation, and every
  messaging/social write resolves its authorization inside the database, not just in
  application code.
- **Storage**: `message-attachments` bucket confirmed `public=false`; not independently
  re-audited beyond that flag this round.
- **Authentication**: untouched by this audit. No provider added, removed, or
  reconfigured.
- **Authorization**: one real, severe gap found and fixed — Stripe subscription
  checkout had zero age-cohort authorization check anywhere (see §D, §J for the
  decision and residual risk).
- **One transient regression found in the historical record, already self-corrected
  before this audit began**: a 2-day window (2026-09-10 to 2026-09-12) where
  `is_team_manager` was briefly anon-executable (a manager/owner-enumeration hole);
  reverted to the pre-cutoff baseline and replaced with a safer, enumeration-proof
  helper. Current state matches the pre-2026-09-06 baseline; nothing to fix.

---

## G. Database changes

**Objects added** (all in new migration files, none yet applied to production by this
session — see method note):
- Functions: `subscription_payments_allowed`, `enforce_subscription_payment_cohort`,
  `private_sec.blocked_from_interacting`.
- Triggers: `enforce_subscription_payment_cohort` on `subscriptions` and on
  `purchases`.
- Policies: `post_reactions` INSERT and `post_comments` INSERT replaced with strictly
  narrower versions (see below — the repo's own `DROP POLICY IF EXISTS`/`CREATE POLICY`
  idiom, not a removal).

**Objects changed** (replaced with `CREATE OR REPLACE FUNCTION` / the repo's own
`DROP POLICY IF EXISTS` + `CREATE POLICY` idiom — every one of the 282 pre-existing
migrations in this repo already uses this same pattern for policy changes):
- `create_direct_conversation` (added one `blocks_exist_between` check before the
  existing minor-messaging check; every other line byte-for-byte unchanged).
- `post_reactions` INSERT policy, `post_comments` INSERT policy (both gained
  additional `AND` conjuncts; nothing removed from either).

**Objects removed:** none. **Objects dropped:** none. **RLS disabled anywhere:** no.
**Existing data transformed or deleted:** no — every change here is either a new
row-level check (which only ever *narrows* what a future INSERT can do, never touches
an existing row) or new-file-only application code.

**Expected result, confirmed: no destructive database changes.**

---

## H. Destructive-change gate

**Confirmed: no destructive changes were performed, proposed for execution, or
required.** No delete, drop, reset, irreversible migration, data transformation, or
removal of a security control appears anywhere in this round's work. Every migration
above follows Add → Test (static) → this report; nothing here removes an existing
capability for any account that isn't newly, deliberately restricted (Stripe checkout
for minors, which had a real, unaddressed gap).

If a genuinely destructive change had been found necessary at any point, this audit
would have stopped and reported **"DESTRUCTIVE CHANGE BLOCKED — manual approval
required"** rather than proceeding. That did not occur.

---

## I. Legal/compliance items requiring counsel review

Carried forward from `docs/child-teen-compliance-audit.md` (unchanged by this audit,
restated for completeness) plus one new item this audit surfaced:

- **P0** — Approve and configure a legally sufficient verifiable-consent method before
  enabling under-13 signups in production (current default: email confirmation by a
  signed-in adult account; infrastructure is method-agnostic).
- **P0** — Counsel review of the children's privacy notice and parent direct-notice
  wording.
- **P1** — Decide whether 13-15 requires parental consent in the operative
  jurisdiction(s) and flip the configured switch accordingly.
- **P1** — Child-specific data-retention periods, documented but not yet enforced by a
  scheduled job.
- **P2** — Guardian identity verification beyond adult-account email confirmation.
- **New, this audit** — **Whether hard-blocking every minor cohort from Stripe
  subscriptions (the decision actually implemented) vs. a guardian-approval-routed path
  for 16-17-year-olds is the right long-term product/legal posture.** The technical
  pattern for the guardian-routed alternative is already designed (see this session's
  record) and can be substituted later without re-doing the core fix, but which
  approach best fits applicable purchase-consent requirements for a 16-17-year-old is a
  business/legal call, not an engineering one.
- **New, this audit** — Whether `follows` (one-way, fixed-text engagement) belongs in
  the same consent framework as `direct_messaging`/`comments` (freeform contact), or is
  correctly treated as a separate, lighter-weight category. No technical change is
  recommended until this is decided.

---

## J. Remaining risks

- **Messaging-block audit logging was deferred by explicit decision, not forgotten.**
  Every one of `create_direct_conversation`'s 5 call sites RPCs directly from the
  browser today; logging a refused attempt soundly (not just "trust the client to
  report it") requires a new server-function wrapper, which was scoped out of this
  round. The refusal itself is still fully enforced — only the guardian-facing *record*
  of the attempt is missing for this one case (AI-gate denials are now logged; consent/
  link/controls changes always were).
- **`public.blocks_exist_between` remains a directly-callable, unrestricted oracle**
  ("does A block B") for any two arbitrary authenticated users — pre-existing, not
  introduced or worsened by this audit, and not fixed here (a broader refactor of its 3
  existing consumers than this round's scope). Recommend a dedicated follow-up.
- **`follows` and `message_reactions` still have no block-check**, the same shape gap
  `post_comments`/`post_reactions` had before this round's fix (#5). Natural next
  consumers of the new `private_sec.blocked_from_interacting` helper; not built this
  round.
- **`enforce_minor_privacy_floor` only clamps the literal string `'exact'`, not
  `'precise'`**, while `apply_availability_location_privacy` (changed 2026-09-15) added
  a `'precise'` branch. Currently **unreachable** — the `location_precision` CHECK
  constraint only allows `'approximate'|'city'|'hidden'`, and neither the client type
  nor the settings UI expose the other values — but flagged as a "watch if this
  constraint is ever loosened" item, not a live issue today.
- **`player_profiles`'s free-text `location` column has no privacy-floor trigger
  wired to it yet.** The table remains Stage 1/additive (confirmed: writes go
  exclusively through `src/lib/player-profiles.ts`'s `createPlayer()`, reads still fall
  back to `profiles`/`profile_birthdays`) with no live read path for this column today
  — watch when a later stage wires it up.
- **This audit is static, not live.** Every finding and fix above is grounded in
  reading the actual current migration files and call sites, not in re-executing the
  prior docs' black-box testing against production. The SQL-editor recipes added to
  `docs/rls-cohort-verification.md` §6-8 are the mechanism for a human with production
  access to close that gap.
- **`createPortalSession` (subscription management/cancellation) is deliberately
  ungated**, even though `createCheckoutSession` (new subscription creation) is now
  adult-only. This is a considered trade-off, not an oversight: guardians have no
  visibility into a linked child's `subscriptions` row today (no guardian SELECT policy
  exists on that table), so gating the portal would remove a minor's only self-service
  cancel path with nothing to replace it. Recommend "guardian visibility into a linked
  child's subscription state" as a follow-up feature, tracked separately.

---

*Generated by Claude Code as part of a static, read-only-methodology audit of this
repository. Session record (exploration findings, subagent designs, and the decisions
recorded above) is retained in this session's transcript; nothing here was asserted
without a direct file:line citation checked against the current state of the repo at
the time of writing.*
