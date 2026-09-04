# Family architecture — verification part 2 (G–L feature keys)

Continuation of [`family-architecture-final-verification.md`](./family-architecture-final-verification.md).
That document covered birthdays/cohorts, invites, consent, controls and the direct-API
attack matrix (sections A–F). This part verifies the remaining `PERMISSION_MATRIX`
feature keys in `src/lib/child-policy.ts` against live behaviour: **teams**,
**follows/comments**, **game chat**, **AI analysis** and **precise location**.

Method is identical: throwaway accounts acting through the Data API with their own
user tokens, never through the UI and never with the service role. Cohorts were
established with `set_my_birthday` (server-authoritative), never asserted from the
client. Evidence is the observed HTTP status + response body. All fixture accounts,
and the team and game they created, were deleted afterwards (verified: 0 leftover
users, 0 orphaned profiles, 0 orphaned birthday rows).

Cast:

| Account | Age | Cohort (authoritative) | Notes |
| --- | --- | --- | --- |
| `parent` | 35 | `adult` | guardian of `kid` + `teen`; team owner |
| `other` | 30 | `adult` | unrelated adult |
| `kid` | 11 | `child_under_13` | consent approved |
| `teen` | 14 | `teen_13_15` | consent approved, `messaging = guardian_only` |
| `teen17` | 17 | `teen_16_17` | |
| `lone` | 12 | `child_under_13` | no guardian link |
| `teen15b` | 14 | `teen_13_15` | non-participant bystander |

## G. Teams and rosters

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| G1 | Adult with `account_type = team` creates a team | succeeds | created | PASS | `201` |
| G1b | Owner is auto-added to the roster | one `owner` row | one `owner` row | PASS | `200` |
| G2 | `child_under_13` inserts its own `team_members` row directly | refused | RLS violation | PASS | `403 42501 new row violates row-level security policy for table "team_members"` |
| G3 | `teen_13_15` inserts its own roster row directly | refused | RLS violation | PASS | `403 42501` |
| G4 | `teen_16_17` inserts its own roster row directly | refused | RLS violation | PASS | `403 42501` |
| G2i–G4i | Manager invites each minor (`team_invite_player`) | succeeds | invite ids returned | PASS | `200 <uuid>` ×3 |
| G2a–G4a | Each minor accepts its own invite | joins as `player` | `"accepted"`, roster row present | PASS | `200` + roster read |
| G5a | **ANONYMOUS reads the full roster after three minors joined** | see below | all four `user_id`s + roles returned | **FAIL (finding L-1)** | `200 [{owner},{player},{player},{player}]` |
| G5b | Unrelated adult reads the roster | same as anon | same four rows | noted | `200` |
| G5c | Anonymous resolves a roster `user_id` to a profile | no profile data | `[]` (minor profile not readable) | PASS | `200 []` |

Roster membership is therefore joinable only by minors through an invite from a
manager — a minor cannot add itself. Reading is the issue: see finding L-1.

## I. Comments on minors' content

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| I1 | Adult comments on an adult's reel | allowed | created | PASS | `201` |
| I2a | **Unrelated adult comments on the `child_under_13`'s reel** | see finding L-2 | created | **FAIL (finding L-2)** | `201` |
| I2b | Unrelated adult comments on the `teen_16_17`'s reel | allowed by matrix (`protected`) | created | PASS | `201` |
| I3a | `teen_13_15` teammate comments on the child's reel | allowed | created | PASS | `201` |
| I3b | Unlinked minor comments on the child's reel | see finding L-2 | created | **FAIL (finding L-2)** | `201` |
| I4 | ANONYMOUS reads comments on the child's reel | see finding L-2 | all comment bodies + author ids returned | **FAIL (finding L-2)** | `200 [ … ]` |

## J. Game chat / minor messaging

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| J1a | Adult host creates a game with an exact street address + coords | succeeds | created | PASS | `201` |
| J-join | `other` (30), `teen` (14), `teen17` (17), `kid` (11) all join the game | join allowed (participation control on) | all four joined | PASS | `201` ×4 |
| J1b | `guardian_only` teen opens a game conversation with a co-participant adult | refused | refused | PASS | `400 MINOR_MESSAGING_BLOCKED` |
| J1c | Co-participant adult opens a game conversation with that teen | refused | refused | PASS | `400 MINOR_MESSAGING_BLOCKED` |
| J2a | With `messaging = teammates`, teen opens a conversation with a co-participant adult who is **not** a teammate | refused | **allowed** | **FAIL → fixed → PASS** (finding L-3) | before: `200 <uuid>`; after: `400 MINOR_MESSAGING_BLOCKED` |
| J2b/J2c | Messages exchanged in that conversation | should never have existed | both delivered before the fix | covered by L-3 | `201` ×2 |
| J2d | ANONYMOUS reads a game conversation's messages | refused | refused | PASS | `401 42501 permission denied for table messages` |
| J3 | `child_under_13` opens a game conversation with an unrelated adult | refused | refused | PASS | `400 MINOR_MESSAGING_BLOCKED` |

