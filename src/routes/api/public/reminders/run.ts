import { createFileRoute } from "@tanstack/react-router";
import { authorizeWorker } from "@/lib/worker-auth.server";

/**
 * P2-7: sends every player's due game reminders, so they arrive while the app is closed.
 * Called by pg_cron every 5 minutes with the shared worker secret. Safe to run alongside the
 * app's own flush: each reminder is claimed before it is written.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/reminders/run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if ((await authorizeWorker(request)) !== "ok") return json({ error: "Unauthorized" }, 401);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { sendDueGameReminders } = await import("@/lib/game-reminders.server");
        try {
          const summary = await sendDueGameReminders(supabaseAdmin as never);
          return json({ ok: true, ...summary });
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
        }
      },
    },
  },
});
