import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { assertSuperadmin, getAdmin, writeAudit, countRows } from "@/lib/superadmin.server";

export type ReelWorkerRow = {
  id: string;
  title: string;
  userId: string;
  status: string;
  processingStep: string;
  attempts: number;
  errorMessage: string | null;
  processingStartedAt: string | null;
  createdAt: string;
  problem: "failed" | "stuck" | "exhausted";
};

export type ReelWorkerStatus = {
  counts: { processing: number; failed: number; stuck: number; exhausted: number };
  limits: { maxAttempts: number; stuckAfterMinutes: number };
  lastActivityAt: string | null;
  problems: ReelWorkerRow[];
};

const COLUMNS =
  "id, title, user_id, status, processing_step, attempts, error_message, processing_started_at, created_at";

/**
 * Health of the reels worker. The worker itself is an endpoint guarded by a
 * shared secret that never reaches the browser, so this only reads the queue.
 */
export const superadminReelsWorkerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReelWorkerStatus> => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { MAX_ATTEMPTS, STUCK_AFTER_MS } = await import("@/lib/reels-pipeline.server");
    const stuckBefore = new Date(Date.now() - STUCK_AFTER_MS).toISOString();

    const [processing, failed, stuck, exhausted, last, failedRows, stuckRows, exhaustedRows] =
      await Promise.all([
        countRows(admin, "highlight_reels", (q: any) => q.eq("status", "processing")),
        countRows(admin, "highlight_reels", (q: any) => q.eq("status", "failed")),
        countRows(admin, "highlight_reels", (q: any) =>
          q.eq("status", "processing").lt("processing_started_at", stuckBefore),
        ),
        countRows(admin, "highlight_reels", (q: any) =>
          q.eq("status", "processing").gte("attempts", MAX_ATTEMPTS),
        ),
        admin
          .from("highlight_reels")
          .select("processing_started_at")
          .not("processing_started_at", "is", null)
          .order("processing_started_at", { ascending: false })
          .limit(1),
        admin
          .from("highlight_reels")
          .select(COLUMNS)
          .eq("status", "failed")
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("highlight_reels")
          .select(COLUMNS)
          .eq("status", "processing")
          .lt("processing_started_at", stuckBefore)
          .order("created_at", { ascending: true })
          .limit(50),
        admin
          .from("highlight_reels")
          .select(COLUMNS)
          .eq("status", "processing")
          .gte("attempts", MAX_ATTEMPTS)
          .order("created_at", { ascending: true })
          .limit(50),
      ]);

    const seen = new Set<string>();
    const problems: ReelWorkerRow[] = [];
    const add = (rows: any[] | null, problem: ReelWorkerRow["problem"]) => {
      for (const r of rows ?? []) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        problems.push({
          id: r.id,
          title: r.title,
          userId: r.user_id,
          status: r.status,
          processingStep: r.processing_step,
          attempts: r.attempts,
          errorMessage: r.error_message,
          processingStartedAt: r.processing_started_at,
          createdAt: r.created_at,
          problem,
        });
      }
    };
    add(exhaustedRows.data, "exhausted");
    add(stuckRows.data, "stuck");
    add(failedRows.data, "failed");

    return {
      counts: { processing, failed, stuck, exhausted },
      limits: { maxAttempts: MAX_ATTEMPTS, stuckAfterMinutes: Math.round(STUCK_AFTER_MS / 60000) },
      lastActivityAt: (last.data?.[0] as any)?.processing_started_at ?? null,
      problems,
    };
  });

const actionInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(50),
  reason: z.string().trim().min(3).max(500),
});

/** Re-queue failed, stuck or attempt-exhausted reels. Completed reels are never touched. */
export const superadminRetryReels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; reason: string }) => actionInput.parse(d))
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { MAX_ATTEMPTS, STUCK_AFTER_MS } = await import("@/lib/reels-pipeline.server");
    const stuckBefore = Date.now() - STUCK_AFTER_MS;

    const { data: rows, error } = await admin
      .from("highlight_reels")
      .select("id, status, attempts, processing_started_at")
      .in("id", data.ids);
    if (error) throw new Error(error.message);

    const eligible = (rows ?? []).filter((r: any) => {
      if (r.status === "failed") return true;
      if (r.status !== "processing") return false;
      const started = r.processing_started_at ? Date.parse(r.processing_started_at) : 0;
      return r.attempts >= MAX_ATTEMPTS || started < stuckBefore;
    });
    if (eligible.length === 0) throw new Error("None of those reels need a retry.");

    const ids = eligible.map((r: any) => r.id as string);
    const { error: upErr } = await admin
      .from("highlight_reels")
      .update({
        status: "processing",
        attempts: 0,
        processing_started_at: null,
        error_message: null,
        failed_at: null,
      })
      .in("id", ids);
    if (upErr) throw new Error(upErr.message);

    await writeAudit(admin, context.userId, {
      action: "reels.retry",
      targetType: "highlight_reels",
      targetId: ids.join(","),
      reason: data.reason,
      before: eligible,
      after: { requeued: ids.length },
    });
    return { requeued: ids.length, skipped: data.ids.length - ids.length };
  });

/** Hide reels from public surfaces (reversible; never deletes). */
export const superadminHideReels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { ids: string[]; reason: string }) => actionInput.parse(d))
  .handler(async ({ context, data }) => {
    await assertSuperadmin(context);
    const admin = await getAdmin();
    const { error } = await admin
      .from("highlight_reels")
      .update({ hidden_at: new Date().toISOString() })
      .in("id", data.ids);
    if (error) throw new Error(error.message);
    await writeAudit(admin, context.userId, {
      action: "reels.hide",
      targetType: "highlight_reels",
      targetId: data.ids.join(","),
      reason: data.reason,
      after: { hidden: data.ids.length },
    });
    return { hidden: data.ids.length };
  });
