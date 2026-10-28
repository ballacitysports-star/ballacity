/**
 * Who a minor's request to join a game is waiting on. The database needs both
 * the host and a guardian to say yes, in either order, and until both have the
 * minor is not on the roster. The page used to show only the host's side.
 */
export type JoinWait = {
  /** A guardian still has to approve. */
  onParent: boolean;
  /** The host still has to approve. */
  onHost: boolean;
};

export function joinWait(input: {
  hostStatus: "pending" | "approved" | "rejected";
  needsGuardian: boolean;
  guardianApproved: boolean;
}): JoinWait | null {
  if (input.hostStatus === "rejected") return null;
  const onParent = input.needsGuardian && !input.guardianApproved;
  const onHost = input.hostStatus === "pending";
  if (!onParent) return null; // nothing special: the usual host-only wording applies
  return { onParent, onHost };
}

/** The minor's own banner. */
export function playerWaitCopy(w: JoinWait): { title: string; body: string } {
  if (w.onHost) {
    return {
      title: "Waiting for your parent and the host",
      body: "Both have to say yes before you're in. Your parent can approve this in their Parent Center, and we've let them know.",
    };
  }
  return {
    title: "The host said yes · waiting for your parent",
    body: "You're not on the roster until your parent approves. They can do it in their Parent Center, and we've let them know.",
  };
}

/** What the host sees on a minor's request. */
export function hostBadge(input: {
  needsGuardian: boolean;
  guardianApproved: boolean;
}): { label: string; tone: "warn" | "ok" } | null {
  if (!input.needsGuardian) return null;
  return input.guardianApproved
    ? { label: "Parent approved", tone: "ok" }
    : { label: "Needs parent OK", tone: "warn" };
}

/** Under the Approve button: what approving does for a minor. */
export const HOST_APPROVE_NOTE =
  "Your approval is recorded, but the spot is held until their parent approves too.";
