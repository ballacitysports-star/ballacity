import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { notifyRequestSchema } from "@/lib/notification-requests";

/** How many pushes one request sends at a time (a roster or a group thread). */
const PUSH_CONCURRENCY = 8;

/**
 * The one way a signed-in app tells another member something.
 *
 * The app names an allow-listed type and the row it is about (notification-requests.ts); it never sends a title, body
 * or link. The server checks the caller's role on that row, picks the recipients the row allows, writes the text and
 * an in-app link from the stored rows (notification-plan.server.ts), writes the notification rows, and sends the push
 * for each, subject to the recipient's push preferences and the minor-safety curfew in deliverPush.
 *
 * This replaced a version that took any type, title, body and link for anyone can_notify said the caller knew,
 * including anyone they had sent one availability contact request.
 */
export const createNotificationForUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => notifyRequestSchema.parse(d))
  .handler(async ({ data, context }): Promise<{ ok: true; sent: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { planNotification, dropRecentRepeats, pushAllowed } =
      await import("@/lib/notification-plan.server");
    const admin = supabaseAdmin as never;

    const plan = await planNotification(admin, context.userId, data);
    if (!plan.ok) throw new Error("Not authorized to notify this user");
    const rows = await dropRecentRepeats(admin, plan.rows);
    if (rows.length === 0) return { ok: true, sent: 0 };

    const { data: inserted, error } = await supabaseAdmin
      .from("notifications")
      .insert(rows)
      .select("id");
    if (error) throw new Error(error.message);
    const ids = ((inserted ?? []) as { id: string }[]).map((r) => r.id);

    // Best effort: the in-app rows are written; a push that fails or is held never fails the request.
    try {
      const wanted = await pushAllowed(admin, rows);
      const { deliverPush, absolutizeUrl } = await import("@/lib/push.server");
      const jobs = rows.map((r, i) => ({ r, id: ids[i] ?? null })).filter(({ r }) => wanted.has(r));
      for (let i = 0; i < jobs.length; i += PUSH_CONCURRENCY) {
        await Promise.allSettled(
          jobs.slice(i, i + PUSH_CONCURRENCY).map(async ({ r, id }) =>
            deliverPush({
              userId: r.user_id,
              title: r.title,
              body: r.body,
              url: (await absolutizeUrl(r.link)) ?? null,
              notificationId: id,
            }),
          ),
        );
      }
    } catch (e) {
      console.warn("[notify] push failed", e);
    }
    return { ok: true, sent: rows.length };
  });
