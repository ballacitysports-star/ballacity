# Family architecture — final verification (P0)

Executed against the live backend with throwaway accounts, each acting through the
Data API with its own user token (never through the UI, never with the service
role). Cohorts were established through `set_my_birthday`, never asserted from the
client. All fixture accounts were deleted after the run.

Cast:

| Account | Age | Cohort (authoritative) |
| --- | --- | --- |
| `parent` | 35 | `adult` |
| `other` (unrelated adult) | 30 | `adult` |
| `kid` | 11 | `child_under_13` |
| `teen` | 14 | `teen_13_15` |
| `lone` (unlinked minor) | 12 | `child_under_13` |

Legend: Evidence is the observed HTTP status + body from the live Data API.

## A. Regression tests for the two defects fixed earlier

| # | Test | Expected | Actual | Result | Evidence | Fix applied | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | Adult inserts `hosted_games` | succeeds (no `record "new" has no field` error) | created | PASS | `201` | `block_locked_child_activity()` branched with IF/ELSIF (earlier turn) | this row |
| A2 | Adult inserts `highlight_reels` | succeeds | created | PASS | `201` | same | this row |
| A3 | Adult inserts `player_availabilities` | reaches app-level validation, not a rowtype error | `P0001 At least one sport is required.` / `Unknown sport` | PASS | trigger passed, business rule fired | same | this row |
| A4 | 11-year-old inserts `hosted_games` | blocked | `CHILD_CANNOT_HOST` | PASS | `400 P0001` | — | this row |
| A5 | 14-year-old inserts `hosted_games` | blocked | `CHILD_CANNOT_HOST` | PASS | `400 P0001` | — | this row |
| A6 | Minor inserts reel before consent | blocked | `CHILD_CONSENT_REQUIRED` | PASS | `400 P0001` | — | this row |
| A7 | `guardian_only` minor sends message to unrelated adult | blocked | `MINOR_MESSAGING_BLOCKED` | PASS | `400 P0001` | `minor_messaging_allowed` honours `guardian_only` both ways (earlier turn) | this row |
| A8 | Unrelated adult sends message to `guardian_only` minor | blocked | `MINOR_MESSAGING_BLOCKED` | PASS | `400 P0001` | same | this row |
| A9 | `guardian_only` minor messages a linked guardian | allowed | delivered | PASS | `201` | same | this row |

## B. Defect found and fixed in this run

| # | Test | Expected | Actual (before fix) | Result | Evidence | Fix applied | Regression test |
| --- | --- | --- | --- | --- | --- | --- | --- |
| B1 | `guardian_only` minor calls `create_direct_conversation` on a stranger | refused | conversation + participants created; only the first *message* was blocked, leaving an empty thread visible in both inboxes | FAIL → fixed → PASS | before: `200 <uuid>`; after: `400 MINOR_MESSAGING_BLOCKED` | `create_direct_conversation` now calls `minor_messaging_allowed(auth.uid(), _other_user)` before any insert | B1–B4 re-run after migration |
| B2 | Same, minor → unrelated minor | refused | now refused | PASS | `400 P0001` | same | this row |
| B3 | Same, minor → non-guardian sibling minor | refused | now refused | PASS | `400 P0001` | same | this row |
| B4 | Unrelated adult calls it on a restricted minor | refused | now refused | PASS | `400 P0001` | same | this row |
| B5 | Minor → linked guardian still works after the fix | allowed | returns the existing conversation | PASS | `200 <uuid>` | same | this row |

## C. Hardening applied in this run

| # | Issue | Fix | Verification |
| --- | --- | --- | --- |
| C1 | Four `SECURITY DEFINER` trigger routines (`guard_profile_age_fields`, `birthday_audit_append_only`, `enforce_game_payment_cohort`, `reclamp_privacy_on_cohort_change`) were directly callable by `anon`/`authenticated` through the API | `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` | linter count 102 → 94; zero `SECURITY DEFINER` trigger functions remain executable by `anon`/`authenticated`; triggers still fire (D1–D6 below) |
| C2 | The support review queue silently rendered nothing when its RPC failed (including `FORBIDDEN`) | `BirthdayCorrectionQueue` now shows the returned message | queue component renders an error panel instead of `null` |
| C3 | **Account deletion was impossible.** Deleting a user cascaded into `profile_birthdays`, where the immutability trigger raised `BIRTHDAY_LOCKED`, aborting the whole delete — this blocked admin deletion and any right-to-erasure request | `guard_birthday_immutability()` now permits the DELETE when the owning `auth.users` row no longer exists (cascade), and still refuses every other delete or change | before: `P0001 BIRTHDAY_LOCKED ... DELETE FROM ONLY "public"."profile_birthdays"`; after: 47 fixture accounts deleted successfully, 0 orphaned birthday rows remain; D2–D4 re-verified as still refused |

## D. Birthday / age integrity (post-hardening smoke)

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| D1 | Signup → `set_my_birthday` | authoritative cohort returned by the server | `adult`, `child_under_13`, `teen_13_15` as appropriate | PASS | RPC payload |
| D2 | Second `set_my_birthday` | refused | `BIRTHDAY_LOCKED` | PASS | `400 P0001` |
| D3 | Direct `PATCH profile_birthdays` | refused | `42501 permission denied` (no UPDATE grant; trigger is the second layer) | PASS | `403` |
| D4 | Direct `DELETE profile_birthdays` | refused | `42501 permission denied` | PASS | `403` |
| D5 | Direct `INSERT profile_birthdays` | refused | `42501 permission denied` | PASS | `403` |
| D6 | Minor forges `profiles.age_cohort = 'adult'` (and `age_review_required = false`) | authoritative cohort unchanged | request accepted with no effect; stored cohort still `child_under_13` | PASS | `204`, then server-side read shows `child_under_13` |
| D7 | Member requests a birthday correction | accepted | request id returned | PASS | `200 <uuid>` |
| D8 | Non-admin reads the correction queue | refused | `FORBIDDEN: admin access required.` | PASS | `400 P0001` |

