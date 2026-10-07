import { createFileRoute } from "@tanstack/react-router";

/**
 * Releases approved-but-unpaid spots whose payment hold has run out, across
 * every game. Called by a scheduler (pg_cron already runs the same sweep where
 * it is installed; this is for any external scheduler) with the shared worker
 * secret. The rules live in `release_expired_payment_holds()` — this route
 * only triggers it.
 */
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const Route = createFileRoute("/api/public/payments/release-holds")({
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
        const { data, error } = await supabaseAdmin.rpc("release_expired_payment_holds", {});
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true, released: typeof data === "number" ? data : 0 });
      },
    },
  },
});
