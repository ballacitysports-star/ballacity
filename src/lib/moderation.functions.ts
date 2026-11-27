import { createHash } from "crypto";
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AuditAction } from "@/lib/audit-actions";
import { assertModerator } from "@/lib/moderation.server";
import { reportStatusesFor } from "@/lib/report-status";

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

/** The report kinds the queue filters by. */
export const REPORT_SUBJECT_FILTERS = ["user", "game", "message", "reel", "post"] as const;

/**
 * user_reports.post_id and post_body_md5 come with 20261205100000. Before that migration is applied (and after its
 * rollback) the columns are missing and a read that names them fails, so the queue reads them only where they exist: on
 * this error it reads again without them.
 */
export function isMissingPostIdColumn(
  error: { code?: string; message?: string } | null | undefined,
): boolean {
  return (
    !!error &&
    (error.code === "42703" || error.code === "PGRST204") &&
    /\bpost_(id|body_md5)\b/.test(error.message ?? "")
  );
}

/** md5 of a post's text, as Postgres md5(text) computes it (report_post keeps it as user_reports.post_body_md5). */
export function postBodyMd5(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

/**
 * Whether a reported post's text changed after the report: its md5 now against the one report_post kept. null when the
 * report kept none (a row written before 20261205100000 or by server code), so nobody can tell.
 */
export function postEditedSinceReport(
  body: string,
  reportedMd5: string | null | undefined,
): boolean | null {
  return reportedMd5 ? postBodyMd5(body) !== reportedMd5 : null;
}

/** The summary Remove content writes on a post report; Restore reads it back to know that this report hid the post. */
export const POST_HIDDEN_SUMMARY = "Post hidden";

/**
 * Why Restore on a post report must leave a hidden post hidden, or null when it may unhide it. Restore undoes what this
 * report did, so it unhides the post only when this report's own Remove content hid it (its notes start with
 * POST_HIDDEN_SUMMARY) and no other report about the same post has been resolved or actioned: a moderator dismissing a
 * weak second report never puts back a post another report (or a superadmin) took down.
 */
export function postRestoreBlocker(input: {
  resolutionNotes: string | null;
  otherClosedReports: number;
}): string | null {
  if (input.otherClosedReports > 0) return "another report about this post was acted on";
  if (!(input.resolutionNotes ?? "").startsWith(POST_HIDDEN_SUMMARY)) {
    return "this report did not hide it";
  }
  return null;
}

/** Report statuses that mean a moderator acted on the report (report-status.ts: the Resolved queue). */
const ACTED_ON_STATUSES = ["resolved", "actioned"] as const;

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };

/**
 * The query-builder calls these reads and writes make, for what the generated client types do not know yet
 * (user_reports.post_id, the posts table).
 */
type LooseQuery = PromiseLike<QueryResult> & {
  select(columns: string): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  order(column: string, options: { ascending: boolean }): LooseQuery;
  limit(count: number): LooseQuery;
  update(values: Record<string, unknown>): LooseQuery;
  maybeSingle(): PromiseLike<QueryResult>;
};
const looseFrom = (admin: unknown, table: string): LooseQuery =>
  (admin as { from(table: string): LooseQuery }).from(table);

/** Runs `read` naming post_id, and again without it while the column does not exist. */
async function withPostIdIfPresent(
  read: (withPostId: boolean) => PromiseLike<QueryResult>,
): Promise<QueryResult> {
  const first = await read(true);
  return isMissingPostIdColumn(first.error) ? read(false) : first;
}

type ReportRow = {
  id: string;
  subject_type: string;
  reason: string;
  details: string | null;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  resolution_notes: string | null;
  reporter_id: string;
  reported_id: string;
  game_id: string | null;
  conversation_id: string | null;
  message_id: string | null;
  reel_id: string | null;
  /** Missing before 20261205100000 and after its rollback. */
  post_id?: string | null;
  /** md5 of the post's text when it was reported; missing before 20261205100000 and after its rollback. */
  post_body_md5?: string | null;
};

