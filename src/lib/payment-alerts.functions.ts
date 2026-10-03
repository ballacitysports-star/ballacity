import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Emails the host after the signed-in player submits payment proof.
 * The host and submission are read from the caller's own latest pending
 * submission, so the browser can't pick an arbitrary recipient.
 */
export const emailHostPaymentSubmitted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ gameId: z.string().min(1).max(200) }).parse(i))
  .handler(async ({ data, context }) => {
    const { data: sub } = await context.supabase
      .from("payment_submissions")
      .select("id, host_id, payment_type, paid_amount, status")
      .eq("game_id", data.gameId)
      .eq("player_id", context.userId)
      .order("submitted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!sub || sub.status !== "pending" || sub.host_id === context.userId) {
      return { sent: false as const };
    }
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: hostUser }, { data: game }, { data: prof }] = await Promise.all([
        supabaseAdmin.auth.admin.getUserById(sub.host_id),
        supabaseAdmin.from("hosted_games").select("title").eq("id", data.gameId).maybeSingle(),
        supabaseAdmin.from("profiles").select("display_name, username").eq("id", context.userId).maybeSingle(),
      ]);
      const email = hostUser?.user?.email;
      if (!email) return { sent: false as const };
      const { paymentTypeMeta } = await import("@/lib/payments");
      const amount =
        sub.paid_amount != null ? `$${Number(sub.paid_amount).toFixed(2).replace(/\.00$/, "")}` : undefined;
      const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
      const res = await sendTemplateEmail("payment-submitted", email, {
        templateData: {
          playerName: (prof as any)?.display_name ?? (prof as any)?.username ?? undefined,
          gameTitle: (game as any)?.title ?? undefined,
          amount,
          method: sub.payment_type ? paymentTypeMeta(sub.payment_type).name : undefined,
          reviewUrl: `https://ballacity.com/games/${encodeURIComponent(data.gameId)}`,
        },
        idempotencyKey: `payment-submitted-${sub.id}`,
      });
      return { sent: !!res.sent };
    } catch (e) {
      console.error("[payment-alert] email failed", e);
      return { sent: false as const };
    }
  });
