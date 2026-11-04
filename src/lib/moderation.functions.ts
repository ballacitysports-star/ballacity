import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AuditAction } from "@/lib/audit-actions";
import { assertModerator, loadHeldEvidence } from "@/lib/moderation.server";
import {
  blockedByLocationHold,
  LOCATION_HOLD_MESSAGE,
  locationHoldRpc,
  type HeldEvidence,
} from "@/lib/location-hold";

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
  reported: {
    id: string;
    name: string;
    moderationState: string;
    suspendedAt: string | null;
  } | null;
  gameId: string | null;
  gameTitle: string | null;
  /** The game's text is held after location-disclosure reports; only Restore text / Confirm removal close it. */
  locationHold: boolean;
  /** Moderators only: the held listing text (the latest open hold's evidence), so Restore text / Confirm removal is decided with it in view. */
  heldEvidence: HeldEvidence | null;
  conversationId: string | null;
  messageId: string | null;
  messageBody: string | null;
  messageDeleted: boolean;
  reelId: string | null;
  reelTitle: string | null;
  reelHidden: boolean;
  /** Team post or comment reports: what was reported and whether it is held or hidden right now. */
  teamPostId: string | null;
  commentId: string | null;
  contentText: string | null;
  contentState: "visible" | "held" | "hidden" | null;
  hasImage: boolean;
};

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string; subjectType?: string } | undefined) =>
    z
      .object({
        status: z.union([STATUS, z.literal("all")]).default("all"),
        subjectType: z
          .union([
            z.enum(["user", "game", "message", "reel", "team_post", "comment"]),
            z.literal("all"),
          ])
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
        "id, subject_type, reason, details, status, created_at, reviewed_at, resolution_notes, reporter_id, reported_id, game_id, conversation_id, message_id, reel_id, team_post_id, comment_id",
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

    const postIds = Array.from(
      new Set(list.map((r) => r.team_post_id).filter(Boolean)),
    ) as string[];
    const commentIds = Array.from(
      new Set(list.map((r) => r.comment_id).filter(Boolean)),
    ) as string[];
    const [posts, comments] = await Promise.all([
      postIds.length
        ? supabaseAdmin
            .from("team_posts")
            .select("id, title, body, image_url, hidden_at, moderation_status")
            .in("id", postIds)
        : Promise.resolve({ data: [] as any[] }),
      commentIds.length
        ? supabaseAdmin
            .from("post_comments")
            .select("id, body, hidden_at, moderation_status")
            .in("id", commentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const postMap = new Map((posts.data ?? []).map((p: any) => [p.id, p]));
    const commentMap = new Map((comments.data ?? []).map((c: any) => [c.id, c]));

    const [profiles, games, messages, reels, holds] = await Promise.all([
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
        ? supabaseAdmin.from("highlight_reels").select("id, title, hidden_at").in("id", reelIds)
        : Promise.resolve({ data: [] as any[] }),
      gameIds.length
        ? (supabaseAdmin as any)
            .from("location_report_evidence")
            .select("game_id")
            .in("game_id", gameIds)
            .is("released_at", null)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const heldGames = new Set(((holds as any).data ?? []).map((h: any) => h.game_id as string));
    // The held text itself, for the held location reports on this page only, read with the moderator's own session (row security).
    const heldReportGames = Array.from(
      new Set(
        list
          .filter((r) => r.reason === "location_disclosed" && r.game_id && heldGames.has(r.game_id))
          .map((r) => r.game_id as string),
      ),
    );
    const evidence = await loadHeldEvidence(context, heldReportGames);

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
        locationHold: !!r.game_id && r.reason === "location_disclosed" && heldGames.has(r.game_id),
        heldEvidence:
          r.game_id && r.reason === "location_disclosed" ? (evidence.get(r.game_id) ?? null) : null,
        conversationId: r.conversation_id ?? msg?.conversation_id ?? null,
        messageId: r.message_id,
        messageBody: msg?.body ?? null,
        messageDeleted: !!msg?.deleted_at,
        reelId: r.reel_id,
        reelTitle: reel?.title ?? null,
        reelHidden: !!reel?.hidden_at,
        teamPostId: r.team_post_id ?? null,
        commentId: r.comment_id ?? null,
        contentText: (() => {
          const p = r.team_post_id ? postMap.get(r.team_post_id) : null;
          const c = r.comment_id ? commentMap.get(r.comment_id) : null;
          if (p) return `${p.title}${p.body ? `\n${p.body}` : ""}`.slice(0, 600);
          return c ? String(c.body ?? "").slice(0, 600) : null;
        })(),
        contentState: (() => {
          const row: any = r.team_post_id
            ? postMap.get(r.team_post_id)
            : r.comment_id
              ? commentMap.get(r.comment_id)
              : null;
          if (!row) return null;
          if (row.hidden_at) return "hidden" as const;
          return row.moderation_status === "held" ? ("held" as const) : ("visible" as const);
        })(),
        hasImage: !!(r.team_post_id && postMap.get(r.team_post_id)?.image_url),
      };
    });

    const counts: Record<string, number> = {};
    for (const r of reports) counts[r.status] = (counts[r.status] ?? 0) + 1;
    return { reports, counts };
  });

/** Refuse a generic close of a report whose game text is held (the database refuses it too: LOCATION_HOLD_OPEN). */
async function assertNoOpenHold(
  admin: any,
  report: { reason: string | null; game_id: string | null } | null,
  action: { status?: string; action?: string },
) {
  if (!report?.game_id || report.reason !== "location_disclosed") return;
  const { data } = await admin
    .from("location_report_evidence")
    .select("id")
    .eq("game_id", report.game_id)
    .is("released_at", null)
    .limit(1);
  const locationHold = (data ?? []).length > 0;
  if (
    blockedByLocationHold({ reason: report.reason, gameId: report.game_id, locationHold }, action)
  )
    throw new Error(LOCATION_HOLD_MESSAGE);
}

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
      .select("id, status, resolution_notes, reason, game_id")
      .eq("id", data.reportId)
      .maybeSingle();
    await assertNoOpenHold(supabaseAdmin, before as any, { status: data.status });
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
    await assertNoOpenHold(supabaseAdmin, report as any, { action: data.action });

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

    const { error: closeErr } = await supabaseAdmin
      .from("user_reports")
      .update({
        status: data.action === "restore" ? "dismissed" : "resolved",
        reviewed_by: context.userId,
        reviewed_at: now,
        resolution_notes: [summary, reason].filter(Boolean).join(" — "),
      })
      .eq("id", data.reportId);
    if (closeErr) throw new Error(closeErr.message);

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
      ? await supabaseAdmin
          .from("profiles")
          .select("id, display_name")
          .in("id", actorIds as string[])
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

/**
 * Decide a held location-disclosure report: restore the listing text or confirm its removal. Runs as the signed-in moderator, so the database
 * checks the role, records the moderator and closes every report on that game.
 */
export const decideLocationHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reportId: string; decision: string; notes?: string }) =>
    z
      .object({
        reportId: z.string().uuid(),
        decision: z.enum(["restore", "confirm"]),
        notes: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: report, error: rErr } = await supabaseAdmin
      .from("user_reports")
      .select("id, reason, game_id")
      .eq("id", data.reportId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!report?.game_id || report.reason !== "location_disclosed")
      throw new Error("This report is not about a held listing");
    const { error } = await (context.supabase.rpc as any)(locationHoldRpc(data.decision), {
      _game: report.game_id,
      _reason: data.notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const CONTENT_DECISION = z.enum(["dismiss", "hide", "remove_media", "restore"]);

/** Decide a team-post or comment report. Runs as the signed-in moderator so the database checks the role, the audit actor and the escalation rules. */
export const decideContentReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reportId: string; decision: string; notes?: string }) =>
    z
      .object({
        reportId: z.string().uuid(),
        decision: CONTENT_DECISION,
        notes: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { error } = await (context.supabase.rpc as any)("moderator_decide_content_report", {
      _report: data.reportId,
      _decision: data.decision,
      _notes: data.notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type ContentAppeal = {
  id: string;
  contentType: string;
  contentId: string;
  note: string;
  createdAt: string;
  contentText: string | null;
};

export const listContentAppeals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ContentAppeal[]> => {
    await assertModerator(context);
    const { data, error } = await (context.supabase as any)
      .from("moderation_appeals")
      .select("id, content_type, content_id, note, created_at")
      .eq("status", "open")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as any[];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const posts = rows.filter((r) => r.content_type === "team_post").map((r) => r.content_id);
    const comments = rows.filter((r) => r.content_type === "comment").map((r) => r.content_id);
    const [p, c] = await Promise.all([
      posts.length
        ? supabaseAdmin.from("team_posts").select("id, title, body").in("id", posts)
        : Promise.resolve({ data: [] as any[] }),
      comments.length
        ? supabaseAdmin.from("post_comments").select("id, body").in("id", comments)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const text = new Map<string, string>();
    for (const x of (p.data ?? []) as any[])
      text.set(x.id, `${x.title}${x.body ? `\n${x.body}` : ""}`.slice(0, 600));
    for (const x of (c.data ?? []) as any[]) text.set(x.id, String(x.body ?? "").slice(0, 600));
    return rows.map((r) => ({
      id: r.id,
      contentType: r.content_type,
      contentId: r.content_id,
      note: r.note,
      createdAt: r.created_at,
      contentText: text.get(r.content_id) ?? null,
    }));
  });

export const reviewContentAppeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { appealId: string; reverse: boolean; notes?: string }) =>
    z
      .object({
        appealId: z.string().uuid(),
        reverse: z.boolean(),
        notes: z.string().max(1000).optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { error } = await (context.supabase.rpc as any)("moderator_review_appeal", {
      _appeal: data.appealId,
      _reverse: data.reverse,
      _notes: data.notes?.trim() || null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
