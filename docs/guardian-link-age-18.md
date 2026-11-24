# Guardian links end at 18

Owner decision 2026-11-20: "Guardian link end after 18." A guardian link ends when the child turns 18.

This is a guardian-safety rule change. It fails closed (an unknown birthday keeps the link), loses no data (nothing is
deleted; the sweep only sets `status = 'revoked'` and the consent record is kept), is tested (SQL test 965, negative
controls, unit tests) and is reversible up to the links the sweep already ended (rollback below). A birthday correction
that makes the person a minor again puts the swept links back (section 2, "A corrected birthday").

| Piece              | Where                                                                                                                  |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Migration          | `supabase/migrations/20261125200000_guardian_links_end_at_18.sql`                                                      |
| SQL test           | `supabase/tests/965_guardian_links_end_at_18.test.sql` (209 assertions); 955 and 761 updated                           |
| Rollback           | `docs/rollbacks/20261125200000_guardian_links_end_at_18.down.sql` (guarded; rehearsed)                                 |
| Server rule (TS)   | `src/lib/guardian-links-in-force.server.ts`; client: `src/lib/guardian-link-in-force.ts`                               |
| Read-only preview  | `docs/guardian-link-age-18-preview.sql` (counts only; the owner runs it against production before approving any apply) |
| Parent Center copy | `src/routes/parent.index.tsx` (`data-testid="family-link-ends-at-18"`); E2E in `fixture-family-flows.spec.ts`          |

## 1. Scope: everything that reads a guardian link, and what changes at 18

Found by replaying every migration into a scratch database and listing every function, policy, trigger and view whose
text mentions `guardian_links`, `parental_consents`, `managed_accounts` or `is_guardian_of`, then grepping `src/`.

"Known adult" below means a stored birthday (`profile_birthdays`) whose `age()` is 18 or more. This is the computation
`is_minor` and `game_payment_guardian_ready` already use, so they cannot disagree with it. An unknown birthday is not a
known adult. A managed account is never treated as ended.

### 1a. SQL: one function sits under almost everything

`private_sec.is_guardian_of(parent, child)` (active and verified link) is called by the public wrapper
`public.is_guardian_of`, by 14 row level security policies, and by about 40 functions. Changing it changes all of
them at once, with no job needing to run:

- Policies: `age_change_events`, `child_controls`, `entity_follows`, `event_availability`, `event_registrations`,
  `family_audit_log`, `follow_requests`, `game_invites`, `join_requests`, `late_cancellations`,
  `parental_consent_events`, `player_availabilities`, `team_event_availability`, `team_invites`. After 18 the guardian
  reads none of an adult's rows.
- Guardian actions (all refuse after 18, `NOT_AUTHORIZED` / `NOT_GUARDIAN` / `42501`): `set_child_controls`,
  `revoke_parental_consent`, `guardian_approve_join_request`, `guardian_approve_team_invite`,
  `guardian_cancel_child_game`, `create_parent_request`, `set_event_availability`, `set_team_event_availability`,
  `register_for_event`, `rsvp_tryout`, `cancel_event_registration`, `cancel_tryout_rsvp`, `sign_team_waiver`,
  `get_event_waiver`, `can_manage_followers`, `is_self_or_guardian`.
- Visibility helpers that let a guardian see more of a minor than a stranger: `can_see_minor_name`,
  `can_comment_on_minor_content`, `can_see_event_location`, `can_see_post_venue`, `can_view_post`,
  `availability_post_visible`, `guardian_public_profile`, `roster_row_visible`, `team_invite_reaches_invitee`,
  `family_post_viewer_access`, `teen_reel_viewer_access`, `guard_family_post*`, `guard_teen_reel_team`,
  `minor_messaging_block`, `profile_ages`, `guard_contact_request_minor_recipient`, `analytics_share_active`,
  `guard_analytics_team_share`, `track_late_tryout_cancel`, `resolve_family_post_link`.