Note on D6: the forged write is silently discarded rather than rejected with an
error. The stored value — the only value any permission reads — is authoritative,
so this is not an escalation path, but the API response is not self-explanatory.

## E. Invites, consent and controls

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| E1 | Minor calls `create_minor_invite` | refused | `ADULT_REQUIRED` | PASS | `400 P0001` |
| E2 | Adult creates two invites | succeeds | two ids | PASS | `200` |
| E3 | Anonymous `lookup_minor_invite` | refused | `42501 permission denied for function` | PASS | `401` |
| E4 | Lookup with an unknown token hash | `state: invalid`, no data leak | all fields null, `state: invalid` | PASS | `200` |
| E5 | Each minor redeems its own invite | link active + consent recorded | `consent_recorded: true` | PASS | `200` |
| E6 | Replaying a used invite from another account | refused | `INVITE_USED` | PASS | `400 P0001` |
| E7 | Creating an invite with a past expiry | refused | `TOKEN_INVALID` | PASS | `400 P0001` |
| E8 | Redeeming an unknown/expired invite | refused | `INVITE_INVALID` | PASS | `400 P0001` |
| E9 | Parent `guardian_children_overview()` | both children | both children with cohort + consent status | PASS | `200` |
| E10 | Minor calls the overview | empty | `[]` | PASS | `200` |
| E11 | Anonymous calls the overview | refused | `42501 permission denied for function` | PASS | `401` |
| E12 | Unrelated adult `set_child_controls` | refused | `NOT_AUTHORIZED` | PASS | `400 P0001` |
| E13 | Child `set_child_controls` on itself | refused | `NOT_AUTHORIZED` | PASS | `400 P0001` |
| E14 | Linked parent `set_child_controls` | succeeds | controls written | PASS | `204` |
| E15 | Child reads its own controls | own row only | one row | PASS | `200` |
| E16 | Child reads a sibling's controls | nothing | `[]` | PASS | `200` |
| E17 | Unrelated adult reads controls | nothing | `[]` | PASS | `200` |
| E18 | Child `PATCH child_controls` directly | no change | `[]` returned, value still `guardian_only` | PASS | `200` + re-read |

## F. Direct-API attack matrix

| # | Actor → target | Expected | Actual | Result |
| --- | --- | --- | --- | --- |
| F1 | Minor reads `profiles.age_cohort` | refused | `42501 permission denied for table profiles` | PASS |
| F2 | Minor reads a sibling's `profile_birthdays` | nothing | `[]` | PASS |
| F3 | Unrelated adult reads `guardian_links` | nothing | `[]` | PASS |
| F4 | Minor inserts a `guardian_links` row naming an arbitrary adult | refused | RLS violation | PASS |
| F5 | Minor inserts its own `parental_consents` row (self-consent) | refused | RLS violation | PASS |
| F6 | Minor `PATCH parental_consents` | no change | `[]` | PASS |
| F7 | Parent reads `family_audit_log` | linked children only | `consent.required`, `link.active`, `consent.approved`, `controls.created` | PASS |
| F8 | Child reads `family_audit_log` | own rows only | own rows only | PASS |
| F9 | Unrelated adult reads `family_audit_log` | nothing | `[]` | PASS |
| F10 | Child `DELETE family_audit_log` | nothing removed | `204` with rows still present on re-read | PASS |
| F11 | Unrelated adult `revoke_guardian_link` | refused | `NOT_FOUND` | PASS |
| F12 | Child revokes its own guardian link | refused | `NOT_FOUND` | PASS |
| F13 | Parent revokes the link | succeeds; child leaves the overview | revoked, child gone from overview | PASS |
| F14 | Revoked child creates a reel | refused | `CHILD_CONSENT_REQUIRED` | PASS |
| F15 | Consented child hosts a game | refused | `CHILD_CANNOT_HOST` | PASS |
| F16 | Consented child creates a reel | allowed (media control permits) | created | PASS |

## GO / NO-GO

**GO** for the family/minor architecture as verified above, with these caveats
recorded rather than claimed away:

- Every check in sections A–F was executed against the live backend by real user
  tokens; no result in this document is inferred.
- Two silent-no-op behaviours (D6 forged cohort write, E18/F6 blocked `PATCH`)
  return success statuses without changing data. Not escalation paths, but they
  should eventually return explicit errors.
- 94 database-linter warnings remain, all pre-existing: 1 extension in `public`
  and 93 `SECURITY DEFINER` functions callable from the API. These are the
  intentional user-scoped RPCs and RLS policy helpers (`profile_visibility_of`,
  `reel_publicly_visible`, `guardian_children_overview`, …) — policy helpers must
  be executable by the calling role for RLS to evaluate, and each RPC enforces
  its own authorization, as F11–F13 and E12–E13 demonstrate. The four routines
  that had no business being callable were revoked in C1.
- This document reports observed behaviour of specific controls. It is not a
  legal compliance certification for COPPA, GDPR-K or any other regime.

Continued in
[`family-architecture-verification-part2.md`](./family-architecture-verification-part2.md),
which covers the remaining feature keys (teams/rosters, comments, game chat, AI
analysis, precise location) and records two open public-read findings.
