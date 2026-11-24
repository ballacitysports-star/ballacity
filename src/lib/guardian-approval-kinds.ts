import { z } from "zod";

/**
 * What a guardian approval notice can be about (notifyGuardiansOfPending, guardian-push.server): a child's pending join
 * request, a team invite for the child, or a game invitation the child accepted that is held for the guardian. One list
 * for the client's ping, the server function's input and the server's plan, so a kind cannot be sent by one and refused
 * by another. Kept apart from the server function so it can be tested without the server runtime.
 */
export const PENDING_APPROVAL_KINDS = ["join_request", "team_invite", "invite_accept"] as const;

export type PendingApprovalKind = (typeof PENDING_APPROVAL_KINDS)[number];

const notifyGuardiansInput = z.object({
  kind: z.enum(PENDING_APPROVAL_KINDS),
  id: z.string().min(1).max(64),
});

/** The server function's input check: throws on an unknown kind or a bad id. */
export function parseNotifyGuardiansInput(input: { kind: string; id: string }): {
  kind: PendingApprovalKind;
  id: string;
} {
  return notifyGuardiansInput.parse(input);
}
