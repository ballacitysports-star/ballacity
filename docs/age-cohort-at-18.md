# The stored cohort ages to adult at 18

Owner instruction 2026-11-21: take the recommended option for the stale stored cohort. The stored cohort moves to `adult`
at 18, only upward, only for a known adult who is not a managed account. Everything else (the 13 and 16 thresholds,
under-13, managed accounts, an unknown birthday) is left as it is and listed in section 6.

| Piece             | Where                                                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------------- |
| Migration         | `supabase/migrations/20261128110000_age_cohort_at_18.sql` (changes no row by itself; adds no reader change) |
| SQL test          | `supabase/tests/992_age_cohort_at_18.test.sql` (negative controls in section 8)                             |
| Rollback          | `docs/rollbacks/20261128110000_age_cohort_at_18.down.sql` (guarded; rehearsed)                              |
| Read-only preview | `docs/age-cohort-at-18-preview.sql` (counts only; run it against production before approving any apply)     |
| App code          | none. The app reads the stored value, so it works whether or not the migration is applied.                  |

## 1. The problem

`profiles.age_cohort` (and `age_category`) are written when a birthday is saved (`sync_age_category_from_birthdays`) and
nothing moves them on. A person who registered at 14 still carries `teen_13_15` at 19. Guardian authority and the
guardian's switches no longer depend on it (20261125200000), but every other reader of the cohort does: reviews, hosting,
events, payments, the AI allowance in `gate.server.ts`, the teen-to-adult DM rule, team youth status, availability
visibility, and the adult-only guardian actions (adding a minor, provisioning a managed child). What a stale lower
cohort costs: it only errs stricter, but it errs on an adult who has no way to correct it.

## 2. The design, and why it is the minimal safe one

`private_sec.cohort_due_to_age(user)` is the one rule. A person is due when ALL hold:

- the stored cohort is `teen_13_15` or `teen_16_17` (never `unknown`, never `child_under_13`, never already `adult`);
- `private_sec.is_known_adult(user)`: a stored birthday whose `age()` is 18 or more. This is the computation the pay RPC,
  `is_minor` and the guardian rule use, so they cannot disagree with it;
- `age_cohort_from_birthday(birthday) = 'adult'` as well, so a changed `adult_age` policy is honoured;
- not in `managed_accounts` (the handover stream owns those: once a managed account is handed over and the row is gone,
  the next daily run ages it with no further change);
