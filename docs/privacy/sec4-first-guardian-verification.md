# SEC-4: first-guardian verification (Approval B)

Migration: `supabase/migrations/20261108100000_first_guardian_verification.sql`
Tests: `supabase/tests/500_first_guardian_verification.test.sql` (162 assertions), `supabase/tests/501_guardian_verification_finalization.test.sql`
(152 assertions: two-person review, child_name, appeals, recovery, managed children); `460` updated for the new first-guardian behaviour.
Operations (roles, evidence, service levels, appeal and recovery procedures, audit review): `docs/privacy/guardian-verification-operations.md`.
Status: not applied to production. Needs owner approval and the release runbook. Rollback: forward-fix only.

## The problem (R7 review, N3)

A stranger could become an unlinked minor's **first** guardian with no check:

1. The stranger calls `create_minor_invite` and sends the link.
2. The minor clicks it once. `redeem_minor_invite` inserts an active, verified `guardian_links` row. If the minor is under 13, it also
   records the stranger's "consent".
3. `is_guardian_of` is now true. That unlocks messaging with the child, guardian approvals (games, teams, contact requests), controls,
   private game and team locations, payments and data requests.

R7 had already closed adult redemption and the second-guardian path. A child who already has a verified guardian gets a pending
`guardian_link_requests` row that a current guardian decides. The first-guardian path was still one click.

The parental-consent email flow had the same weakness:

- `request_parental_consent` emails a link to an address the **child** types.
- `approveConsentAsGuardian` passes the signed-in user as `_parent_user` to `approve_parental_consent`, with the service role.
- That function then inserted, or re-activated, an active link for **any** adult who opened the link. It never compared the approver
  with `parent_email`.

The inviter and the child can produce both halves of either flow on their own.

## Design

### Redemption never creates authority