- `private_sec.guardian_approval_valid` (an approval counts only while its guardian is the guardian now) asks
  `is_guardian_of`, so every approval stamp stops counting at 18 too.

Readers that query `guardian_links` directly, and what they do now (all use the same rule):

| Reader                                                                         | Before                                                   | After 18                                                                                                                                                    |
| ------------------------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `private_sec.is_guardian_of`                                                   | active + verified                                        | in force (above)                                                                                                                                            |
| `guardian_payment_approval_missing`                                            | any active link blocks a payment without approval        | no link in force, so nothing is missing: the trigger, PayPal and the manual-claim check all say yes                                                         |
| `child_game_participation_allowed`                                             | a minor's switch, or an under-13 cohort                  | an adult with no guardian authority is always allowed (a stale cohort cannot hold them)                                                                     |
| `team_chat_member`                                                             | a teen-cohort member needs a link and a messaging switch | a known adult is a member like any adult                                                                                                                    |
| `ai_analysis_allowed`, `clamp_ai_processing_for_minors`                        | a minor cohort needs the guardian's `ai_analysis` on     | the guardian's switch binds only while `guardian_switches_apply` (minor cohort and a guardian still has authority); the adult's own privacy setting decides |
| `minor_messaging_block` (the controls part)                                    | a minor cohort is held by the guardian's `messaging`     | same: the switch binds only while `guardian_switches_apply`                                                                                                 |
| `public_xp_enabled`                                                            | a minor cohort with the guardian's `public_xp` opt-in    | same: an adult's card follows the adult rules, not a guardian's opt-in                                                                                      |
| `notify_guardians`, `notify_guardians_of`                                      | every active link                                        | links in force only (the managing guardian of a managed account is still told)                                                                              |
| `guardian_children_overview` (Parent Center, guardian activity, team contacts) | every active link                                        | links in force only: the child leaves the guardian's list that day                                                                                          |
| `enforce_child_game_participation`, `team_respond_invite`                      | only for `is_minor`                                      | unchanged: a known adult is not `is_minor`, so these already did not apply                                                                                  |
| `revoke_guardian_link`                                                         | active link, refuses a managed child                     | unchanged (a guardian may still end a link by hand; refuses a managed child as before)                                                                      |
| `approve_parental_consent`, `redeem_minor_invite`, `provision_managed_child`   | write links                                              | unchanged. A link written to an adult is out of force from the start and the next sweep ends it                                                             |
| `guardian_links` RLS ("visible to both parties", "moderators read")            | rows visible to the parties and moderators               | unchanged: both sides can still see the row, then see it as `revoked`                                                                                       |

Policy on `parental_consents`: "Linked parent reads child consent record" read `parent_user_id = auth.uid()` forever.
It now also needs `NOT guardian_authority_ended(child)`, so the guardian who held an adult's consent record stops
reading it. The child's own policy and the moderators' are unchanged.

### 1b. Server and client code that read the table

