# Guardian verification: operations

How BallaCity staff verify a new parent or guardian, review suspicious claims with two people, handle appeals, and recover or
suspend guardian access. The database enforces every rule below; this document is the staffing and response workflow around it.

- Design and threat model: `docs/privacy/sec4-first-guardian-verification.md`
- Migration: `supabase/migrations/20261108100000_first_guardian_verification.sql`
- Tests: `supabase/tests/500_first_guardian_verification.test.sql`, `supabase/tests/501_guardian_verification_finalization.test.sql`
- Staff screen: Admin → Child safety → Guardian verification

Points marked **(counsel)** need a decision from legal counsel before launch. Nothing here is legal advice.

## 1. What the system guarantees

- Redeeming a family invitation, or opening a parental-consent e-mail link, creates only a **pending claim**. A pending claim grants
  nothing: no messaging, no location, no controls, no approvals, no Parent Center, no consent management.
- A claim becomes a guardian link only when staff verify it (or, for an extra guardian, when a current verified guardian approves it).
- At activation the database checks again that the guardian is an **eligible adult** (adult age, age not under review, account not
  suspended, not a managed child account, no guardian-authority hold) and that the child is still a minor with no block between them.
- **Suspicious** claims need two different staff members (section 4).
- Every decision writes an append-only row to `guardian_link_audit`: claim created, first review, approval, decline, withdrawal,
  appeal filed / upheld / rejected, claim reopened, link activated / revoked / restored / suspended / reinstated, guardian authority
  suspended / hold lifted.

## 2. Roles

| Role            | Who (app role)                                                  | May                                                                                                             |
| --------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Verifier        | `moderator`, `admin` or `superadmin`, trained (section 3)       | Verify a non-suspicious claim; make the **first** review of a suspicious one; decline; suspend a guardian       |
| Second reviewer | A different verifier (procedure: at least 3 months in the role) | Make the **second** review of a suspicious claim, a fraud-revocation restore, or lift a suspension              |
| Appeal reviewer | A verifier who did not make the original decision               | Uphold or reject an appeal                                                                                      |
| Supervisor      | `admin` or `superadmin`, named in the rota                      | Owns the queue's service levels, assigns second reviews, runs the audit review (section 9), handles escalations |

**Separation of duties (enforced by the database):**

- Nobody reviews a claim they are a party to (the claimant or the child).
- The staff member who **submitted** a claim (an account recovery) cannot review it.
- The two reviewers of a suspicious claim are two different people.
- The staff member who **declined** a claim cannot decide its appeal or review it again after the appeal reopens it.
- The staff member who **suspended** a guardian cannot lift the suspension.
- Restoring a link revoked for suspected fraud needs two different staff members. The database treats a revocation as suspected fraud
  when staff say so, when the link was suspended or its guardian was under an open hold, when account recovery replaced the guardian's
  account, or when the guardian has a hold lifted with "revoke". No compromise path can be undone by one person (test 501, finding F1).

**Separation of duties (procedural, not enforced):** a reviewer with a personal connection to the family (relative, neighbour, same
team) hands the claim to someone else. The supervisor does not act as second reviewer on claims they assigned.

## 3. Training (before a verifier's first decision)

1. This document and the SEC-4 design document.
2. Identity-document checks over video: matching the person to the ID, spotting edited documents, never recording or screenshotting.
3. Grooming red flags: a "parent" who coaches, hosts, or messages the child; pressure to hurry; a mismatch between the invitation name
   and the child; one adult claiming several children.
4. Privacy: what may and may not be stored (section 5); minimum necessary contact with the child.
5. Escalation: when to stop and call the supervisor, and the mandatory-reporting duty if abuse is suspected **(counsel: which
   jurisdictions and which agency)**.
6. A supervised shadow shift: at least 5 claims reviewed alongside an experienced verifier.

Refresh yearly, and after any change to this document. The supervisor keeps the training record outside the app.

## 4. Suspicious claims (two-person rule)