type PostRow = {
  id: string;
  body: string;
  posted_as: ModerationPost["postedAs"];
  team_id: string | null;
  org_id: string | null;
  audience: string;
  hidden_at: string | null;
  deleted_at: string | null;
  moderation_status: string;
};

/** A reported network post as a moderator sees it (read with the service role: RLS does not hide it here). */
export type ModerationPost = {
  id: string;
  body: string;
  postedAs: "person" | "team" | "org";
  teamId: string | null;
  orgId: string | null;
  audience: string;
  hidden: boolean;
  deleted: boolean;
  moderationStatus: string;
  /** The text changed after this report (true), is what was reported (false), or nobody can tell (null). */
  editedSinceReport: boolean | null;
  /** While the post is hidden: why Restore on this report would leave it hidden (postRestoreBlocker), else null. */
  restoreKeepsHidden: string | null;
};

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
  conversationId: string | null;
  messageId: string | null;
  messageBody: string | null;
  messageDeleted: boolean;
  reelId: string | null;
  reelTitle: string | null;
  reelHidden: boolean;
  /** The reported network post (subject 'post') as it is now; null once it was deleted for good. */
  postId: string | null;
  post: ModerationPost | null;
};

const REPORT_COLUMNS =
  "id, subject_type, reason, details, status, created_at, reviewed_at, resolution_notes, reporter_id, reported_id, game_id, conversation_id, message_id, reel_id";
const POST_COLUMNS =
  "id, body, posted_as, team_id, org_id, audience, hidden_at, deleted_at, moderation_status";