- `redeem_minor_invite` now only inserts a `guardian_link_requests` row:
  - `kind = 'first_guardian'` when the child has no verified guardian;
  - `kind = 'additional_guardian'` otherwise (R7's path).
- It returns a new column, `verification_required`.
- It records no parental consent. Consent is recorded when the link is activated (`method = 'manual_review'`), with the policy versions
  the guardian accepted.
- A pending claim is never a `guardian_links` row, even after a first review. As a result `is_guardian_of`, `has_guardian_link`, `minor_messaging_block`,
  `can_notify`, `guardian_children_overview` and every RLS policy that joins `guardian_links` on `status = 'active' AND verified_at IS
NOT NULL` ignore it without any change. Every guardian gate in the schema already filters on `status = 'active'`, and a claim is not a
  link. The tests check this for each guardian gate.

### Activation needs a party who is independent of the child and the inviter

There are two activation paths:

- **(a) Staff verification.** `staff_verify_guardian_claim(request, method, evidence_ref, acknowledge_signals)` requires:
  - the caller is a moderator, admin or superadmin, and is not one of the parties, the staff member who submitted the claim, or (after
    an appeal) the staff member who declined it;
  - a method from a fixed list (`government_id`, `consent_document`, `video_call`, `school_or_league_record`, `court_order`, `other`);
  - a **case reference**: 8 to 64 characters matching `^[A-Z]{2,10}-[0-9]{4,}(-[A-Z0-9]{1,20})?$` after upper-casing (`GV-20261104`,
    `ZD-48213-B`). Free text, links and e-mail addresses are refused. It is never the document itself.

  **Two-person rule.** It returns `activated` or `second_review_required`. A claim is suspicious
  (`private_sec.guardian_claim_suspicion`) when it has a relationship signal, the invitation's `child_name` does not plausibly match the
  redeemer's display name or username, the claimant has other pending or declined claims, the method is `other`, it was reopened on
  appeal, or it is an account recovery or a fraud-revocation restoration. For a suspicious claim the first call only records the first
  review (`first_review_by`, method, reference; audited as `claim_first_review`); a different staff member's call is the second review,
  and only that activates the link (`second_review_by`; the activation audit names both). A non-suspicious claim is activated by one
  verifier.

  It then re-checks that (and `guardian_activate`, which every activation path calls, checks the first three again):
  - the guardian is an eligible adult (adult cohort, not under age review, not suspended, not a managed account, no authority hold);
  - the child is still a minor;
  - neither has blocked the other;
  - the claimant has no relationship signals, unless the reviewer acknowledged them.

  The link stores `verified_by` and `verification_method`, and the audit stores the evidence reference.

- **A current verified guardian** can still approve a pending first- or additional-guardian request through
  `guardian_decide_link_request`. That person is independent of both the child and the claimant. The function now also re-checks the
  claimant's eligibility and blocks, and it goes through the same activation and audit code. Recovery and restoration requests are
  staff-only.

**(b) The consent email is not an independent channel, so it is not wired as an activation path.** The child chooses the address. A
stranger can tell the child to type the stranger's own address, receive the link and approve. Because of that:

- `approve_parental_consent` stays service-role only.
- It now refuses a missing or ineligible `_parent_user`.
- For an adult who is **already** the child's verified guardian, it approves consent as before.
- For anyone else, it:
  - clears the token, so the link is single use;
  - creates a pending claim with `source = 'consent_email'`;
  - leaves the consent `pending`;
  - logs `consent_guardian_claimed`;
  - never creates or re-activates a link.

### Self-created relationships

At redemption, the claim records **signals** when the claimant already has one of these with the child:

| Signal            | What it means                                                         |
| ----------------- | --------------------------------------------------------------------- |
| `shared_team`     | Teammates, the claimant owns a team the child is on, or a team invite |
| `shared_game`     | Host and participant, a join request, or co-participants in a game    |
| `contact_request` | A contact request in either direction                                 |
| `conversation`    | A conversation they are both in                                       |

`staff_verify_guardian_claim` and the staff queue compute the signals again, so a relationship built while the claim waits also counts.

Nothing auto-verifies. A claim with signals is refused (`SIGNALS_NOT_ACKNOWLEDGED`) unless the reviewer explicitly acknowledges them,
and the acknowledged signals are written to the activation's audit row.

We flag rather than refuse because a real parent often coaches their child's team or has messaged them. The test "parent-coach" case
shows that this parent can still be verified.

### Invitations

- Expiry is capped at 14 days from creation. `redeem_minor_invite` also enforces this for invitations created before this change.
- An adult may create at most 10 invitations per 24 hours. The existing cap of 20 open invitations stays.
- Each invitation is single use, looked up only by its SHA-256 token hash, and refused once revoked.
- `revoke_minor_invite` accepts the inviter or staff.
- After redemption, `withdraw_guardian_claim` lets the child (or the claimant) cancel the pending claim. The family-join page shows an
  "I don't know this person: cancel" button.
- Rate limits on redemption:
  - a child creates at most 3 requests in 24 hours and holds at most 2 pending first-guardian claims;
  - an adult holds at most 3 pending first-guardian claims across all children.

  A refused redemption does not use up the invitation.

- Invitations are **not bound to a child account**: the inviter knows only a first name. See open items.

### Forged approvals

- Clients have no INSERT or UPDATE grant on `guardian_link_requests`.
- On `guardian_links`, RLS has no write policy. Where the Supabase default grants include INSERT, the new BEFORE trigger refuses the
  write before RLS runs.
- Two triggers, `a0_protect_guardian_link_write_trg` and `a0_protect_guardian_link_request_write_trg`, refuse **any** write from a
  signed-in session unless a definer RPC set the transaction-local flag `app.guardian_link_write`. This is the pattern
  `protect_contact_request_approval` uses. It covers a future definer function that forgets the check.
- There are two narrow exceptions, both kept so existing flows keep working:
  - `provision_managed_child`: the guardian created this credential-less child moments ago. The trigger recognizes the case from
    `managed_accounts`, which only that function writes, and stamps `verification_method = 'managed_child_created'`.
  - `revoke_guardian_link`: a guardian may move their own active link to revoked, with every verification column unchanged.
- The service role, where `auth.uid()` is NULL, is not restricted. This matches the other guards.

### Appeals

- `file_guardian_claim_appeal(request, reason)`: the claimant or the child, one appeal per staff-declined claim, within 30 days, at
  most 3 per person in 30 days, reason of 20 to 1000 characters.
- `staff_decide_guardian_claim_appeal(appeal, uphold, reason)`: any staff member except the decliner and the parties. Upheld reopens
  the claim as pending, bars the decliner from reviewing it and marks it `reopened_on_appeal` (two reviewers). `staff_guardian_claim_appeals()`
  is the queue. Appeals live in `guardian_claim_appeals` (no client writes); filing and deciding are audited.

### Recovery

- `staff_revoke_guardian_link(link, reason, suspected_fraud default false)` works on an active or suspended link, withdraws that
  guardian's consent record, as `revoke_guardian_link` does, and revokes their open device pairings for that child. The audit records
  the guardian's age band, whether they were still eligible and whether fraud is suspected.
- `staff_restore_guardian_link(link, reason, evidence_ref)` checks again that:
  - the guardian is an eligible adult;
  - the child is still a minor;
  - neither has blocked the other.

  It then re-verifies the link (`verified_by`, `verification_method = 'staff_restoration'`) and records consent again where the child's
  age requires it. If the latest revocation was for suspected fraud, the first call records a first review in a `link_restoration`
  request and returns `second_review_required`; a different staff member's call restores it.

- **Lost access:** `staff_open_guardian_recovery(old link, new account, reason)` opens an `account_recovery` claim for a new account
  that is an eligible adult with a confirmed e-mail. It is always suspicious and the submitter cannot review it, so two other staff
  members verify it; the activation revokes the old account's link.
- **Compromised account:** `staff_suspend_guardian_authority(guardian, reason)` (one staff member, immediate) opens a
  `guardian_authority_holds` row, sets every active link to `suspended` and revokes open device pairings; `guardian_eligible` is false
  while the hold is open. `staff_lift_guardian_suspension(guardian, reinstate, reason, evidence_ref)` must be a different staff member:
  reinstate re-verifies each suspended link; revoke ends them as suspected fraud.
- Staff cannot act on a link or claim they are a party to.

### Managed children

`has_guardian_link` no longer counts a `managed_accounts` row by itself: only an active, verified link counts. `provision_managed_child`
always writes an active, verified link, so nothing changes for a managed child whose guardian is in good standing; after a staff
revocation or suspension the child has no guardian link. `notify_guardians_of` and `create_device_pairing` follow the same rule, and the
app's `startManagedSession` and `deleteManagedChild` also require the active link. What remains for the revoked guardian: the
`managed_accounts` row (readable by them, and still blocking deletion of the guardian's own account because of `ON DELETE RESTRICT`);
no access, notification, pairing, session or deletion right.

### Audit

`public.guardian_link_audit` works as follows:

- It is append-only: UPDATE, DELETE and TRUNCATE raise for everyone. Clients have SELECT only, and only triggers insert rows.
- Staff, the child and the guardian or claimant of each row can read it.
- AFTER triggers on `guardian_links` (insert, status or verification change, delete) and on `guardian_link_requests` (insert, status
  change) write the rows. So every path is audited, including:
  - a guardian's own `revoke_guardian_link`;
  - managed-child provisioning;
  - service-role maintenance.
- The RPCs pass the actor's role, the method, the evidence reference, the reason and the signals in a transaction-local context.
- Actions recorded: `claim_created`, `claim_first_review`, `claim_approved`, `claim_declined`, `claim_withdrawn`, `claim_reopened`,
  `appeal_filed`, `appeal_upheld`, `appeal_rejected`, `link_activated`, `link_revoked`, `link_restored`, `link_suspended`,
  `link_reinstated`, `link_reverified`, `link_deleted`, `guardian_authority_suspended`, `guardian_authority_hold_lifted` (the last two
  have no child: `child_user_id` is NULL).

The existing `family_audit_log` trigger is unchanged.

## Threat model

| Attack                                                                   | Result                                                                                                                                                           |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stranger invites an unlinked teen; the teen clicks                       | Pending claim. No authority. Staff must verify identity.                                                                                                         |
| A coach, host, contact or chat partner does the same                     | The claim is also flagged. Verifying it needs the reviewer's explicit acknowledgement.                                                                           |
| Stranger asks the child to type the stranger's email in the consent form | The click creates only a pending claim. Consent stays pending. The child stays locked if under 13.                                                               |
| Child or inviter writes `status` or `verified_*` directly                | Refused by the missing grant, RLS or the protect trigger.                                                                                                        |
| Leaked link opened by another child                                      | Pending claim only. Staff see the invitation's child name beside the redeemer's; a mismatch needs two reviewers. The child can withdraw it. The link is used up. |
| Old, revoked or used link                                                | Refused. Expired after at most 14 days.                                                                                                                          |
| One adult mass-claims children                                           | At most 3 pending first-guardian claims and 10 invitations a day.                                                                                                |
| Compromised moderator account                                            | Can verify only a non-suspicious claim alone. Cannot verify their own. Suspicious claims need a second person. Weekly audit review of staff activations.         |
| Compromised guardian account                                             | One staff member suspends all its links at once; a different staff member lifts the hold.                                                                        |
| Suspended or re-aged guardian restored                                   | Refused: eligibility is checked again at restore and at verification.                                                                                            |

## Compatibility and user-visible changes

- **Existing links are untouched.** There is no backfill. Existing rows keep `verified_by` and `verification_method` NULL. The test
  snapshots every link and checks that each one is unchanged.
- A child accepting a first-guardian invitation sees "Waiting for verification" and can cancel. The inviter gets a notification that
  verification comes next.
- An under-13 account linked by invitation or consent email now **stays locked until staff verify the guardian**. Before, it unlocked on
  the click. This is the main behaviour change, and support needs a staffed queue: Admin → Child safety → Guardian verification.
- A guardian approving consent from the email link sees "BallaCity verifies every new parent or guardian" unless they are already the
  verified guardian.
- Managed children, created by a guardian in the app, link at once as before.
- The R7 second-guardian flow is unchanged. Guardians see only requests about their own children: the guardian page now filters by
  child, because staff can read the whole queue.
- `redeem_minor_invite` gains the `verification_required` column. The function is dropped and re-created, and its grants are restored.
- Staff RPCs: `staff_guardian_claims` (now with `invite_child_name`, `name_match`, `suspicion`, `review_stage`, the first review and
  `can_review`), `staff_verify_guardian_claim` (now returns `activated` or `second_review_required`), `staff_decline_guardian_claim`,
  `staff_revoke_guardian_link` (new optional `suspected_fraud`), `staff_restore_guardian_link` (now returns `restored` or
  `second_review_required`), `staff_guardian_claim_appeals`, `staff_decide_guardian_claim_appeal`, `staff_open_guardian_recovery`,
  `staff_suspend_guardian_authority`, `staff_lift_guardian_suspension`. Child or claimant RPCs: `withdraw_guardian_claim`,
  `file_guardian_claim_appeal`.
- `guardian_links.status` gains `suspended`. Every guardian gate requires `active`, so a suspended link grants nothing.

## Open items

1. **Staffing and service level.** Proposed targets (first response 24h, decision 72h) and a staffing estimate are in the operations
   document; the owner needs to confirm them and name the rota. At least two trained staff must be on duty, because one person cannot
   complete a suspicious claim.
2. **No independent automated channel yet.** A real second factor would be a channel neither the child nor the inviter controls, such as
   a third-party identity or VPC provider, or a card micro-charge. `approve_parental_consent` already accepts `third_party_verified` as
   a method, but nothing calls it that way. Wiring a provider would add a second activation path inside `guardian_activate`.
3. **Binding an invitation to a child.** The inviter does not know the child's account id. An optional "child's username" field could
   bind an invitation to one account. Until then: rate limits, a 14-day expiry, single use, child withdrawal, the child_name comparison
   (a mismatch needs two reviewers) and staff review.
4. **Staff misuse.** Suspicious claims are dual-controlled; a non-suspicious claim is still activated by one verifier. Mitigation: the
   weekly audit review samples single-review activations. Consider alerting the superadmin on every staff activation.
5. **Evidence reference contents.** The reference is free text that the parties can read in the audit. Staff guidance says "a case
   reference, never the document". Consider hiding `evidence_ref` from the parties if policy prefers that.
6. **Revocation by staff does not check age.** Revocation is always allowed, because removing authority is safe. The audit records the
   guardian's age band and eligibility. Restoration does check.
7. **Release manifest.** `docs/release/release-manifest.json` does not list `20261108100000` yet. Regenerate it with
   `scripts/release-preflight.mjs --write-manifest` at integration.
8. **Revoking a managed child's guardian.** Fixed: `has_guardian_link` follows the link, not `managed_accounts` (see "Managed
   children"). A managed child left with no guardian cannot sign in; staff link a verified guardian through recovery or delete the
   account.
9. **Appeal and recovery UI.** The appeal, recovery and suspension functions exist and are tested, but only the verification queue has
   a screen. Filing an appeal (family-join page, Parent Center) and the staff appeal, recovery and suspension screens are still to build.
10. **Name matching** compares the invitation's free-text first name with a child's chosen display name and username, so legitimate
    nicknames will often route claims to two reviewers. Watch the `name_mismatch` share (operations metrics).