The database marks a claim suspicious, and then requires a first and a second review by two different staff members, when any of
these is true (`private_sec.guardian_claim_suspicion`):

| Reason                 | Meaning                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `relationship_signals` | The claimant already shares a team, a game, a contact request or a conversation with the child    |
| `name_mismatch`        | The first name the inviter typed does not plausibly match the redeemer's display name or username |
| `other_claims`         | The claimant has other pending or declined claims (any child)                                     |
| `method_other`         | The reviewer chose the method "other"                                                             |
| `reopened_on_appeal`   | The claim was declined, then reopened by an upheld appeal                                         |
| `account_recovery`     | Staff opened it to move a guardian to a new account                                               |
| `link_restoration`     | Restoring a link that was revoked for suspected fraud                                             |

Name matching is deliberately loose (Sam / Samantha counts as a match); a mismatch does not refuse the claim, it only adds the second
review. The queue shows the invitation's child name next to the redeemer's profile name and username.

Relationship signals also need the reviewer's explicit acknowledgement at **each** review.

**Second reviewers do their own check.** They do not rely on the first reviewer's notes: a second, independent contact with the
claimant (for example a video call after the first reviewer checked a document) and their own case reference.

A claim with no reason above needs one verifier who is not a party and did not submit it.

## 5. Evidence

### Accepted evidence (method in the app)

| Method                    | Accepted evidence                                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------------------------- |
| `government_id`           | The claimant's government photo ID, shown live over video and matched to the person                      |
| `consent_document`        | A signed BallaCity parental consent form plus a matching ID                                              |
| `video_call`              | A live video call with the claimant and ID, where the child confirms the relationship **(counsel: age)** |
| `school_or_league_record` | A school or league record naming the claimant as parent or guardian, confirmed with the school or league |
| `court_order`             | A guardianship or custody order naming the claimant                                                      |
| `other`                   | Anything else, described in the case. Always triggers a second review                                    |

Which methods satisfy "verifiable parental consent" for under-13 accounts is a legal question **(counsel: COPPA VPC methods)**.

### Case reference format

The app stores a **reference** to the support case, never the evidence. Format (checked by the database):

- 8 to 64 characters, `^[A-Z]{2,10}-[0-9]{4,}(-[A-Z0-9]{1,20})?$` after trimming and upper-casing;
- examples: `GV-20261104`, `ZD-48213`, `ZD-48213-B`;
- free text, links, e-mail addresses and file names are refused.

### What is never stored

- No ID images, document scans, screenshots or recordings in the app, in storage buckets, in chat or in the case reference.
- No ID numbers, dates of birth from documents, or addresses in any app field.
- Documents are viewed live (video) or in the support system's restricted attachment store, and deleted from there after the
  retention period **(counsel: retention period and location)**.
- The case reference is readable by the parties in the audit trail. Write nothing in it you would not show the family.

## 6. Service levels and staffing

### Targets

| Step                                             | Target                                    |
| ------------------------------------------------ | ----------------------------------------- |
| First response to the claimant (contact attempt) | within 24 hours of the claim              |
| Decision (activation or decline)                 | within 72 hours of the claim              |
| Second review after a first review               | within 24 hours of the first review       |
| Appeal decision                                  | within 5 business days of filing          |
| Guardian suspension after a credible compromise  | within 1 hour of the report, 24/7 on-call |
| Account recovery decision                        | within 72 hours of identity contact       |

Claims older than 72 hours, and first reviews waiting more than 24 hours, go to the supervisor (section 7).

### Queue-staffing estimate

Assumptions to replace with real numbers after the first month:

- New first-guardian claims: about 2% of new minor sign-ups per day. At 500 minor sign-ups a week, about 70 claims a week.
- About 40% are suspicious (name mismatches are common because minors use nicknames), so about 28 claims need two reviews.
- Handling time: 15 minutes for a single review (contact, video call, record), 10 minutes for a second review.
- Workload: 70 × 15 min + 28 × 10 min ≈ 22 hours a week, plus about 20% for appeals, recoveries and no-shows ≈ **27 hours a week**.