- `age_review_required` is false (a moderator is deciding that person's age; the sweep does not decide it for them).

`private_sec.age_adult_cohorts(cap)` is a separate sweep: idempotent, capped (default 200, at most 1000), one savepoint
per person, scheduled daily at 04:47 UTC when `pg_cron` exists (after the guardian sweep at 04:41), by hand otherwise
(`SELECT private_sec.age_adult_cohorts();`). It is not callable by `anon`, `authenticated` or `service_role`. It returns
counts only (`aged`, `notified`, `failed`, `remaining`, `reels_drafted`, `posts_paused`, `adults_left_alone`); a failure
logs a warning without an id. For each person, in one savepoint, in this order:

1. **The stored privacy row is made explicit.** When no `privacy_preferences` row exists the cohort supplies two defaults:
   the profile visibility (`default_profile_visibility_for`: members for a teen, public for an adult) and follow approval
   (`follow_approval_required`: always on for a minor). A missing row is inserted with those values before the flip. A
   row that exists was already clamped to the minor floor by `enforce_minor_privacy_floor` and is not touched. (Sign-up
   stores `private` while the cohort is still unknown, and the reclamp trigger only ever lowers, so most people already
   hold `private` or `members`.)
2. **A stale 13-15 whose `allow_messages` is `everyone` becomes `shared`.** That is what the shared-game rule gave them
   with adults. Without it any adult could message them from the day they flip. `nobody` stays `nobody`; a 16-17 had no
   such rule, so nothing changes for them.
3. **Reels become drafts, open availability posts are paused.** A reel's audience and an availability post's visibility are
   decided by the owner's cohort alone (`reel_audience`, `availability_post_visible`), with no stored setting. Without this
   every earlier reel of a 16-17 would go from members-only to public, every reel of a 13-15 from nobody to public, and every
   open availability post would be listed to all members, the day they flip. A draft is visible only to its owner and is
   posted with the existing Post action (`postReel`); a paused post is resumed with the existing switch
   (`setAvailabilityPaused`). Neither needs a UI change. Hidden or held reels keep `hidden_at`; family clips (`subject_child_id`)
   are not touched. The ids are kept in `private_sec.age_cohort_flips`.
4. **The flip.** `age_cohort` and `age_category` become `adult` under `openrun.age_sync` (the same switch the birthday sync
   uses), and an `age_change_events` row (`aged_to_adult`) is written. The existing reclamp trigger runs and the floor
   trigger no longer clamps.
5. **Aging never widens.** The profile's visibility and follow approval are read before and after. A stored value that would
   now read wider is put back; if it still would, the person's whole savepoint is rolled back and they stay on the stricter
   cohort. Narrower is accepted (a guardian's public-profile switch stops applying with the link, so that profile reads
   members).
6. **The person is told once, in app** (`notifications`, type `age_review`, link `/account/privacy`): "Your account now has
   adult settings. You are 18 or over, so your account now uses adult settings. Your privacy choices stay as they were until
   you change them." plus, only if they apply, a sentence that earlier reels are drafts and open availability posts are
   paused, and one pointing at Privacy settings. No legal claim and no mention of a parent.

Why not smaller: a missing privacy row, the reels and the posts would widen the day the cohort moves, which is exactly what
the owner ruled out. Why not bigger: no reader function is changed, so there is no second place to keep in step with the
stored value, and a mistake in one person's data cannot touch anyone else's (one savepoint each).

### A support-approved correction back to a minor

Already recomputed downward. `review_birthday_correction` upserts `profile_birthdays` under `openrun.birthday_review`; the
birthday sync (`sync_age_category_from_birthdays`) lowers the cohort whenever the new one ranks lower, and
`trg_reclamp_privacy_on_cohort_change` re-applies the minor floor to the stored row (a public profile the adult chose goes
back to members, follow approval back on). Nothing needed fixing. The migration only closes the audit row
(`reverted_at`, `trg_close_age_cohort_flip`) so a later 18th birthday is a new flip with a new notice. The other direction
is also the existing rule: a correction that raises the cohort keeps the stricter one and sets `age_review_required`, and the
sweep leaves that person for the moderator (`clear_age_review`). Reels the person posted as an adult go back to the 16-17
audience (members) on their own, because the audience is computed from the cohort; drafts stay drafts.

## 3. Aging must not widen what is public: the audit

Every place where the cohort changes visibility or discoverability, and what the flip does about it.

| Surface                                                         | Before the flip (stale teen)                   | After, without the sweep's steps        | What the sweep does                                                                              |
| --------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Profile visibility (`profile_visibility_of`) with no stored row | members (cohort default)                       | public (adult default)                  | stored row made explicit (step 1); visibility and follow approval compared before and after      |
| Follow approval (`follow_approval_required`)                    | always on                                      | the stored value, may be off            | stored value put right if it would read wider (step 5)                                           |
| Stored profile / location / follow values                       | clamped by trigger                             | unchanged, not clamped any more         | nothing to do: the row keeps the clamped values; the person may change them                      |
| Reel audience (`reel_audience`, feeds, `public_user_reel_ids`)  | 16-17: members; 13-15: nobody                  | public                                  | reels become drafts (step 3)                                                                     |
| Availability posts (`availability_post_visible`)                | hidden from strangers                          | listed to all members                   | open posts paused (step 3)                                                                       |
| Direct messages (`minor_messaging_block`, `allow_messages`)     | 13-15: shared game with an adult; 16-17: open  | open to any adult                       | 13-15 `everyone` becomes `shared` (step 2)                                                       |
| XP on the public profile (`public_xp_enabled`)                  | guardian switch, off by default                | the adult path (no switch)              | no change: the guardian rule already released it in 20261125200000                               |
| AI consent (`ai_analysis_allowed`, `clamp_ai_processing_*`)     | guardian switch AND own switch                 | own switch only                         | no change: also already released by 20261125200000; a stored `ai_processing = false` stays false |
| Search / discovery                                              | follows the profile visibility above           | same                                    | covered by step 1                                                                                |
| Team youth status (`team_is_youth`)                             | a team with a non-adult member is a youth team | not youth once every member is an adult | none: a consequence for the team, not for the person (section 7)                                 |

Not changed by the sweep because there is no stored setting to carry over (adult behaviour from the day they flip; listed as
owner decisions in section 7): reviews of the person (only new ones), the roster row on a public team, host attendance
numbers, the age shown with their profile (`profile_ages`, still gated by their profile visibility), new posts with a public
audience, hosting and event creation, payments, funnel analytics (GA4 and web vitals).

## 4. Readers inventory

Found by replaying every migration into a scratch database (`ballacity_dbtest_agecohort`) and listing every function,
trigger and policy whose text mentions `age_cohort`, `age_cohort_of`, `age_category`, `is_minor`, or a cohort string
(`teen_13_15`, `teen_16_17`, `child_under_13`), then grepping `src/` for the same and for the literal `"adult"`.
`is_minor` and `age_cohort_from_birthday` read the live birthday and are not affected; `age_cohort_of`, `profiles.age_cohort`
and `my_age_cohort` read the stored value, which is what moves.

### 4a. SQL

| Reader                                                                                                                                                                                                                                      | What changes for a flipped adult                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enforce_minor_privacy_floor`, `reclamp_privacy_on_cohort_change`, `trg_enforce_minor_privacy_floor`                                                                                                                                        | The clamp stops. Stored values stay as they are. Back to a minor: the clamp runs again on the stored row.                                                                                 |
| `private_sec.profile_visibility_of`, `default_profile_visibility_for`; policies on `profiles`, `follows`                                                                                                                                    | Default flips members to public when no row exists: handled by step 1. The two `profiles` read policies follow the stored value.                                                          |
| `follow_approval_required`, `can_manage_followers`                                                                                                                                                                                          | Follow approval follows the stored value (kept on). The adult manages their own followers (a 13-15 could not).                                                                            |
| `reel_audience`, `reel_publicly_visible`, `public_user_reel_ids`, `public_reel_feed_ids`                                                                                                                                                    | Public for an adult: handled by drafts. A 13-15's team-sharing paths (`teen_reel_viewer_access`, `guard_teen_reel_team`) no longer apply.                                                 |
| `family_post_viewer_access`, `guard_family_post`, `guard_family_post_team`                                                                                                                                                                  | Family-clip rules key on a child or 13-15 subject; the person is no longer one.                                                                                                           |
| `availability_post_visible`, `guard_minor_availability_write`, `blank_minor_availability_location`, `list_minor_availability_notes_with_location_text`, `moderator_scrub_availability_note`                                                 | Listed to members, and location text allowed as an adult: handled by pausing open posts. New posts follow the stored `location_precision`.                                                |
| `roster_row_visible`                                                                                                                                                                                                                        | The roster row is visible to everyone, a signed-out visitor included. Open decision.                                                                                                      |
| `profile_ages`                                                                                                                                                                                                                              | Their age is returned wherever their profile is visible. Open decision.                                                                                                                   |
| `post_audiences_allowed`, `can_comment_on_minor_content`                                                                                                                                                                                    | New posts may be public; comments are open to anyone who can see the post. Earlier posts keep their stored audience.                                                                      |
| `team_is_youth`, `team_chat_member`, `enforce_game_host_affiliation`, `series_host_still_eligible`                                                                                                                                          | Team youth status can end when every member is an adult; adult team chat and host rules apply.                                                                                            |
| `minor_messaging_block`, `private_sec.direct_message_refusal`                                                                                                                                                                               | The teen-to-adult shared-game rule stops. The stored `allow_messages` carries it (step 2).                                                                                                |
| `ai_analysis_allowed`, `clamp_ai_processing_for_minors`, `public_xp_enabled`, `guardian_switches_apply`                                                                                                                                     | Already adult-like since 20261125200000; no change.                                                                                                                                       |
| `review_author_is_adult`, `review_subject_is_public`, `my_reviewable`, `enforce_review_age_rules`, `enforce_review_integrity`, `enforce_skill_vote`, `player_activity_stats`, `host_attendance_stats`, `player_trait_counts`                | They can review and be reviewed, vote on skills, and their review numbers show to themself. Open decision for new reviews of them.                                                        |
| `block_child_hosting`, `create_event`, `create_facility_event`, `create_trainer_event`, `regular_invitable`                                                                                                                                 | They can host and create events as an adult (a 13-15 could not host at all); regular invites follow their stored switch.                                                                  |
| `game_payments_allowed`, `enforce_game_payment_cohort`, `get_host_payment_methods`, `get_game_host_payment_methods`, `get_game_host_paypal`                                                                                                 | The payment gates see an adult (a stale 13-15 was refused). Payments stay off in production, as decided.                                                                                  |
| `create_minor_invite`, `redeem_minor_invite`, `provision_managed_child`, `create_device_pairing`                                                                                                                                            | They can act as an adult guardian (ADULT_REQUIRED no longer applies).                                                                                                                     |
| `parental_consent_required`, `child_features_locked`, `platform_status`, `my_platform_status`, `age_verified`, `notify_on_child_game_join`                                                                                                  | No consent hold on an adult. Old `parental_consents` rows stay as history.                                                                                                                |
| `telemetry_subject_is_adult`, `analytics_share_active`, `guard_analytics_team_share`, `coach_analytics_athletes`, `minor_time_on_platform`                                                                                                  | Adult telemetry rules; a 13-15's guardian-approved analytics share ends; the youth time report no longer counts them.                                                                     |
| `minor_handle_unsafe`, `enforce_minor_handle_safety_trg`                                                                                                                                                                                    | Names are no longer sanitised as a minor's.                                                                                                                                               |
| `guard_org_court_inquiry`                                                                                                                                                                                                                   | Keys on `child_under_13` only; not affected.                                                                                                                                              |
| Writers of the cohort: `sync_age_category_from_birthdays`, `review_birthday_correction`, `clear_age_review`, `set_my_birthday`, `provision_managed_child`, `guard_profile_insert`, `guard_profile_age_fields`, `player_profiles_set_cohort` | Unchanged. The sweep writes under `openrun.age_sync` like the sync. `player_profiles.age_cohort` is derived from its own date of birth when written; nothing reads it, so it is not aged. |
| `is_minor` family: `game_invite_player`, `team_invite_player`, `team_respond_invite`, `enforce_child_game_participation`, `guardian_approver_eligible`, `game_payment_guardian_ready`                                                       | Read the live birthday; not affected.                                                                                                                                                     |

### 4b. TypeScript (`src/`)

| Reader                                                                                                                                                                                                                                          | What changes for a flipped adult                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/ai/gate.server.ts` (`cohortOf`, `cohortAllowed`, `consentDenial`), `src/lib/ai/config.ts`                                                                                                                                              | The adult-only features (review insights and assist, post assist, support assistant, skill assessment) are allowed. AI consent stays the stored choice. No code change: it reads `age_cohort_of`. |
| `review-age.server.ts`, `review-subject.ts`, `skill-rating.server.ts`, `player-card.functions.ts`, `player-passport.functions.ts`, `coach-analytics.functions.ts`, `host-affiliations.ts`, `coach-analytics.ts`                                 | Adult rules for reviews, skill ratings, cards, analytics and host affiliations.                                                                                                                   |
| `managed-children.functions.ts`, `child-safety.functions.ts` (`callerCohort`, guardian checks)                                                                                                                                                  | They can act as a guardian. These already fall back to `my_platform_status` when the stored cohort is not adult.                                                                                  |
| `push-curfew.server.ts`                                                                                                                                                                                                                         | Already adult-like through `guardian_authority_has_ended`.                                                                                                                                        |
| `youth-features.ts`, `age-verification.ts`, `age-policy.ts`, `account-type.ts`, `family-roster.ts`, `network-posts-rules.ts`                                                                                                                    | Adult-only features, onboarding and roster defaults apply.                                                                                                                                        |
| `reel-privacy.ts`, `teen-reel-privacy.ts`, `reel-analytics.ts`, `pose-metrics.ts`, `child-policy.ts`, `teen-reels.functions.ts`, `reels-pipeline.server.ts`                                                                                     | Static matrices by cohort; the adult column applies. `teen-reels.functions.ts` only serves a 13-15.                                                                                               |
| `compliance.functions.ts`, `child-safety.functions.ts` (dashboards, cohort counts)                                                                                                                                                              | Minor counts fall to the true figures.                                                                                                                                                            |
| UI: `AnalyticsHost` (funnel analytics and web vitals for adults), `ReelShareButton` (adult only), `ProfileVisibilityRow` (adult only), `ParentCenterSection`, `account.follow-requests`, `_tabs.reels`, `parent.index`, `parent.consent.$token` | Adult controls show; funnel analytics start for an adult account (open decision).                                                                                                                 |

Nothing in `src/` needed to change, so no unit test was added. The AI gate test (`gate.test.ts`) and the privacy floor test
(`minor-privacy-floor.test.ts`) already pin the cohort rules the stored value now feeds.

## 5. Operating it

1. Run `docs/age-cohort-at-18-preview.sql` against production (read-only, counts only) and read the numbers: how many would be
   aged, how many are left alone and why, how many have no stored privacy row, how many reels become drafts.
2. Apply the migration. It changes no row. On production it schedules the sweep when `pg_cron` is there.
3. First run by hand, small: `SELECT private_sec.age_adult_cohorts(10);` then read the counts. `failed` should be 0; a failure is
   one person whose reel or post row would not update (a legacy row a trigger rejects). They stay on the stricter cohort, with
   nothing changed, and each run retries them.
4. Let the daily job run. `remaining` falls to 0; `adults_left_alone` counts known adults the sweep deliberately skips
   (under-13 cohort, age review pending), for the owner.

On a database without `pg_cron` (the hosted sandbox, local), nothing runs until someone calls the function.

## 6. Not done

- **The 13 and 16 transitions.** The stored cohort also never moves at 13 (under-13 to 13-15) or 16 (13-15 to 16-17). A stale
  lower cohort only errs stricter (reels, DMs with adults, analytics sharing, hosting, payments). Moving them changes consent
  rules (`parental_consent_required` by cohort), which is legal territory, so they are not touched.
- **Under-13.** A known adult with a stored `child_under_13` cohort (a managed account that was handed over, or an old
  provision) is left alone and counted in `adults_left_alone`. Moving them removes a consent lock.
- **Managed accounts.** The handover stream decides them. Once a managed account is no longer in `managed_accounts` the daily run ages it.
- **An unknown birthday**, and a stored teen cohort with no birthday (from the old `age_category` mapping), are untouched.
- **Anything with `age_review_required`.** A moderator decides (`clear_age_review`).
- **The roster, reviews, age display, host numbers, funnel analytics** (section 7).
- No UI change, so no E2E spec. The Post and resume actions the notice points at already exist.

## 7. Owner decisions still open

1. **13 and 16 transitions** (section 6): leave as is (stricter, safe) until the needs-legal items are decided, or extend the
   sweep to move 13-15 to 16-17 at 16 and under-13 to 13-15 at 13 together with a consent review. Recommended: leave.
2. **Under-13 cohort on a known adult:** a person on a stale `child_under_13` stays consent-locked. Recommended: handle with
   the handover stream (a managed account that became a normal adult), not here.
3. **Adult behaviour with no stored setting** that begins the day they flip: new reviews of them, their roster row on a public
   team (visible to a visitor), host attendance numbers, their age shown with a visible profile, and funnel analytics (GA4, web
   vitals) switching on for the account. Options: a one-time default per item (hide from rosters until chosen, `show age`
   switch, analytics off until the adult opts in), or accept it as what an adult account is. Recommended: accept for
   reviews and host numbers, add a setting for the roster row and the age display, and keep analytics as it is for every adult.
4. **Team youth status:** a team whose last non-adult member turns 18 stops being a youth team (its venue becomes public under
   `team_is_youth`, #330). It is a team-level setting with all members adult. Say if the team should be asked first.

## 8. Tests and rehearsal

- `992_age_cohort_at_18.test.sql`: 178 assertions. Shape (nobody can call it, the table is closed); the rule at the exact 18th
  birthday, the day before, a leap-day birthday (`age()` makes it 1 March in a common year, the same for every adult rule),
  an unknown birthday, a managed account, an under-13 cohort, a pending review, a real 16 and 17-year-old; the stale teen
  differs from an ordinary adult before the sweep and equals one on every cohort reader after it; capped, idempotent,
  notices once, wording has no legal claim; the privacy row, follow approval, DMs, reels, availability, profile as a member
  and as a visitor are not wider; a person who then posts, resumes and goes public gets exactly that; a failing person is left
  exactly as they were; a correction back to a minor lowers the cohort and re-applies the floor, and back up keeps the review.
- Negative controls (the migration with one step removed, the test must fail): no privacy row (18 failures), reels not drafted (9),
  posts not paused (2), managed not excluded (10), under-13 included (10), pending review ignored (12), no `shared` (2), no
  widening guard (2), no adult test (19), callable by clients (28), audit row not closed (1), no notice (13), no savepoint (the
  file stops on an error).
- Ledger-route rehearsal on a local replay made without the file: a wrong-md5 copy rolls back with nothing left; the good copy
  applies; the object fingerprint (3464 objects) equals a full replay with the file; a second run stops on the ledger key.
- Rollback rehearsal: refuses without the confirmation; refuses when a function changed; removes exactly what the migration
  added (fingerprint back to 3460, the audit table kept, a flipped person stays flipped); re-applying works.
