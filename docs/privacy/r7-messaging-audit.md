# R7: messaging policy audit (stranger-to-minor direct messaging)

Status: audit and regression test only. **No behaviour is changed by this pull request.** Nothing applied to production.

Intended policy (owner, 2026-11-04): keep guardian-mediated messaging for minors; adult-to-adult communication continues with block, report and privacy controls; **no stranger-to-minor direct messaging**.

## What was audited

| Surface                                  | Mechanism                                                                                                                                                              | Result                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation creation                    | `create_direct_conversation` (definer) is the only path: no INSERT policy on `conversations` or `conversation_participants`; calls `minor_messaging_block` first       | holds (test 430 and 120)                                                                                                                      |
| Participant changes                      | no add-participant function; clients may only delete their own participant row                                                                                         | holds: a client cannot add a participant or create a conversation                                                                             |
| Message delivery                         | BEFORE INSERT trigger `enforce_minor_messaging` re-checks every other participant on **every message**; participants-only read and insert policies; user blocks        | holds: revoking a guardian link or changing child controls takes effect inside existing conversations; a non-participant cannot read or write |
| Guardian revocation                      | `minor_messaging_block` reads `guardian_links` live                                                                                                                    | holds (under-13: former guardian is refused at the next message)                                                                              |
| Attachments                              | private bucket `message-attachments`; storage policies require conversation participation; `messages_require_checked_attachment`; metadata stripping (#258) not merged | holds; see the upload review for the remaining timing question                                                                                |
| Notifications / Realtime                 | messages are published to Realtime under the participants-only policy; the database writes no message notification                                                     | holds                                                                                                                                         |
| Profile switching                        | a managed child acts with the child's own session, so the same rules apply; the guardian acts as themselves                                                            | holds (cache purge on switch: G5)                                                                                                             |
| Contact requests from availability posts | previously **not** covered by the minor-messaging rules                                                                                                                | **open on `main`**: the R2 fix (#265) is not merged (checked 2026-11-11)                                                                      |
| Adult to adult                           | unrestricted except blocks and the recipient's `allow_messages` setting                                                                                                | as intended                                                                                                                                   |

## Exceptions to the intended policy (existing behaviour, recorded in test 430 as "KNOWN EXCEPTION")

- **E1. Unlinked 16-17.** A 16-17 year old with no guardian link has no `child_controls` row, and `minor_messaging_block` has no rule for adult-to-16/17, so any adult can open a conversation. (A linked child defaults to guardian-only, so this affects self-registered teens only.)
- **E2. Minor to minor.** Two unrelated unlinked minors aged 16-17 can open a conversation; no rule covers minor-to-minor.
- **E3. "Peers" setting.** When a guardian chooses `peers`, an adult stranger can message a 16-17 year old. Test 120 asserts this as intended; under the stated policy it is an exception the owner should confirm.
- **E4. Shared-game context.** For 13-15 year olds (and under-13 when `child_adult_dm_requires_guardian_link` is turned off) the rule is "shares a game or chat", and any adult who has joined the same public game qualifies. Whether that is a "stranger" is a policy decision.
- **E5. Contact requests by a minor.** A 16-17 year old with no guardian controls can send a contact request to an adult through the adult's post (R2 would keep this and gate only requests to a minor; R2, #265, is not merged as of 2026-11-11).

## Proposed fix (not implemented; changes product behaviour, needs owner approval)

Add one rule to `minor_messaging_block`, behind a new `age_policy` flag (`minor_dm_requires_connection`, default on): when one side is not an adult and the other is an adult, require the adult to be a guardian or `private_sec.can_see_minor_name(adult, minor)`; and for two minors, require `shares_team` or a shared game. Ship it with the flag readable by the superadmin age-policy panel so it can be tuned without a migration. Verify with test 430 (the three KNOWN EXCEPTION assertions then become refusals and are renamed).

## Test

`supabase/tests/430_messaging_policy_audit.test.sql` (18 assertions, runs on `main` alone).