Staffing: at least **two** trained verifiers on every business day (one person cannot complete a suspicious claim), plus one
on-call supervisor for suspensions outside business hours. Re-estimate monthly from the metrics in section 10.

## 7. Escalation

Escalate to the supervisor when:

- a claim breaches the 72-hour decision target, or a first review waits more than 24 hours for a second;
- the two reviewers disagree (the second reviewer declines instead of approving: the decline stands, and the supervisor reviews it);
- the claimant pressures for speed, refuses video, or the child seems distressed;
- there is any sign of grooming, abuse or trafficking: stop, do not alert the claimant, suspend if a link exists, and follow the
  mandatory-reporting procedure **(counsel)**;
- a court order, custody dispute or law-enforcement request is involved **(counsel)**.

## 8. Procedures

### Verify a claim

1. Open Admin → Child safety → Guardian verification. Read the invitation name, the redeemer's names and every flag.
2. Contact the claimant at the e-mail shown. Open a support case; its id is the case reference.
3. Check identity and relationship with an accepted method (section 5). Acknowledge any relationship signal only after checking it.
4. Record the method and the case reference.
   - Not suspicious: the guardian is linked.
   - Suspicious: your review is recorded as the first review. A different verifier repeats steps 2-4 independently; their review
     links the guardian.
5. Otherwise decline with a reason the family can read.

### Appeal

1. The declined claimant, or the child, files one appeal per claim within 30 days of a staff decline (`file_guardian_claim_appeal`,
   20 to 1000 characters). At most 3 appeals per person in 30 days. A current guardian's own decline of an extra guardian is a family
   decision and is not appealable in the app (support handles it) **(counsel: custody disputes)**.
2. The appeal appears in the appeal queue (`staff_guardian_claim_appeals`) for every staff member except the decliner.
3. The appeal reviewer reads the decline reason and the appeal, contacts the family if needed, and decides
   (`staff_decide_guardian_claim_appeal`) with a reason:
   - **Upheld:** the claim returns to the verification queue as pending, marked `reopened_on_appeal`, so it needs two reviewers. The
     original decliner cannot review it. Nothing is activated by the appeal itself.
   - **Rejected:** the decline stands. The family is notified.

### Account recovery: a guardian lost access

1. The guardian contacts support from a **new** account: adult, confirmed e-mail, in good standing.
2. A verifier checks the request is plausible and opens the recovery (`staff_open_guardian_recovery(old link, new account, reason)`).
   This verifier is the submitter and cannot review it.
3. Two other verifiers verify the person behind the new account as in "Verify a claim" (it is always suspicious). The second review
   links the new account and revokes the old account's link in the same step.
4. If the old account may be compromised rather than just lost, also suspend it (below).

### Restore a wrongly revoked link

- Revoked by mistake (not for fraud): one verifier restores it with a reason and a case reference (`staff_restore_guardian_link`).
- Revoked for suspected fraud (`staff_revoke_guardian_link(..., true)`, or a suspension lifted with "revoke"): the first verifier's
  restore is a first review; a second verifier's restore completes it.

### Compromised guardian account

1. On a credible report (unusual sign-ins, the guardian reports takeover, the child reports strange messages), any verifier
   suspends at once: `staff_suspend_guardian_authority(guardian, reason)`. Every link becomes `suspended`, open device pairings are
   revoked, and the account cannot be activated as a guardian anywhere while the hold is open. The family is notified.
2. Outside the app: force sign-out and a password reset through the auth admin, and review recent messages and approvals made from
   the account **(counsel: notification duties after a breach)**.
3. A different staff member lifts the hold after review (`staff_lift_guardian_suspension`):
   - **Reinstate** with a case reference: each suspended link is re-verified by that reviewer (a child who is now an adult, or a
     block, ends that link instead).
   - **Revoke:** every suspended link is revoked, recorded as suspected fraud, and the guardian's consent records are withdrawn.

### Managed children (no login of their own)

