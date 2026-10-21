// Server-only: shared auth for scheduler-called endpoints (reels, notification
// flush, spot-hold release). A request is authorized when its worker secret
// matches either the REELS_WORKER_SECRET environment variable or the
// `reels_worker_secret` entry in Vault (checked inside the database, so the
// value never reaches this process). Fails closed when neither is set up.

export function workerSecretFrom(request: Request): string {
  return (
    request.headers.get("x-worker-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

export type WorkerAuth = "ok" | "unauthorized";

export async function authorizeWorker(request: Request): Promise<WorkerAuth> {
  const provided = workerSecretFrom(request);
  if (!provided) return "unauthorized";

  const envSecret = process.env.REELS_WORKER_SECRET;
  if (envSecret && provided === envSecret) return "ok";

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("check_worker_secret", {
      _provided: provided,
    });
    if (!error && data === true) return "ok";
  } catch {
    /* fall through: no way to verify means no access */
  }
  return "unauthorized";
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