export const listReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { status?: string; subjectType?: string } | undefined) =>
    z
      .object({
        status: z.union([STATUS, z.literal("all")]).default("all"),
        subjectType: z.union([z.enum(REPORT_SUBJECT_FILTERS), z.literal("all")]).default("all"),
      })
      .parse(d ?? {}),
  )
  .handler(async ({ context, data }) => {
    await assertModerator(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await withPostIdIfPresent((withPostId) => {
      let q = looseFrom(supabaseAdmin, "user_reports")
        .select(withPostId ? `${REPORT_COLUMNS}, post_id, post_body_md5` : REPORT_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(300);
      if (data.status !== "all") q = q.in("status", reportStatusesFor(data.status));
      if (data.subjectType !== "all") q = q.eq("subject_type", data.subjectType);
      return q;
    });
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as ReportRow[];

    const userIds = Array.from(
      new Set(list.flatMap((r) => [r.reporter_id, r.reported_id]).filter(Boolean)),
    ) as string[];
    const gameIds = Array.from(new Set(list.map((r) => r.game_id).filter(Boolean))) as string[];
    const messageIds = Array.from(
      new Set(list.map((r) => r.message_id).filter(Boolean)),
    ) as string[];
    const reelIds = Array.from(new Set(list.map((r) => r.reel_id).filter(Boolean))) as string[];
    const postIds = Array.from(new Set(list.map((r) => r.post_id).filter(Boolean))) as string[];

    const [profiles, games, messages, reels, posts, actedOn] = await Promise.all([
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
      postIds.length
        ? looseFrom(supabaseAdmin, "posts").select(POST_COLUMNS).in("id", postIds)
        : Promise.resolve<QueryResult>({ data: [], error: null }),
      // Every report about these posts that a moderator acted on, whatever the filter: what Restore must not overturn.
      postIds.length
        ? looseFrom(supabaseAdmin, "user_reports")
            .select("id, post_id")
            .in("post_id", postIds)
            .in("status", ACTED_ON_STATUSES)
        : Promise.resolve<QueryResult>({ data: [], error: null }),
    ]);

    const pMap = new Map((profiles.data ?? []).map((p: any) => [p.id, p]));
    const gMap = new Map((games.data ?? []).map((g: any) => [g.id, g]));
    const mMap = new Map((messages.data ?? []).map((m: any) => [m.id, m]));
    const rMap = new Map((reels.data ?? []).map((r: any) => [r.id, r]));
    const postMap = new Map(((posts.data ?? []) as PostRow[]).map((p) => [p.id, p]));
    const actedOnRows = (actedOn.data ?? []) as { id: string; post_id: string }[];
    const otherActedOn = (r: ReportRow) =>
      actedOnRows.filter((a) => a.post_id === r.post_id && a.id !== r.id).length;

    const reports: ModerationReport[] = list.map((r) => {
      const reporter = pMap.get(r.reporter_id);
      const reported = pMap.get(r.reported_id);
      const game = r.game_id ? gMap.get(r.game_id) : null;
      const msg = r.message_id ? mMap.get(r.message_id) : null;
      const reel = r.reel_id ? rMap.get(r.reel_id) : null;
      const post = r.post_id ? postMap.get(r.post_id) : null;
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
        postId: r.post_id ?? null,
        post: post
          ? {
              id: post.id,
              body: post.body,
              postedAs: post.posted_as,
              teamId: post.team_id ?? null,
              orgId: post.org_id ?? null,
              audience: post.audience,
              hidden: !!post.hidden_at,
              deleted: !!post.deleted_at,
              moderationStatus: post.moderation_status,
              editedSinceReport: postEditedSinceReport(post.body, r.post_body_md5),
              restoreKeepsHidden: post.hidden_at
                ? postRestoreBlocker({
                    resolutionNotes: r.resolution_notes,
                    otherClosedReports: otherActedOn(r),
                  })
                : null,
            }
          : null,
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
    const ACTION_COLUMNS =
      "id, reported_id, subject_type, game_id, message_id, reel_id, reason, resolution_notes";
    const { data: found, error: rErr } = await withPostIdIfPresent((withPostId) =>
      looseFrom(supabaseAdmin, "user_reports")
        .select(withPostId ? `${ACTION_COLUMNS}, post_id` : ACTION_COLUMNS)
        .eq("id", data.reportId)
        .maybeSingle(),
    );
    if (rErr) throw new Error(rErr.message);
    if (!found) throw new Error("Report not found");
    const report = found as Pick<
      ReportRow,
      | "id"
      | "reported_id"
      | "subject_type"
      | "game_id"
      | "message_id"
      | "reel_id"
      | "post_id"
      | "reason"
      | "resolution_notes"
    >;

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
      } else if (report.subject_type === "post" && report.post_id) {
        // The same hide the superadmin content queue uses (hidden_at, written with the service role).
        await looseFrom(supabaseAdmin, "posts").update({ hidden_at: now }).eq("id", report.post_id);
        summary = POST_HIDDEN_SUMMARY;
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
      if (report.post_id) {
        // Restore undoes this report's own hide only, never one another report or a superadmin made.
        const [{ data: post }, { data: acted }] = await Promise.all([
          looseFrom(supabaseAdmin, "posts")
            .select("id, hidden_at")
            .eq("id", report.post_id)
            .maybeSingle(),
          looseFrom(supabaseAdmin, "user_reports")
            .select("id")
            .eq("post_id", report.post_id)
            .in("status", ACTED_ON_STATUSES),
        ]);
        const blocker = (post as { hidden_at: string | null } | null)?.hidden_at
          ? postRestoreBlocker({
              resolutionNotes: report.resolution_notes,
              otherClosedReports: ((acted ?? []) as { id: string }[]).filter(
                (a) => a.id !== report.id,
              ).length,
            })
          : null;
        if (blocker) {
          summary = `Access restored; the post stays hidden (${blocker})`;
        } else {
          await looseFrom(supabaseAdmin, "posts")
            .update({ hidden_at: null })
            .eq("id", report.post_id);
        }
      }
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
              : report.subject_type === "post" && report.post_id
                ? report.post_id
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
