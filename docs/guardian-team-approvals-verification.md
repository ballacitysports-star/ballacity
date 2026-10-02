# Guardian approval + blocking team waivers — verification

Makes guardian approval and team waiver signatures actually gate a minor's
team/game joins, rather than being advisory — `team_invite_player` already
notified a minor's guardians, but nothing stopped the minor from accepting
regardless. See `supabase/migrations/20261001160000_team_waivers.sql`,
`20261001170000_guardian_approval_columns.sql`,
`20261001180000_guardian_accept_path_guards.sql`.

Independent of `claude/guardian-emergency-contact`/PR #25: every helper this
relies on (`is_guardian_of`, `is_minor`, `guardian_links`, `team_invites`,
`join_requests`) is already on `main`. This branch is based on `main`
directly.

## Local replay

Same persisted Postgres 16 replay database this session has reused
throughout. Three scripts, fresh `gen_random_uuid()` fixtures each run,
cleaned up after.

### `team_waivers` (20261001160000)

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| W1 | Manager creates a draft | succeeds | row created | PASS |
| W2 | Draft invisible to a non-manager member | hidden | `should_be_0` = 0 | PASS |
| W3 | Manager publishes the draft | succeeds, `published = t` | published | PASS |
| W4 | Edit a published waiver's content | rejected — immutable | `Published waiver versions are immutable` | PASS |
| W5 | Publishing v2 unpublishes v1 | v1 `f`, v2 `t` | confirmed | PASS |
| W6 | Bypass the RPC, set two rows `published = true` directly | rejected by the partial unique index | `duplicate key … team_waivers_one_published_per_team` | PASS |
| W7 | An adult member signs for themself | succeeds, one row | `should_be_1` = 1 | PASS |
| W8 | Same member signs again | idempotent no-op | still 1 row | PASS |
| W9 | Guardian signs for a minor without `_attested` | rejected | `ATTESTATION_REQUIRED` | PASS |
| W10 | Guardian signs for the minor with `_attested=true` | succeeds, `signed_by` = guardian, never the child | `signer_user_id` ≠ `signed_by`, `signed_by` = guardian | PASS (caught and fixed a real bug — see below) |
| W11 | A non-member, non-invitee stranger signs | rejected | `NOT_TEAM_MEMBER_OR_INVITEE` | PASS |
| W12 | A pending invitee (not yet a member) signs | succeeds | one row | PASS |
| W13 | Direct insert into `team_waiver_signatures`, bypassing the RPC | rejected by RLS | `new row violates row-level security policy` | PASS |
| W14 | Sign a draft (unpublished) waiver | rejected | `WAIVER_NOT_PUBLISHED` | PASS |

**Bug found and fixed by W10**: the first draft of `sign_team_waiver()` wrote
`signed_by := _on_behalf_of` (the child's own id) instead of `_me` (the
guardian actually calling it) — backwards from `legal_consents.accepted_by`'s
established convention. Caught because W10's query asserted
`signer_user_id` and `signed_by` are *different* values, not just that
`signed_by` is non-null. Fixed in the migration before this doc was written;
re-run confirmed.

### Approval columns/RLS/RPCs (20261001170000)

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| A1 | Guardian reads their child's pending team invite | visible | `should_be_1` = 1 | PASS |
| A2 | A stranger reads the same invite | hidden | `should_be_0` = 0 | PASS |
| A3 | A stranger calls `guardian_approve_team_invite` on it | rejected | `INVITE_NOT_FOUND` (RLS hides the row before the function's own `NOT_GUARDIAN` check ever runs — confirmed layered, not a gap) | PASS |
| A4 | Guardian approves the invite | `guardian_approved_at`/`_by` set, status stays `pending` | confirmed | PASS |
| A5 | Minor creates a join request, guardian approves it | same, on `join_requests` | confirmed | PASS |
| A6 | Guardian declines a request | `status = 'rejected'` | confirmed | PASS |

### Combined accept-path guards (20261001180000)

Fixtures: a 15-year-old with an active guardian link and **approved**
parental consent (so the pre-existing `child_features_locked()` gate — a
different, older mechanism — doesn't mask the new one), a 14-year-old
similarly set up, an adult, a team, and a game.

| # | Check | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| G1 | Minor accepts a team invite, no guardian approval | rejected | `GUARDIAN_APPROVAL_REQUIRED` | PASS |
| G2 | Guardian approves, minor accepts again | succeeds, joins roster | `accepted`, `should_be_1` = 1 | PASS |
| G3 | Minor declines without guardian approval | succeeds — decline is never gated | `declined` | PASS |
| G4 | Adult accepts a team invite, team has a published unsigned waiver | rejected | `WAIVER_REQUIRED` | PASS |
| G5 | Adult signs the waiver, accepts again | succeeds | `accepted`, `should_be_1` = 1 | PASS |
| G8 | A minor's own `join_requests` insert | never blocked by guardian approval — it's the pending ask itself | succeeded | PASS |
| G9 | The same minor's `game_participants` insert | blocked until guardian approval | `GUARDIAN_APPROVAL_REQUIRED` | PASS |
| G10 | Guardian approves the request, same insert retried | succeeds | `should_be_1` = 1 | PASS |
| G11 | An adult (no guardian link) joins the same game directly | unaffected | `should_be_1` = 1 | PASS |

One test-script-only correction recorded, not hidden: the first run of G9
used a minor with no guardian_links row yet (added further down the script,
for G10, by mistake) — the insert wrongly succeeded because the new clause's
`EXISTS (guardian_links …)` condition was false, not because of a migration
defect. Fixed by moving that insert earlier, before G9 runs; re-run showed
the correct block.

## Still to run

- ~~Apply all three migrations via Lovable's chat with per-statement
  approval on the canonical project.~~ **Done.** All three ran in order
  against the canonical project (commits `e12282a`, `937d73b`, `5a2de05`)
  and were independently re-verified there: both tables + RLS + the
  partial unique index + both RPCs (migration 1); the new columns on
  `team_invites`/`join_requests` + both guardian-read policies sitting
  alongside the existing ones + both RPCs (migration 2); and, via
  `pg_get_functiondef` character-offset checks, the exact guard ordering
  inside `team_respond_invite` (`CHILD_ACTIVITY_LOCKED` → `GUARDIAN_APPROVAL_REQUIRED`
  → `WAIVER_REQUIRED` → the `team_members` insert) and `GUARDIAN_APPROVAL_REQUIRED`
  scoped inside `enforce_child_game_participation`'s `game_participants`-only
  branch (migration 3), with no other objects touched.
- A full end-to-end browser run of a guardian approving a team invite and a
  manager publishing/a member signing a waiver. `e2e/guardian-team-approvals.spec.ts`
  only confirms the Parent Center's approvals panel renders correctly with
  nothing pending — the full flow would need a team fixture, and this repo
  has no team-deletion UI to clean one up afterward, so it isn't covered by
  e2e in this pass. The local replay above is the actual behavioral proof.
- A real browser dry run of `WaiverTab`, the `FamilyApprovalsPanel` inline
  Approve/Decline/Sign buttons, and `TeamInvitesInbox`'s sign-then-join flow
  — not attempted in this pass, same limitation noted on PR #25/#26 for
  other direct-Supabase-client surfaces in this app.
