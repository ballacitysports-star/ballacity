/**
 * The guardian columns of a manager's invite tracker, from facts the manager is allowed to know.
 *
 * A manager may invite any user id, so the tracker must not tell the manager whether the invitee is a minor with a guardian
 * (SEC-7 item 5: a blocked user, an adult and a minor look identical to the inviter). The only guardian fact disclosed to the
 * team is a guardian's approval of this invite (`guardian_approved_at`); `guardian_links` is never read for invitees.
 */
export function inviteGuardianColumns(invite: { guardian_approved_at: string | null }): {
  needsGuardian: boolean;
  guardianApproved: boolean;
} {
  const approved = !!invite.guardian_approved_at;
  return { needsGuardian: approved, guardianApproved: approved };
}
