import { createFileRoute } from "@tanstack/react-router";
import { authorizeWorker } from "@/lib/worker-auth.server";

/**
 * Flushes push notifications that were held back by the minor notification
 * curfew once the recipient's quiet window has ended.
 *
 * Called by a scheduler (pg_cron or any external scheduler) with the shared
 * worker secret. The work is in `notification-flush.server`, which claims each
 * row, checks the guardian's settings again, and retries with backoff. The
 * response is a count summary, including how many rows are overdue.
 */
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
        if ((await authorizeWorker(request)) !== "ok") return json({ error: "Unauthorized" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { curfewGateFor } = await import("@/lib/push-curfew.server");
        const { flushQueue } = await import("@/lib/notification-flush.server");
        const { ONESIGNAL_APP_ID, ONESIGNAL_API, absolutizeUrl } =
          await import("@/lib/push.server");

        const restKey = process.env.ONESIGNAL_REST_API_KEY;
        try {
          const summary = await flushQueue({
            admin: supabaseAdmin as never,
            configured: !!restKey,
            gateFor: (userId, now) => curfewGateFor(supabaseAdmin as never, userId, now),
            send: async (row) => {
              const res = await fetch(ONESIGNAL_API, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Key ${restKey}` },
                body: JSON.stringify({
                  app_id: ONESIGNAL_APP_ID,
                  target_channel: "push",
                  include_aliases: { external_id: [row.user_id] },
                  headings: { en: row.title },
                  contents: { en: row.body ?? "" },
                  url: await absolutizeUrl(row.url),
                }),
              });
              if (!res.ok) return { ok: false, error: `http_${res.status}` };
              let recipients: number | null = null;
              try {
                const parsed = JSON.parse(await res.text());
                if (typeof parsed?.recipients === "number") recipients = parsed.recipients;
              } catch {
                /* a 200 with no readable body still counts as sent */
              }
              return { ok: true, recipients };
            },
          });
          return json({ ok: true, ...summary });
        } catch (e) {
          return json({ error: e instanceof Error ? e.message : "flush failed" }, 500);
        }
      },
    },
  },
});