## K/N. AI analysis of a minor's video

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| K4c | Child's own `privacy_preferences.ai_processing` default | should be off for a minor without guardian approval | `true` | **FAIL (finding L-4)** | `200 {"ai_processing":true}` |
| K4d | Child sets its own `ai_processing = true` while the guardian control `ai_analysis = false` | refused or clamped | accepted, stored `true` | **FAIL (finding L-4)** | `200` + re-read |
| K4f | Child's queued reel still selectable by the worker | should be excluded | `status: processing, attempts: 0` | **FAIL (finding L-4)** | `200` |
| N1 | After the fix + backfill, child's `ai_processing` | `false` | `false`, `ai_training_opt_in false` | PASS | `200` |
| N2/N3 | Child tries to re-enable `ai_processing` | clamped to `false` | request accepted, stored value still `false` | PASS | `200` + re-read |
| N4 | `ai_analysis_allowed(child)` with guardian control off | `false` | `false` | PASS | `200 false` |
| N5–N7 | Guardian enables `ai_analysis`, child then enables its own toggle | now allowed | `ai_processing true`, gate returns `true` | PASS | `204`, `200 true` |
| N8/N9 | Guardian turns `ai_analysis` back off | child's toggle re-clamped immediately | `ai_processing false`, `ai_training_opt_in false` | PASS | `200` |
| N10 | `ai_analysis_allowed(adult)` baseline | `true` (opt-out model unchanged) | `true` | PASS | `200 true` |
| N11 | ANONYMOUS calls `ai_analysis_allowed` | refused | refused | PASS | `401 42501 permission denied for function` |
| N12 | Unrelated adult probes `ai_analysis_allowed(child)` | boolean only, no data leak | `false` | PASS | `200 false` |

## L. Precise location

| # | Test | Expected | Actual | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| L1a/L1b | Game's exact address + coords read by a participant / by ANONYMOUS | game venues are public by design | exact address + coords in both cases | PASS (by design) | `200` |
| L2a | `teen_13_15` participant reads the game venue | allowed (venue, not a person) | exact address | PASS | `200` |
| L2b | Teen's own privacy floor | clamped | `profile_visibility private`, `location_precision city` | PASS | `200` |
| L2c | Teen sets `location_precision = exact`, `profile_visibility = public` | clamped by the minor floor | stored `city` + `members` | PASS | `200` (values ignored) |
| L3a | Teen posts an availability carrying exact coords, street address and a `place_id` | stored coarsened | insert accepted | PASS | `201` |
| L3b | ANONYMOUS reads that availability | refused at the grant layer | refused | PASS | `401 42501 permission denied for table player_availabilities` |
| L3c | Unrelated adult reads that availability's location fields | coarse only | `lat null, lng null, formatted_address null, place_id null`, `city` only | PASS | `200` |
| L3d | Adult posts the same availability (baseline) | exact retained for adults | insert accepted | PASS | `201` |
| L3e | ANONYMOUS reads the game roster | refused | refused | PASS | `401 42501 permission denied for function is_game_participant` |
| L3f | Non-participant minor reads the game roster | nothing | `[]` | PASS | `200 []` |

The minor location floor holds on both layers: the privacy row cannot be set to
`exact` (`enforce_minor_privacy_floor`), and `apply_availability_location_privacy`
strips `lat`/`lng`/`formatted_address`/`place_id` on write, so no coordinate for a
minor is ever stored at street precision — confirmed by an adult read (L3c), not
just by the writer's own view.

## Findings

