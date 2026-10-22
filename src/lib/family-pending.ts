/**
 * How much is waiting on a parent, for the badge on the Me tab and the Family
 * card. Three different things can: a team invite for a child, a request to join
 * a game, and a child whose account is limited until the parent acts (no
 * consent yet, or consent withdrawn). Pure, so the number can be tested.
 */
export type FamilyPending = {
  invites: number;
  requests: number;
  /** Children whose account is limited until the guardian does something. */
  waitingChildren: number;
  total: number;
};

export function familyPending(input: {
  invites: readonly unknown[];
  requests: readonly unknown[];
  waitingChildren: number;
}): FamilyPending {
  const invites = input.invites.length;
  const requests = input.requests.length;
  const waitingChildren = Math.max(0, input.waitingChildren);
  return { invites, requests, waitingChildren, total: invites + requests + waitingChildren };
}

/** "2 requests and 1 invite", in the words a parent would use; empty when nothing waits. */
export function describePending(p: FamilyPending): string {
  const parts: string[] = [];
  if (p.waitingChildren > 0) {
    parts.push(
      p.waitingChildren === 1
        ? "1 child needs your approval"
        : `${p.waitingChildren} children need your approval`,
    );
  }
  if (p.requests > 0) parts.push(`${p.requests} game ${p.requests === 1 ? "request" : "requests"}`);
  if (p.invites > 0) parts.push(`${p.invites} team ${p.invites === 1 ? "invite" : "invites"}`);
  return parts.join(" · ");
}
