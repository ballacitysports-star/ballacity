import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Tell a child's guardians that a join request or team invite for their child
 * is waiting for approval. Best effort: it never fails the caller's own action.
 *
 * The caller names the request or invite; the server checks they made it and
 * works out the rest (see guardian-push.server).
 */
export const notifyGuardiansOfPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: string; id: string }) =>
    z
      .object({
        kind: z.enum(["join_request", "team_invite"]),
        id: z.string().min(1).max(64),
      })
      .parse(input),
  )
  // The answer is the same whatever happened: how many guardians were told would tell a manager
  // whether the invitee is a minor, or that the invitation was suppressed by a block (SEC-7).
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { planGuardianApprovalPush, sendGuardianApprovalPush } =
        await import("@/lib/guardian-push.server");
      const { deliverPush } = await import("@/lib/push.server");
      const admin = supabaseAdmin as never;
      const plan = await planGuardianApprovalPush(admin, {
        kind: data.kind,
        id: data.id,
        callerId: context.userId,
      });
      if (plan.messages.length === 0) return { ok: true as const };
      await sendGuardianApprovalPush(admin, plan, {
        push: (m) => deliverPush({ userId: m.userId, title: m.title, body: m.body, url: m.url }),
      });
      return { ok: true as const };
    } catch (e) {
      console.warn("[guardian-push] failed", e);
      return { ok: true as const };
    }
  });

/** Fire-and-forget wrapper for client code: never throws, never awaited by the caller's flow. */
export function pingGuardians(kind: "join_request" | "team_invite", id: unknown) {
  if (typeof id !== "string" || !id) return;
  void notifyGuardiansOfPending({ data: { kind, id } }).catch(() => {});
}
