import { createFileRoute } from "@tanstack/react-router";
import { authorizeWorker } from "@/lib/worker-auth.server";

/**
 * P2-7: sends every player's due game reminders, so they arrive while the app is closed.
 * Called by pg_cron every 5 minutes with the shared worker secret. Safe to run alongside the
 * app's own flush: each reminder is claimed before it is written.
 *
 * The same run also pushes the invite notifications of the last hour (WP 5.4) and prompts hosts
 * to mark attendance (WP 5.6). runScheduledSweeps runs the three jobs one after another under one
 * time budget, each claiming its rows before it sends; one failing does not stop the others, and
 * the run reports 500 if any failed.
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
        const { runScheduledSweeps } = await import("@/lib/game-reminders.server");
        const { reminders, invitePushes, attendancePrompts, errors } = await runScheduledSweeps(
          supabaseAdmin as never,
        );
        return json(
          {
            ok: errors.length === 0,
            ...reminders,
            invitePushes,
            attendancePrompts,
            ...(errors.length ? { error: errors.join("; ") } : {}),
          },
          errors.length ? 500 : 200,
        );
      },
    },
  },
});
