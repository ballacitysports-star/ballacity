# SEC-4: first-guardian verification (Approval B)

Migration: `supabase/migrations/20261108100000_first_guardian_verification.sql`
Tests: `supabase/tests/500_first_guardian_verification.test.sql` (160 assertions); `460` updated for the new first-guardian behaviour.
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
- A pending claim is never a `guardian_links` row. As a result `is_guardian_of`, `has_guardian_link`, `minor_messaging_block`,
  `can_notify`, `guardian_children_overview` and every RLS policy that joins `guardian_links` on `status = 'active' AND verified_at IS
NOT NULL` ignore it without any change. Every guardian gate in the schema already filters on `status = 'active'`, and a claim is not a
  link. The tests check this for each guardian gate.

### Activation needs a party who is independent of the child and the inviter

There are two activation paths:

- **(a) Staff verification.** `staff_verify_guardian_claim(request, method, evidence_ref, acknowledge_signals)` requires:
  - the caller is a moderator, admin or superadmin, and is not one of the parties;
  - a method from a fixed list (`government_id`, `consent_document`, `video_call`, `school_or_league_record`, `court_order`, `other`);
  - an evidence **reference** of 4 to 200 characters, such as a case or ticket number. It is never the document itself.

  It then re-checks that:
  - the guardian is an eligible adult (adult cohort, not under age review, not suspended, not a managed account);
  - the child is still a minor;
  - neither has blocked the other;
  - the claimant has no relationship signals, unless the reviewer acknowledged them.

  The link stores `verified_by` and `verification_method`, and the audit stores the evidence reference.

- **A current verified guardian** can still approve a pending request through `guardian_decide_link_request`. That person is
  independent of both the child and the claimant. The function now also re-checks the claimant's eligibility and blocks, and it goes
  through the same activation and audit code.

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

### Recovery

- `staff_revoke_guardian_link(link, reason)` withdraws that guardian's consent record, as `revoke_guardian_link` does. The audit
  records the guardian's age band and whether they were still eligible.
- `staff_restore_guardian_link(link, reason, evidence_ref)` checks again that:
  - the guardian is an eligible adult;
  - the child is still a minor;
  - neither has blocked the other.

  It then re-verifies the link (`verified_by`, `verification_method = 'staff_restoration'`) and records consent again where the child's
  age requires it.

- Staff cannot act on a link or claim they are a party to.

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
- Actions recorded: `claim_created`, `claim_approved`, `claim_declined`, `claim_withdrawn`, `link_activated`, `link_revoked`,
  `link_restored`, `link_reverified`, `link_deleted`.

The existing `family_audit_log` trigger is unchanged.

## Threat model

| Attack                                                                   | Result                                                                                                                                                               |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stranger invites an unlinked teen; the teen clicks                       | Pending claim. No authority. Staff must verify identity.                                                                                                             |
| A coach, host, contact or chat partner does the same                     | The claim is also flagged. Verifying it needs the reviewer's explicit acknowledgement.                                                                               |
| Stranger asks the child to type the stranger's email in the consent form | The click creates only a pending claim. Consent stays pending. The child stays locked if under 13.                                                                   |
| Child or inviter writes `status` or `verified_*` directly                | Refused by the missing grant, RLS or the protect trigger.                                                                                                            |
| Leaked link opened by another child                                      | Pending claim only. The child can withdraw it, and staff verification catches it. The link is then used up.                                                          |
| Old, revoked or used link                                                | Refused. Expired after at most 14 days.                                                                                                                              |
| One adult mass-claims children                                           | At most 3 pending first-guardian claims and 10 invitations a day.                                                                                                    |
| Compromised moderator account                                            | Can verify a claim. Cannot verify their own. Every activation names them in the audit, which the parties can read. Mitigation: review staff activations (open item). |
| Suspended or re-aged guardian restored                                   | Refused: eligibility is checked again at restore and at verification.                                                                                                |

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
- Staff RPCs: `staff_guardian_claims`, `staff_verify_guardian_claim`, `staff_decline_guardian_claim`, `staff_revoke_guardian_link`,
  `staff_restore_guardian_link`. Child or claimant RPC: `withdraw_guardian_claim`.

## Open items

1. **Staffing and service level.** First guardians now wait for a human. The owner needs to decide on a target response time and on who
   staffs the queue. Staff should be told how to contact the claimant: the queue shows the guardian's email.
2. **No independent automated channel yet.** A real second factor would be a channel neither the child nor the inviter controls, such as
   a third-party identity or VPC provider, or a card micro-charge. `approve_parental_consent` already accepts `third_party_verified` as
   a method, but nothing calls it that way. Wiring a provider would add a second activation path inside `guardian_activate`.
3. **Binding an invitation to a child.** The inviter does not know the child's account id. An optional "child's username" field could
   bind an invitation to one account. Until then: rate limits, a 14-day expiry, single use, child withdrawal and staff review.
4. **Staff misuse.** Activations are attributable but not dual-controlled. Consider requiring a second reviewer for claims with
   signals, or alerting the superadmin on every staff activation.
5. **Evidence reference contents.** The reference is free text that the parties can read in the audit. Staff guidance says "a case
   reference, never the document". Consider hiding `evidence_ref` from the parties if policy prefers that.
6. **Revocation by staff does not check age.** Revocation is always allowed, because removing authority is safe. The audit records the
   guardian's age band and eligibility. Restoration does check.
7. **Release manifest.** `docs/release/release-manifest.json` does not list `20261108100000` yet. Regenerate it with
   `scripts/release-preflight.mjs --write-manifest` at integration.
8. **Revoking a managed child's guardian.** `staff_revoke_guardian_link` works on a managed child's guardian too, but the
   `managed_accounts` row remains, so `has_guardian_link` stays true for that child. Account deletion remains the supported way out for
   managed children.
