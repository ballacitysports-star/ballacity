import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AuditAction } from "@/lib/audit-actions";
import { assertModerator } from "@/lib/moderation.server";

/** Canonical audit action for each moderation outcome. */
const MODERATION_AUDIT_ACTION = {
  warn: "user.warn",
  remove_content: "content.remove",
  suspend: "user.suspend",
  ban: "user.ban",
  restore: "user.restore",
} as const;

const REPORT_STATUS_AUDIT_ACTION: Record<string, AuditAction> = {
  resolved: "report.resolve",
  dismissed: "report.dismiss",
  new: "report.status",
  investigating: "report.status",
  escalated: "report.status",
};

async function audit(
  admin: any,
  actorId: string,
  entry: {
    action: AuditAction;
    targetType: string;
    targetId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  const { logAdminAction } = await import("@/lib/audit-log.server");
  await logAdminAction(admin, actorId, entry);
}

export const moderationCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("is_moderator", {
      _user_id: context.userId,
    });
    return { isModerator: !!data, userId: context.userId };
  });

const STATUS = z.enum(["new", "investigating", "resolved", "dismissed", "escalated"]);

export type ModerationReport = {
  id: string;
  subjectType: string;
  reason: string;
  details: string | null;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
  resolutionNotes: string | null;
  reporter: { id: string; name: string } | null;
  reported: { id: string; name: string; moderationState: string; suspendedAt: string | null } | null;
  gameId: string | null;
  gameTitle: string | null;
  conversationId: string | null;
  messageId: string | null;
  messageBody: string | null;
  messageDeleted: boolean;
  reelId: string | null;
  reelTitle: string | null;
  reelHidden: boolean;
};

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string; subjectType?: string } | undefined) =>
    z
      .object({
        status: z.union([STATUS, z.literal("all")]).default("all"),
        subjectType: z
          .union([z.enum(["user", "game", "message", "reel"]), z.literal("all")])
          .default("all"),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("user_reports")
      .select(
        "id, subject_type, reason, details, status, created_at, reviewed_at, resolution_notes, reporter_id, reported_id, game_id, conversation_id, message_id, reel_id",
      )
      .order("created_at", { ascending: false })
      .limit(300);
    if (data.status !== "all") {
      const legacy: Record<string, string[]> = {
        new: ["new", "pending", "open"],
        investigating: ["investigating", "reviewing"],
        resolved: ["resolved", "actioned"],
        dismissed: ["dismissed"],
        escalated: ["escalated"],
      };
      q = q.in("status", legacy[data.status] ?? [data.status]);
    }
    if (data.subjectType !== "all") q = q.eq("subject_type", data.subjectType);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    const list = rows ?? [];

    const userIds = Array.from(
      new Set(list.flatMap((r) => [r.reporter_id, r.reported_id]).filter(Boolean)),
    ) as string[];
    const gameIds = Array.from(new Set(list.map((r) => r.game_id).filter(Boolean))) as string[];
    const messageIds = Array.from(
      new Set(list.map((r) => r.message_id).filter(Boolean)),
    ) as string[];
    const reelIds = Array.from(new Set(list.map((r) => r.reel_id).filter(Boolean))) as string[];

    const [profiles, games, messages, reels] = await Promise.all([
      userIds.length
        ? supabaseAdmin
            .from("profiles")
            .select("id, display_name, moderation_state, suspended_at")
            .in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      gameIds.length
        ? supabaseAdmin.from("hosted_games").select("id, title, hidden_at").in("id", gameIds)
        : Promise.resolve({ data: [] as any[] }),
      messageIds.length
        ? supabaseAdmin
            .from("messages")
            .select("id, body, deleted_at, conversation_id")
            .in("id", messageIds)
        : Promise.resolve({ data: [] as any[] }),
      reelIds.length
        ? supabaseAdmin
            .from("highlight_reels")
            .select("id, title, hidden_at")
            .in("id", reelIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const pMap = new Map((profiles.data ?? []).map((p: any) => [p.id, p]));
    const gMap = new Map((games.data ?? []).map((g: any) => [g.id, g]));
    const mMap = new Map((messages.data ?? []).map((m: any) => [m.id, m]));
    const rMap = new Map((reels.data ?? []).map((r: any) => [r.id, r]));

    const reports: ModerationReport[] = list.map((r) => {
      const reporter = pMap.get(r.reporter_id);
      const reported = pMap.get(r.reported_id);
      const game = r.game_id ? gMap.get(r.game_id) : null;
      const msg = r.message_id ? mMap.get(r.message_id) : null;
      const reel = r.reel_id ? rMap.get(r.reel_id) : null;
      return {
        id: r.id,
        subjectType: r.subject_type,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
        resolutionNotes: r.resolution_notes,
        reporter: reporter ? { id: reporter.id, name: reporter.display_name } : null,
        reported: reported
          ? {
              id: reported.id,
              name: reported.display_name,
              moderationState: reported.moderation_state ?? "active",
              suspendedAt: reported.suspended_at ?? null,
            }
          : null,
        gameId: r.game_id,
        gameTitle: game?.title ?? null,
        conversationId: r.conversation_id ?? msg?.conversation_id ?? null,
        messageId: r.message_id,
        messageBody: msg?.body ?? null,
        messageDeleted: !!msg?.deleted_at,
        reelId: r.reel_id,
        reelTitle: reel?.title ?? null,
        reelHidden: !!reel?.hidden_at,
      };
    });

    const counts: Record<string, number> = {};
    for (const r of reports) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { reports, counts };
  });

export const setReportStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reportId: string; status: string; notes?: string }) =>
    z
      .object({
        reportId: z.string().uuid(),
        status: STATUS,
        notes: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: before } = await supabaseAdmin
      .from("user_reports")
      .select("id, status, resolution_notes")
      .eq("id", data.reportId)
      .maybeSingle();
    const { error } = await supabaseAdmin
      .from("user_reports")
      .update({
        status: data.status,
        resolution_notes: data.notes?.trim() || before?.resolution_notes || null,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", data.reportId);
    if (error) throw new Error(error.message);
    await audit(supabaseAdmin, context.userId, {
      action: REPORT_STATUS_AUDIT_ACTION[data.status] ?? "report.status",
      targetType: "report",
      metadata: { status: data.status },
      targetId: data.reportId,
      reason: data.notes?.trim() || null,
      before: before ? { status: before.status } : null,
      after: { status: data.status },
    });
    return { ok: true };
  });

const ACTION = z.enum(["warn", "remove_content", "suspend", "ban", "restore"]);
export type ModerationActionKind = z.infer<typeof ACTION>;

export const applyModerationAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reportId: string; action: string; reason?: string }) =>
    z
      .object({
        reportId: z.string().uuid(),
        action: ACTION,
        reason: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: report, error: rErr } = await supabaseAdmin
      .from("user_reports")
      .select("id, reported_id, subject_type, game_id, message_id, reel_id, reason")
      .eq("id", data.reportId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!report) throw new Error("Report not found");

    const reason = data.reason?.trim() || null;
    const now = new Date().toISOString();
    let summary = "";

    if (data.action === "warn") {
      await supabaseAdmin
        .from("profiles")
        .update({ moderation_state: "warned" })
        .eq("id", report.reported_id);
      await supabaseAdmin.from("notifications").insert({
        user_id: report.reported_id,
        type: "moderation",
        title: "Community guidelines warning",
        body:
          reason ??
          "A moderator reviewed activity on your account and issued a warning. Please review the community guidelines.",
        link: "/terms",
      });
      summary = "Warning issued";
    }

    if (data.action === "remove_content") {
      if (report.subject_type === "game" && report.game_id) {
        await supabaseAdmin
          .from("hosted_games")
          .update({ hidden_at: now })
          .eq("id", report.game_id);
        summary = "Game hidden";
      } else if (report.subject_type === "message" && report.message_id) {
        await supabaseAdmin
          .from("messages")
          .update({ deleted_at: now })
          .eq("id", report.message_id);
        summary = "Message removed";
      } else if (report.subject_type === "reel" && report.reel_id) {
        await supabaseAdmin
          .from("highlight_reels")
          .update({ hidden_at: now })
          .eq("id", report.reel_id);
        summary = "Reel hidden";
      } else {
        throw new Error("This report has no removable content attached");
      }
    }

    if (data.action === "suspend" || data.action === "ban") {
      await supabaseAdmin
        .from("profiles")
        .update({
          suspended_at: now,
          suspended_reason: reason ?? `Moderation action: ${data.action}`,
          moderation_state: data.action === "ban" ? "banned" : "suspended",
        })
        .eq("id", report.reported_id);
      summary = data.action === "ban" ? "Account banned" : "Account suspended";
    }

    if (data.action === "restore") {
      await supabaseAdmin
        .from("profiles")
        .update({ suspended_at: null, suspended_reason: null, moderation_state: "active" })
        .eq("id", report.reported_id);
      if (report.game_id)
        await supabaseAdmin
          .from("hosted_games")
          .update({ hidden_at: null })
          .eq("id", report.game_id);
      if (report.reel_id)
        await supabaseAdmin
          .from("highlight_reels")
          .update({ hidden_at: null })
          .eq("id", report.reel_id);
      summary = "Access and content restored";
    }

    await supabaseAdmin
      .from("user_reports")
      .update({
        status: data.action === "restore" ? "dismissed" : "resolved",
        reviewed_by: context.userId,
        reviewed_at: now,
        resolution_notes: [summary, reason].filter(Boolean).join(" — "),
      })
      .eq("id", data.reportId);

    await audit(supabaseAdmin, context.userId, {
      action: MODERATION_AUDIT_ACTION[data.action],
      targetType: report.subject_type,
      targetId:
        report.subject_type === "game"
          ? report.game_id
          : report.subject_type === "message"
            ? report.message_id
            : report.subject_type === "reel"
              ? report.reel_id
              : report.reported_id,
      reason,
      before: { reportId: report.id, reportReason: report.reason },
      after: { summary, reportedUserId: report.reported_id },
    });

    return { ok: true, summary };
  });

export const listModerationAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertModerator(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id, actor_id, action, target_type, target_id, reason, after, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    const actorIds = Array.from(new Set((data ?? []).map((r) => r.actor_id).filter(Boolean)));
    const { data: profiles } = actorIds.length
      ? await supabaseAdmin.from("profiles").select("id, display_name").in("id", actorIds as string[])
      : { data: [] as any[] };
    const map = new Map((profiles ?? []).map((p: any) => [p.id, p.display_name]));
    return {
      entries: (data ?? []).map((r) => ({
        id: r.id,
        actorId: r.actor_id,
        actorName: r.actor_id ? (map.get(r.actor_id) ?? "Unknown admin") : "System",
        action: r.action,
        targetType: r.target_type,
        targetId: r.target_id,
        reason: r.reason,
        summary: (r.after as any)?.summary ?? null,
        createdAt: r.created_at,
      })),
    };
  });