| # | Finding | Evidence | Status |
| --- | --- | --- | --- |
| L-1 | **A team roster is world-readable, including its minor members.** `team_members` has a permissive SELECT policy for `public` on any non-hidden team, so an anonymous visitor can enumerate the `user_id`s of every child on a roster. It is a partial leak — the minors' `profiles` rows are not readable (G5c), so no name, city or avatar comes with it — but the roster reveals that a given account is a minor teammate and lets an attacker correlate it with a game roster or a comment author id. | G5a `200` with three minor `user_id`s | **OPEN.** Fixing it means deciding what a public team page shows for minors (hide minors from anonymous readers, or restrict rosters to members) — a product decision, not a mechanical fix, so it is recorded rather than silently changed. |
| L-2 | **Comments on minors' content are unrestricted and world-readable.** `post_comments` has a permissive `public` SELECT policy and no cohort check on insert, so any adult, any unrelated minor, and any anonymous reader can write to and read the comment thread on a `child_under_13`'s reel. This is the main adult→child contact channel that is *not* covered by `minor_messaging_allowed`. | I2a/I3b `201`, I4 `200` with bodies + author ids | **OPEN.** Same reason: the fix (restrict who may comment on a minor's content, and who may read it) needs a product rule per cohort before it is encoded in RLS. |
| L-3 | **`child_controls.messaging = 'teammates'` had no effect.** `minor_messaging_allowed` honoured only `off` and `guardian_only`; with `teammates` set, the teen and an unrelated adult who merely co-participated in a game opened a conversation and exchanged messages. | before: J2a `200 <uuid>`, J2b/J2c `201` | **FIXED this run.** `minor_messaging_allowed` now enforces `teammates` on both sides via a new `shares_team()` helper (guardians always allowed). Re-verified: M2 adult sharing only a game `400 MINOR_MESSAGING_BLOCKED`, M3 reverse direction `400`, M6 unlinked minor `400`, M4 real teammate `200`, M5 guardian `200`. |
| L-4 | **Guardian control over AI analysis was not enforced anywhere.** `child_controls.ai_analysis = false` was read by no code path: the only gate was the user's own `privacy_preferences.ai_processing`, which defaulted to `true` for minors and was writable by the child; and the worker route (`/api/public/reels/process`) runs with the service role and had no gate at all, so a child's queued reel would be analysed regardless. | K4c `ai_processing true`, K4d child's own write accepted, K4f reel still queued | **FIXED this run.** New `ai_analysis_allowed(user)` resolves guardian control first, then the user's own preference; a BEFORE trigger clamps a minor's `ai_processing`/`ai_training_opt_in` to `false` while the guardian control is off; an AFTER trigger on `child_controls` re-clamps when a guardian revokes; existing rows backfilled. Both entry points now call the gate — the signed-in server functions and the service-role worker, which marks a blocked reel `failed` with an explanatory message instead of processing it. Re-verified by N1–N12. |
| L-5 | `enforce_child_game_participation()` resolved the actor with one SQL `CASE` over `NEW.player_id`/`NEW.user_id`, which Postgres validates against the whole rowtype, so **every** `game_participants` insert failed with `record "new" has no field "player_id"` — for adults too. Same class as the `block_locked_child_activity` defect in part 1. | before: `400 record "new" has no field "player_id"` | **FIXED earlier this run** (branched with `IF`/`ELSIF`). Regression-verified: four joins across cohorts all `201`. |

Harness/API notes recorded so the next run does not rediscover them: `team_invite_player`
takes the team **id** as text; `teams` and `hosted_games` need a client-supplied `id`;
`post_comments.subject_type` accepts only `team_post | game | highlight_reel`.

## GO / NO-GO

**GO with two open findings.** The cohort-authoritative controls verified here —
minor messaging (including the newly enforced `teammates` mode), guardian control of
AI analysis, the minor location floor, minors being unable to add themselves to a
roster, and message/availability/roster reads being closed to anonymous callers —
all behave as the permission matrix intends, observed live.

The two open findings are both about **public-read surfaces**, not privilege
escalation: a team roster (L-1) and comment threads (L-2) expose minors' account
ids, and comment threads additionally let any adult write to a child's content
outside the messaging rules. Both need a product decision about what a public team
page and a minor's comment thread should show, so neither was changed here.

Database-linter state after this run: 96 warnings, 1 extension in `public` and 95
`SECURITY DEFINER` functions callable from the API. 94 are the pre-existing set
described in part 1; the two added are `ai_analysis_allowed` and `shares_team`,
both intentionally executable by `authenticated` only (`anon` revoked — verified by
N11) because they are policy/gate helpers the calling role must be able to evaluate.
The two new trigger routines are executable by neither `anon` nor `authenticated`.

As in part 1: this records observed behaviour of specific controls. It is not a
legal compliance certification for COPPA, GDPR-K or any other regime.