A staff revocation or suspension of the managing guardian takes effect: the child no longer counts as having a guardian
(`has_guardian_link`), the guardian is no longer notified about the child, cannot pair a device, cannot start a session as the child
and cannot delete the child. The `managed_accounts` row stays (it records who created the account). A managed child left with no
guardian cannot sign in; staff either link a verified guardian (recovery) or delete the account through the account-deletion
procedure **(counsel: retention for a deleted child account)**.

## 9. Audit review

- **Weekly (supervisor):** every staff activation, restoration, recovery and reinstatement of the week; every claim activated with
  acknowledged signals; any staff member with an unusual volume. Sample 10% of single-review activations and re-check the case.
- **Monthly (supervisor + one admin not in the rota):** all appeals and their outcomes; all suspensions and how long they lasted;
  claims older than 72 hours; staff role changes (`user_roles`) against the rota.
- **Quarterly:** report the metrics below to the owner; review this document.
- The audit table is append-only. Findings go in the support system, not in the app.

## 10. Metrics

- Claims per week, by source (invitation, consent e-mail, recovery) and kind.
- Share of claims that are suspicious, by reason.
- Time to first response, time to decision, time from first to second review (median and 90th percentile), and breaches of each target.
- Outcomes: activated, declined, withdrawn by the child, withdrawn by the claimant.
- Second-review disagreement rate (a second reviewer declined after a first review).
- Appeals: filed, upheld, rejected, time to decision.
- Suspensions: count, time to suspend after the report, outcome (reinstated or revoked).
- Recoveries and fraud-revocation restorations: count and outcome.
- Per-reviewer volumes (for the audit review, not for performance targets).

## 11. Open points for counsel

- Which verification methods count as verifiable parental consent for under-13 accounts, and whether the video-call method may rely
  on the child's confirmation **(counsel)**.
- Retention period and location for verification evidence held in the support system **(counsel)**.
- Mandatory-reporting duties for staff who see signs of abuse, by jurisdiction **(counsel)**.
- Handling custody disputes, court orders and law-enforcement requests **(counsel)**.
- Notification duties after a compromised guardian account **(counsel)**.
- Whether the case reference should be hidden from the parties in the audit trail **(counsel)**.

## Approval validity (audit F03, with A-F3 and A-F4)

A guardian's approval of a game, a payment or a team invite counts only **while the guardian who gave it still has
authority**: an active, verified link to the child and no open authority hold
(`private_sec.guardian_approval_valid(child, approver)`, migration `20261108160000`).

- **Payments and game joins.** `payment_guardian_missing` and `enforce_child_game_participation` accept a join request's
  `guardian_approved_at` only if its `guardian_approved_by` is still a valid guardian. Suspension, staff revocation,
  account recovery (the old account is revoked) and replacement all void earlier approvals: the current guardian must
  approve again. `guardian_approve_join_request` now replaces an approver who is no longer valid instead of keeping them.
- **Team invites.** `team_respond_invite` applies the same rule. A guardian's approval of an invite accepts it
  directly. After that guardian loses authority, the membership no longer authorizes team contact
  (`team_membership_authorizes`), and a new guardian must re-approve (`guardian_reapprove_team_membership`).
- **Who needs approval.** A child with an active or **suspended** guardian link (`guardian_approval_required`). A
  suspension (security review) therefore keeps every gate closed and the guardian's controls (for example game
  participation off) applying; it never opens them (A-F3). Once every link is revoked, the child is treated like any
  child without a guardian (the existing product rule), and no old approval counts for anything.
- **Holds.** A guardian under an open authority hold cannot create a managed child (A-F4). Lifting a hold with the
  outcome "revoke" also revokes any link the guardian gained while held.
- **Staff note.** After revoking or replacing a guardian, tell the family that pending game, payment and team approvals
  must be given again by the current guardian.

Tests: `supabase/tests/545_guardian_approval_validity.test.sql` (41 assertions). Without the migration, 11 fail: payment
after revocation, suspension and recovery while another guardian remains; joining after suspension and replacement;
the kept stale approver; controls during suspension; a held guardian creating a managed child.
