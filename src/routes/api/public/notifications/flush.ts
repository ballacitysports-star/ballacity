import { createFileRoute } from "@tanstack/react-router";

/**
 * Flushes push notifications that were held back by the minor notification
 * curfew once the recipient's quiet window has ended.
 *
 * Called by a scheduler (pg_cron or any external scheduler) with the shared
 * worker secret. Nothing here decides policy — the queue rows already carry
 * the delivery time computed by `notificationCurfewDecision()`.
 */
const ONESIGNAL_APP_ID = "c6024ea7-b1a2-4f64-b43a-783971d802f9";
const ONESIGNAL_API = "https://api.onesignal.com/notifications";
const BATCH = 50;
const MAX_ATTEMPTS = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/notifications/flush")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.REELS_WORKER_SECRET;
        if (!secret) return json({ error: "worker secret not configured" }, 503);
        const provided =
          request.headers.get("x-worker-secret") ??
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
          "";
        if (provided !== secret) return json({ error: "Unauthorized" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: rows, error } = await supabaseAdmin
          .from("scheduled_notifications" as any)
          .select("id, user_id, title, body, url, attempts")
          .eq("status", "queued")
          .lte("deliver_after", new Date().toISOString())
          .order("deliver_after", { ascending: true })
          .limit(BATCH);
        if (error) return json({ error: error.message }, 500);

        const restKey = process.env.ONESIGNAL_REST_API_KEY;
        let sent = 0;
        let failed = 0;

        for (const row of (rows ?? []) as any[]) {
          if (!restKey) {
            await supabaseAdmin
              .from("scheduled_notifications" as any)
              .update({ status: "failed", last_error: "not_configured" } as any)
              .eq("id", row.id);
            failed += 1;
            continue;
          }
          try {
            const res = await fetch(ONESIGNAL_API, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Key ${restKey}`,
              },
              body: JSON.stringify({
                app_id: ONESIGNAL_APP_ID,
                target_channel: "push",
                include_aliases: { external_id: [row.user_id] },
                headings: { en: row.title },
                contents: { en: row.body ?? "" },
                ...(row.url ? { url: row.url } : {}),
              }),
            });
            const ok = res.ok;
            const attempts = (row.attempts ?? 0) + 1;
            await supabaseAdmin
              .from("scheduled_notifications" as any)
              .update({
                status: ok ? "sent" : attempts >= MAX_ATTEMPTS ? "failed" : "queued",
                attempts,
                sent_at: ok ? new Date().toISOString() : null,
                last_error: ok ? null : `http_${res.status}`,
              } as any)
              .eq("id", row.id);
            await supabaseAdmin.from("notification_delivery_log" as any).insert({
              user_id: row.user_id,
              channel: "push",
              status: ok ? "sent" : "failed",
              provider: "onesignal",
              error: ok ? null : `http_${res.status}`,
              detail: { queued: true } as any,
            } as any);
            ok ? (sent += 1) : (failed += 1);
          } catch (e) {
            failed += 1;
            const attempts = (row.attempts ?? 0) + 1;
            await supabaseAdmin
              .from("scheduled_notifications" as any)
              .update({
                status: attempts >= MAX_ATTEMPTS ? "failed" : "queued",
                attempts,
                last_error: String(e).slice(0, 300),
              } as any)
              .eq("id", row.id);
          }
        }

        return json({ ok: true, processed: (rows ?? []).length, sent, failed });
      },
    },
  },
});