| Code                                                                                                              | Used for                                                                         | Change                                                                      |
| ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/lib/guardian-push.server.ts`                                                                                 | push and in-app notice to a child's guardians that a request waits               | rule (an ex-guardian is no longer pushed about an adult's join request)     |
| `src/lib/join-guardian.server.ts`                                                                                 | tells the host which requests wait on a guardian                                 | rule                                                                        |
| `src/lib/game-reminders.server.ts`                                                                                | whether a reminder's player already holds a place (free game, guardian approval) | rule                                                                        |
| `src/lib/tryouts.functions.ts` (two places)                                                                       | tryout invite list (guardian badge) and the "email the guardian" send            | rule (the email now goes to the adult player)                               |
| `src/lib/team-availability.functions.ts`                                                                          | which children a guardian may answer availability for                            | rule                                                                        |
| `src/lib/use-has-guardian.ts`, `src/lib/team-roster.ts`                                                           | the player's own prompts ("ask your guardian")                                   | rule, via `my_guardian_link_in_force`                                       |
| `src/lib/support/assistant.server.ts`                                                                             | whether to add "parent" to the support assistant's role hints                    | none: prompt context only; correct after the sweep                          |
| `src/components/child/GuardianProfileCard.tsx`                                                                    | whether to show guardian-only cards (`status <> revoked`)                        | none: right after the sweep (a guardian with no child left stops being one) |
| `adminFamilyOverview` (moderators)                                                                                | list of links with status                                                        | none: moderators see the row and its status                                 |
| server code calling the `is_guardian_of` RPC (family clips, coach analytics, public XP, teen reels, child safety) | guardian checks                                                                  | none needed: the RPC carries the rule                                       |

The server readers call `public.guardian_links_in_force(children[])` (service role only). If it does not exist (app
deployed before the migration, or the migration rolled back) they read the `active` rows as before: that keeps every
minor's protections on and only means an adult's link is not yet treated as ended. It never fails open for a minor.

### 1c. At the moment of the end

| Thing                                                                                          | What happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The link                                                                                       | out of force the day the birthday passes (every reader above); `status = 'revoked'` when the sweep runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| The guardian's approvals on join requests that are not yet a place                             | cleared by the existing trigger on `guardian_links` when the status changes (`clear_stale_guardian_approvals`); before the sweep they are unused (no gate asks an adult)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A place already taken on a roster                                                              | untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pending team invites a guardian approved                                                       | an adult is not `is_minor`, so `team_respond_invite` never asked; unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `child_controls` rows (the consent switches)                                                   | left as they are, and **every reader of them** now ignores them for a known adult with no guardian authority: game participation, team chat, AI analysis (and the AI clamp on their own privacy settings), messaging controls, public XP, and the push notification switch and night curfew (`push-curfew.server.ts` asks `guardian_authority_has_ended`). The guardian can no longer change them (`set_child_controls` refuses), so none of them can hold the adult. SQL test 965 checks each one for the adult and for a 16-year-old and a managed adult (who stay held). The remaining stale-cohort rules are in "Finding: the stored age cohort never ages". |
| `parental_consents` record                                                                     | **kept as history, deliberately not revoked** (see "Decision: consent records"). The guardian's read of it ends.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Notifications                                                                                  | the new adult gets one notice ("Your family link has ended"), each guardian gets one per child ("Family link ended"). Wording is neutral, makes no legal claim and does not say anything was withdrawn. The existing "Approval was withdrawn" notice is never triggered.                                                                                                                                                                                                                                                                                                                                                                                         |
| Audit                                                                                          | the existing trigger writes `link.revoked` to `family_audit_log`; the sweep also records the link in `private_sec.guardian_link_age_events`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A guardian's read access to the adult's data                                                   | none remains reachable (SQL test 965 checks controls, join requests, family log, consent record, Parent Center list, and that every guardian action refuses)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Things a guardian authorized for the child (public profile, family posts and clips, public XP) | they ride on `is_guardian_of(authorizer, child)` (`guardian_public_profile`, `family_post_viewer_access`, `guard_family_post`), so they stop being served at 18: a guardian-authorized public profile or family post of an adult goes back to the adult's own settings. A privacy gain; the adult can set their own.                                                                                                                                                                                                                                                                                                                                             |
| Data the adult shared with the guardian themself                                               | not covered: out of scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

## 2. Design

### One rule, plus a sweep

1. `private_sec.guardian_link_in_force(child, status)`: `status = 'active'` AND NOT `guardian_authority_ended(child)`.
   `guardian_authority_ended(child)`: a known adult who is not a managed account. `is_known_adult(user)`: stored birthday,
   `date_part('year', age(birthday)) >= 18` (the same text as `game_payment_guardian_ready`).
2. The readers in 1a use it. The link is treated as ended the moment the 18th birthday passes. This does not wait for
   any job and works on the sandbox (no pg_cron).
3. `private_sec.end_adult_guardian_links(cap = 200)` records the end: for active links whose child is a known, unmanaged
   adult, `status = 'revoked'`, notices (once per side), a row in `private_sec.guardian_link_age_events`. Scheduled
   daily at 04:41 UTC when pg_cron exists (guarded as `20261118100000` guards its job); callable by hand:
   `SELECT private_sec.end_adult_guardian_links();` returns counts only
   (`ended, notified, failed, remaining, managed_waiting`). Idempotent; capped per run (1 to 1000); one failing link is
   skipped with a warning and retried next run; selects only the rows above, so it can never touch a minor, an unknown
   age or a managed account. The new adult is told once however many guardians they had and however the runs fell: only
   when no link of theirs is recorded as ended before (the cap or a locked row can split one adult's guardians across
   runs, days apart); each guardian is told once per child.
4. `public.guardian_links_in_force(children[])` (service role) and `public.my_guardian_link_in_force()` (signed-in user,
   about themself) give server code and the app the same rule, so no client keeps a copy.

### A corrected birthday (the sweep's end is a status, the rule is a date)

`review_birthday_correction` (support-approved) can rewrite `profile_birthdays` (the immutability guard lets it through,
under `openrun.birthday_review`). The un-swept link would come back by itself under the rule, but a swept link is
`revoked` and would stay so: a person corrected to 16 would be left without a guardian link, so without the payment
gate, approvals, participation and messaging switches, or the Parent Center, depending on whether the daily job had run
first. So a trigger on `profile_birthdays` (`trg_birthday_correction_restores_links`) does the reverse: when a birthday
changes and the person is no longer a known adult (younger, or unknown), the links the sweep recorded as ended for them
(`guardian_link_age_events`, kind `ended`) go back to `active` (the existing triggers write the audit row), both sides are
told once, and the record is cleared so a later 18th birthday ends and tells again. Only links the sweep ended are
touched, never one a guardian ended by hand. Approvals the sweep cleared are not reinstated: the person needs a fresh
approval like any minor with a guardian. Test 965 section 8 covers: still an adult (nothing), corrected to 16, two
guardians, hand-ended link, turning 18 again. If the owner prefers that a support person decide, drop the trigger and
read the events list by hand.

Unknown birthday: the link stays (fail closed). The age uses the database clock's date (`age()` uses `current_date`, UTC
on Supabase), as `is_minor` does: an 18th birthday begins at 00:00 UTC, which is the evening before for the US.

### Why this and not something smaller or bigger

- Smaller (only the sweep): leaves up to a day of lag, and no end at all on the sandbox.
- Bigger (also move `profiles.age_cohort`, privacy settings, reels): no. See "Finding: the stored age cohort never ages".
- A generated column or a view on `guardian_links` cannot hold "now"; a rule function used by the readers can.

### Decision: consent records are kept, not revoked

The brief suggested revoking `parental_consents` the way `revoke_guardian_link` does. The migration does not, because
that would strand the new adult. `profiles.age_cohort` is set when a birthday is saved and nothing ages it, so an
18-year-old can still carry `teen_13_15` (consent required by default policy) or `child_under_13`.
`platform_status` and `child_features_locked` read the stored cohort and the consent state: with the record revoked
they answer `consent_revoked` / locked, the Child Consent Gate would block the app, and the existing
`notify_on_consent_change` trigger would tell the new adult "Approval was withdrawn ... games, messages and videos are
switched off". Keeping the record (status `approved`, as it was) avoids all three, and the guardian's read of it is
closed by the policy change. If the owner prefers revoked records, three more functions must change first
(`platform_status`, `child_features_locked`, `notify_on_consent_change`): a separate decision.

### Finding: the stored age cohort never ages (pre-existing, not changed here)

`profiles.age_cohort` and `age_category` are written when a birthday is saved (`sync_age_category_from_birthdays`) and
never again; no job moves them. Anything that reads `age_cohort_of` (reel audience, `platform_status`, team chat,
privacy floors, the Parent Center card's cohort label) keeps treating an 18-year-old as a teen until a person
changes it. `is_minor` and the pay rule read the live birthday and are right. This change deliberately reads the live
birthday and does not touch the cohort, because moving it changes what is public about a person (reels, profile
visibility). It is a separate owner decision and probably needs its own review. Every place where a guardian's
switch (`child_controls`) was keyed on the stored cohort would have held an 18-year-old whom nobody can change, so each
now asks `private_sec.guardian_switches_apply(user)` = minor cohort AND NOT `guardian_authority_ended`:
`child_game_participation_allowed`, `team_chat_member`, `ai_analysis_allowed`, `clamp_ai_processing_for_minors`,
`public_xp_enabled`, `minor_messaging_block` (controls) and the push curfew (TypeScript, via `guardian_authority_has_ended`;
any doubt keeps the stored cohort, so it can only be stricter, never open a minor's curfew).

What the stale cohort still does, and this change deliberately leaves (these are cohort policy, not a guardian's switch;
nobody's switch is involved and the guardian's authority is not what holds the person): the minor privacy floor on
`privacy_preferences` (`enforce_minor_privacy_floor`), the AI cohort allowance in `gate.server.ts` (`cohortAllowed`), the
"teen to adult needs a shared game" rule in `minor_messaging_block` for a stale 13-15 cohort, reel audience and
`platform_status`. They hold a person whose birthday is old enough until the cohort is moved. **OWNER DECISION**: whether
and when to age the stored cohort (a person-visible change: reels, profile visibility). Until then they behave exactly as
they did for an 18-year-old before this change; a guardian link ending neither causes nor worsens them.

**Followed up (owner delegated the recommended option, 2026-11-21): the stored cohort now ages to `adult` at 18, only upward, only
for a known, unmanaged adult, by a separate daily sweep. See `docs/age-cohort-at-18.md`.**

## 3. Managed accounts: decided 2026-11-21 (handover, option 1), built in 20261128100000

> **Update 2026-11-21.** The owner delegated this to the recommended option, and it is built as a guardian-started,
> adult-completed handover: see [managed-account-handover.md](managed-account-handover.md). The rule and the sweep still
> leave a managed account alone until the adult completes the handover. The text below is the question as it stood.

A managed child is credential-less: the managing guardian is the only way into the account. Ending its link at 18 would
strand it, so:

- The rule and the sweep leave managed links alone. Everything about a managed account is exactly as before: the
  guardian still sees and changes it, `revoke_guardian_link` still refuses it (`MANAGED_CHILD_DELETE_INSTEAD`), the pay
  page's manual-claim hold (#440) still applies to it (its manual claim needs the guardian's approval for the game).
- Visible: the sweep reports `managed_waiting` (a count) and tells the managing guardian once, in the app: "A managed
  account has turned 18 ... stays linked to you for now. Contact support to plan handing it over." (once, recorded in
  `guardian_link_age_events` with kind `managed_notice`). The preview query counts them. Since migration
  `20261130100000_managed_notice_points_to_handover` the sentence reads "... so you still manage it until they complete a
  handover. You can start one from your Parent Center: open their page and choose "Start handover"." (the same notice,
  once, to the same guardian; notices sent before keep the old words).
- The Parent Center page says a managed account stays linked.

Handover options. Option 1 is now built: the handover (migration `20261128100000`, `docs/managed-account-handover.md`) lets
the managing guardian start it, and the notice above points to it (`20261130100000`). Options 2 and 3 are unchanged: 2 is
still what the Parent Center offers for a managed child, and 3 is still not recommended. The question as it stood:

1. The new adult gets their own sign-in: they set an email and password (the account is claimed), the `managed_accounts`
   row is removed, and then the link ends by the same rule. Keeps their history, games and teams.
2. The guardian deletes the profile (what the Parent Center offers today for a managed child). Loses everything the
   account held.
3. Leave it: the guardian keeps managing an adult. Not recommended; it is what this change is meant to stop.

Needed (answered by the handover design): who may start the handover (the adult can't sign in), identity checks, what the guardian keeps afterwards.

## 4. Anything touching age of majority or legal wording

No legal text was changed. Items for the owner (issues #306-#313 left alone):

- The notices say "You are 18 or over". They make no claim about legal adulthood, consent or parental rights.
- The Parent Center line says a link ends "on the day a child turns 18". 18 is the app's `adult_age` policy (default 18),
  not the age of majority anywhere in particular. If `age_policy` `adult_age` changes, this rule (which uses 18
  directly, as `is_minor` and `game_payment_guardian_ready` do) does not follow it. The same is true today of those two.
- `CHILD_POLICY_DISCLAIMER` and the consent wording ("your consent for their account is withdrawn" in the End family
  link confirmation) are unchanged.

## 5. Behaviour change worth knowing

- 20261124200000's owner decision (2026-11-18, "block up front, the guardian rule is not loosened") described an adult
  whose old link was still active. Under this rule that adult's manual claim now passes, and the pay page no longer
  shows the hold for them. The hold and its copy stay for managed accounts. Tests 955 and 761 were updated for that
  (they asserted the old behaviour); the pay page code is unchanged.
- A guardian who still has an in-app request waiting for an adult's approval no longer sees it (the guardian activity
  list uses the overview RPC).

## 6. Apply

Order: migration, then the app (the app falls back to the old reading if the migration is missing, so either order is
safe, but the rule only takes effect once both are there).

Before approving: the owner runs `docs/guardian-link-age-18-preview.sql` read-only against production. It returns counts only:
active links, how many are a known adult (would end) and how many of those are managed (would stay), active links
with an unknown birthday, under-18 links turning 18 within 30 days, and three side-effect counts.

Ledger route rehearsed locally (a throwaway database replayed to the previous migration): the ledger row inserted with
the file text, md5 checked, `EXECUTE`d in one transaction; a copy with the wrong md5 rolled back with nothing left (no
ledger row, no function, no table); a second run of the same file stopped on the ledger key; the objects were identical
to the plain replay (function fingerprints) and test 965 passed (209) against the ledger-applied database.

After applying on a database with pg_cron the job `end-adult-guardian-links` exists; elsewhere run the sweep by hand.
The first run ends every link that already qualified (the preview's `would_end`), up to 200; run it again until
`remaining` is 0. Notices go out for each.

## 7. Rollback

`docs/rollbacks/20261125200000_guardian_links_end_at_18.down.sql`: refuses without
`SET app.confirm_guardian_links_end_at_18_rollback = 'yes'`, refuses if any function the migration touched changed
since (md5 of each), puts the eleven readers and the consent policy back as they were, drops the birthday-correction trigger, unschedules the
job and drops the new functions. **It cannot un-revoke links the sweep already ended**; it keeps `private_sec.guardian_link_age_events`
so the list survives, and its header has the one statement to restore them if the owner decides to. With the trigger
gone, a birthday correction after the rollback no longer restores a swept link: the header says to check approved
corrections by hand. Rehearsed: no confirmation refuses; a changed function refuses; the real run leaves every function,
policy and trigger identical to a replay without the migration (fingerprints); a second run refuses.

## 8. Not done

- The managed-account handover: built since, see [managed-account-handover.md](managed-account-handover.md) (migration 20261128100000).
- Moving the stored age cohort (separate decision, finding above), and with it the cohort-policy rules that still treat a stale teen cohort as a teen (privacy floor, AI cohort allowance, teen-to-adult DM context rule). No guardian switch is among them.
- Revoking consent records (decision above).
- Backfilling Parent Center copy for an individual ended link (the guardian is told by the in-app notice; the list simply
  no longer shows the child).
- `use-has-guardian` and the support assistant's role hint read a link status for display only; the database is the
  authority in every case.
