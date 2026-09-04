import { createFileRoute } from "@tanstack/react-router";
import {
  BATCH_SIZE,
  MAX_ATTEMPTS,
  REEL_WORK_COLUMNS,
  STUCK_AFTER_MS,
  processReel,
  type Reel,
} from "@/lib/reels-pipeline.server";

export const Route = createFileRoute("/api/public/reels/process")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Restrict this expensive endpoint to callers that present the shared
        // worker secret. Prevents anonymous internet visitors from burning
        // Lovable AI credits by hammering the URL.
        const workerSecret = process.env.REELS_WORKER_SECRET;
        if (workerSecret) {
          const provided =
            request.headers.get("x-worker-secret") ??
            request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
            "";
          if (provided !== workerSecret) {
            return new Response(JSON.stringify({ error: "Unauthorized" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          }
        } else {
          // Fail closed when the secret hasn't been configured yet.
          return new Response(
            JSON.stringify({ error: "REELS_WORKER_SECRET not configured" }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          );
        }

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "Missing LOVABLE_API_KEY" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
        const { data: reels, error } = await supabaseAdmin
          .from("highlight_reels")
          .select(REEL_WORK_COLUMNS)
          .eq("status", "processing")
          .lt("attempts", MAX_ATTEMPTS)
          .or(`processing_started_at.is.null,processing_started_at.lt.${stuckBefore}`)
          .order("created_at", { ascending: true })
          .limit(BATCH_SIZE);

        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        const results = [];
        let skipped = 0;
        for (const r of (reels ?? []) as unknown as Reel[]) {
          // Guardian control + own privacy preference are authoritative for AI
          // analysis. The worker runs with the service role, so it must ask the
          // database explicitly — RLS does not gate it.
          const { data: allowed, error: gateErr } = await supabaseAdmin.rpc("ai_analysis_allowed", {
            _user: r.user_id,
          });
          if (gateErr || allowed !== true) {
            skipped += 1;
            await supabaseAdmin
              .from("highlight_reels")
              .update({
                status: "failed",
                error_message:
                  "AI analysis is turned off for this account (check Settings → Privacy, or ask your parent/guardian).",
              })
              .eq("id", r.id);
            continue;
          }
          results.push(await processReel(r, supabaseAdmin, apiKey));
        }

        return new Response(JSON.stringify({ processed: results.length, skipped, results }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  },
});
