import { createFileRoute } from "@tanstack/react-router";
import { authorizeWorker } from "@/lib/worker-auth.server";

/**
 * P3-6a: expires data exports whose 24 hours have passed and deletes their files from the private `data-exports`
 * bucket. Called daily by pg_cron (job `expire-data-exports`, migration 20261205110000) with the shared worker secret.
 * The rules live in the database (`expire_stale_data_exports`, `data_export_files_due`, `clear_data_export_files`) and
 * the run in `data-export-expiry.server`. The answer is counts only; a failed stage answers 500 and the next run tries
 * again.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/data-exports/expire")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if ((await authorizeWorker(request)) !== "ok") return json({ error: "Unauthorized" }, 401);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { expireDataExports } = await import("@/lib/data-export-expiry.server");
        const summary = await expireDataExports(supabaseAdmin as never);
        return json(summary, summary.ok ? 200 : 500);
      },
    },
  },
});
