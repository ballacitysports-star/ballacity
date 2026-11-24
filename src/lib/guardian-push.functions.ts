import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { parseNotifyGuardiansInput, type PendingApprovalKind } from "@/lib/guardian-approval-kinds";

/**
 * Tell a child's guardians that a join request or team invite for their child
 * is waiting for approval, or that an invitation the child accepted is held for
 * them (invite_accept). Best effort: it never fails the caller's own action.
 *
 * The caller names the request or invite; the server checks they made it and
 * works out the rest (see guardian-push.server).
 */
export const notifyGuardiansOfPending = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { kind: string; id: string }) => parseNotifyGuardiansInput(input))
  .handler(async ({ data, context }): Promise<{ notified: number }> => {
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
      if (plan.messages.length === 0) return { notified: 0 };
      const notified = await sendGuardianApprovalPush(admin, plan, {
        push: (m) => deliverPush({ userId: m.userId, title: m.title, body: m.body, url: m.url }),
      });
      return { notified };
    } catch (e) {
      console.warn("[guardian-push] failed", e);
      return { notified: 0 };
    }
  });

/** Fire-and-forget wrapper for client code: never throws, never awaited by the caller's flow. */
export function pingGuardians(kind: PendingApprovalKind, id: unknown) {
  if (typeof id !== "string" || !id) return;
  void notifyGuardiansOfPending({ data: { kind, id } }).catch(() => {});
}
