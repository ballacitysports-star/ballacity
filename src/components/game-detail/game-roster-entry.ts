import type { JoinRequest } from "@/lib/payments";

/** One slot in the game page's player list: a confirmed player, the viewer's own pending
 * request, or (for the host) someone else's pending request. */
export type RosterEntry =
  | {
      kind: "player";
      initials: string;
      isMe: boolean;
      pending: false;
      userId?: string;
      displayName?: string;
      avatarUrl?: string | null;
    }
  | { kind: "viewerPending"; initials: "YOU"; isMe: true; pending: true }
  | { kind: "hostPending"; req: JoinRequest; pending: true };
