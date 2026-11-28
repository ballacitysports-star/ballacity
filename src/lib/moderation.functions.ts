import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import type { AuditAction } from "@/lib/audit-actions";
import { assertModerator } from "@/lib/moderation.server";
import { postEditedSinceReport } from "@/lib/post-fingerprint.server";
import {
  ACCOUNT_BANNED_SUMMARY,
  ACCOUNT_SUSPENDED_SUMMARY,
  ALREADY_RESTRICTED_NOTE,
  POST_ALREADY_HIDDEN_SUMMARY,
  POST_HIDDEN_SUMMARY,
  REPORT_ACTION_AUDITS,
  RESTORE_CHECK_FAILED,
  RESTORE_KEEPS_ACCOUNT,
  RESTORE_KEEPS_HIDDEN,
  RESTORE_KEEPS_STATE,
  RESTORE_KEEPS_WARNING,
  RESTORE_LEFT_AS_IS,
  RESTORE_LEFT_REPORT,
  RESTORE_READ_FAILED,
  RESTORE_REPORT_CHANGED,
  RESTORE_REPORT_UPDATE_FAILED,
  accountRestorePlan,
  keptAccountSentence,
  keptPostSentence,
  keptStateSentence,
  keptWarningSentence,
  otherPostReports,
  otherWarningReports,
  ownHides,
  ownWarnings,
  postRestoreBlocker,
  reportActionFromAudit,
  restoreKeepsHidden,
  restoreRefusal,
  restoreSummary,
  warningRestoreBlocker,
  type OtherReport,
} from "@/lib/post-restore";
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

type QueryResult = {
  data: unknown;
  error: { code?: string; message?: string } | null;
  /** The rows the read matched in all, with `{ count: "exact" }`; may be more than `data` holds (max-rows). */
  count?: number | null;
};

/**
 * The query-builder calls these reads and writes make, for what the generated client types do not know yet
 * (user_reports.post_id, the posts table).
 */
type LooseQuery = PromiseLike<QueryResult> & {
  select(columns: string, options?: { count: "exact" }): LooseQuery;
  eq(column: string, value: unknown): LooseQuery;
  gt(column: string, value: unknown): LooseQuery;
  neq(column: string, value: unknown): LooseQuery;
  is(column: string, value: null): LooseQuery;
  in(column: string, values: readonly unknown[]): LooseQuery;
  order(column: string, options: { ascending: boolean }): LooseQuery;
  limit(count: number): LooseQuery;
  update(values: Record<string, unknown>): LooseQuery;
  maybeSingle(): PromiseLike<QueryResult>;
};
const looseFrom = (admin: unknown, table: string): LooseQuery =>
  (admin as { from(table: string): LooseQuery }).from(table);

/** The rows a write's `.select("id")` returned. */
const rowsOf = (res: QueryResult): unknown[] => (res.data ?? []) as unknown[];

/** Rows per page of a list read (PostgREST cuts a response at its max-rows, 1000 by default, and may cut it shorter). */
const PAGE_ROWS = 1000;
/** A list read gives up after this many pages: Restore then changes nothing, and the card says it could not check. */
const MAX_PAGES = 25;

/**
 * Every row a list read matches, page by page in id order: `read` builds the filtered query, and each page asks for an
 * exact count of the rows still to come, so a response the server cut short (max-rows) is never taken for the whole
 * list. A failed page, a page without a count, an empty page while rows remain, or more than MAX_PAGES pages returns an
 * error instead: Restore fails closed on it (RESTORE_READ_FAILED), and the card says it could not check.
 */
async function readAllRows(read: (count: { count: "exact" }) => LooseQuery): Promise<QueryResult> {
  const rows: unknown[] = [];
  let after: unknown = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    let q = read({ count: "exact" });
    if (after !== null) q = q.gt("id", after);
    const res = await q.order("id", { ascending: true }).limit(PAGE_ROWS);
    if (res.error) return res;
    const got = rowsOf(res);
    rows.push(...got);
    if (typeof res.count !== "number") {
      return { data: null, error: { message: "The read did not say how many rows it matched." } };
    }
    if (got.length >= res.count) return { data: rows, error: null };
    after = (got.at(-1) as { id?: unknown } | undefined)?.id ?? null;
    if (after === null) {
      return { data: null, error: { message: "The read was cut short." } };
    }
  }
  return { data: null, error: { message: "Too many rows to read." } };
}

/** An admin_audit_log row as the queue reads it back (post-restore.ts reportActionFromAudit). */
type AuditRow = Parameters<typeof reportActionFromAudit>[0];

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
  /** While the post is hidden: why Restore on this report would leave it hidden (post-restore.ts), else null. */
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

    const [profiles, games, messages, reels, posts, postReports, postAudit] = await Promise.all([
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
      // Every report about these posts that is not dismissed, whatever the filter: what Restore must not overturn. All
      // of them, page by page (readAllRows), or the card says it could not check.
      postIds.length
        ? readAllRows((count) =>
            looseFrom(supabaseAdmin, "user_reports")
              .select("id, post_id, status, resolution_notes", count)
              .in("post_id", postIds)
              .neq("status", "dismissed"),
          )
        : Promise.resolve<QueryResult>({ data: [], error: null }),
      // Every Remove content on these posts, with the hidden_at it wrote: which report owns a hide (post-restore.ts).
      postIds.length
        ? readAllRows((count) =>
            looseFrom(supabaseAdmin, "admin_audit_log")
              .select("id, action, before, after, created_at", count)
              .eq("action", "content.remove")
              .eq("target_type", "post")
              .in("target_id", postIds),
          )
        : Promise.resolve<QueryResult>({ data: [], error: null }),
    ]);

    const pMap = new Map((profiles.data ?? []).map((p: any) => [p.id, p]));
    const gMap = new Map((games.data ?? []).map((g: any) => [g.id, g]));
    const mMap = new Map((messages.data ?? []).map((m: any) => [m.id, m]));
    const rMap = new Map((reels.data ?? []).map((r: any) => [r.id, r]));
    const postMap = new Map(((posts.data ?? []) as PostRow[]).map((p) => [p.id, p]));
    const postReportRows = (postReports.data ?? []) as (OtherReport & { post_id: string })[];
    const postActions = ((postAudit.data ?? []) as AuditRow[]).map(reportActionFromAudit);
    // The card is advice; Restore reads everything again and fails closed. Without these it cannot advise.
    const restoreCheckFailed = !!(postReports.error || postAudit.error);
    const keepsHidden = (r: ReportRow, hiddenAt: string | null) =>
      hiddenAt && restoreCheckFailed
        ? RESTORE_CHECK_FAILED
        : restoreKeepsHidden({
            resolutionNotes: r.resolution_notes,
            reviewedAt: r.reviewed_at,
            hiddenAt,
            ownHides: ownHides(postActions, r.id),
            otherReports: otherPostReports(
              postReportRows.filter((x) => x.post_id === r.post_id),
              postActions,
              r.id,
            ),
          });

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
              restoreKeepsHidden: keepsHidden(r, post.hidden_at),
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

type ActionReport = Pick<
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
  | "reviewed_at"
>;

/** What Restore on a post report did: its summary, what it undid with the values it cleared, and how to record it. */
type PostRestoreOutcome = {
  summary: string;
  /** Each change Restore undid, with the values it cleared, for the audit entry. */
  lifted: Record<string, unknown>[];
  /** The account lift (the values it cleared), for an audit entry on the user; null when none. */
  accountLift: Record<string, unknown> | null;
  /**
   * Whether Restore marks the report dismissed and writes its summary into the notes: only when it undid something and
   * no write failed. Otherwise the report keeps its status, notes and reviewed_at, so it keeps counting as a report that
   * acted, and a later Restore can still undo its own action.
   */
  updateReport: boolean;
};

/**
 * Restore on a post report (owner decision 2026-11-28): undoes only this report's own actions, never what anyone else
 * did (post-restore.ts). It reads everything first, every row of each list (readAllRows), and a failed or cut-short read
 * changes nothing (RESTORE_READ_FAILED). Then it plans, before any write:
 * - the author's suspended_at is cleared only when this report owns it, and moderation_state is reset only when this
 *   report's own action set it, also once a superadmin cleared suspended_at, and only while no other report keeps
 *   either (accountRestorePlan);
 * - the author's warning is cleared only when this report issued it and no other report did;
 * - the post is unhidden only when this report owns the hide and no other report keeps it.
 * When this report owns a hide or suspension that another report keeps, Restore is refused: it throws restoreRefusal,
 * writes nothing, and leaves the report as it is, so it can undo its own action once that report is dismissed. Each
 * write applies only while the row still holds the value read, so a change made in between is kept.
 */
async function restorePostReport(
  admin: unknown,
  report: ActionReport,
): Promise<PostRestoreOutcome> {
  const none = Promise.resolve<QueryResult>({ data: null, error: null });
  const reads = await Promise.all([
    report.post_id
      ? looseFrom(admin, "posts").select("id, hidden_at").eq("id", report.post_id).maybeSingle()
      : none,
    report.post_id
      ? readAllRows((count) =>
          looseFrom(admin, "user_reports")
            .select("id, status, resolution_notes", count)
            .eq("post_id", report.post_id)
            .neq("status", "dismissed"),
        )
      : none,
    looseFrom(admin, "profiles")
      .select("id, suspended_at, suspended_reason, moderation_state")
      .eq("id", report.reported_id)
      .maybeSingle(),
    readAllRows((count) =>
      looseFrom(admin, "user_reports")
        .select("id, status, resolution_notes, reviewed_at", count)
        .eq("reported_id", report.reported_id)
        .neq("status", "dismissed"),
    ),
    // Every moderation action on any report about the author, with what it wrote (this report's own among them).
    readAllRows((count) =>
      looseFrom(admin, "admin_audit_log")
        .select("id, action, before, after, created_at", count)
        .eq("after->>reportedUserId", report.reported_id)
        .in("action", REPORT_ACTION_AUDITS),
    ),
  ]);
  // Fail closed: without every row of every read, Restore cannot tell whose change it would undo. A flood of reports
  // about the author or the post cannot push the one that keeps a change out of what Restore reads.
  if (reads.some((r) => r.error)) throw new Error(RESTORE_READ_FAILED);
  const [post, postRows, profile, accountRows, audit] = reads;
  const actions = ((audit.data ?? []) as AuditRow[]).map(reportActionFromAudit);
  const postReports = (postRows.data ?? []) as OtherReport[];
  const accountReports = (accountRows.data ?? []) as OtherReport[];

  const refused: string[] = [];
  const kept: string[] = [];
  let lift: {
    suspendedAt: string | null;
    reason: string | null;
    resetState: boolean;
    keptAfter: string | null;
  } | null = null;
  let clearWarning = false;
  let unhide: string | null = null;

  const p = profile.data as {
    suspended_at: string | null;
    suspended_reason: string | null;
    moderation_state: string | null;
  } | null;
  const state = p?.moderation_state ?? "active";
  const otherWarnings = otherWarningReports(accountReports, actions, report.id);
  if (p) {
    const suspendedAt = p.suspended_at ?? null;
    const plan = accountRestorePlan({
      reportId: report.id,
      resolutionNotes: report.resolution_notes,
      reviewedAt: report.reviewed_at,
      suspendedAt,
      moderationState: state,
      actions,
      reports: accountReports,
    });
    if (plan.refused) {
      refused.push(
        `The account stays ${state === "banned" ? "banned" : "suspended"}: ${plan.refused}.`,
      );
    } else if (plan.kept) {
      kept.push(plan.kept);
    } else if (plan.clearSuspension || plan.resetState) {
      lift = {
        suspendedAt,
        reason: p.suspended_reason ?? null,
        resetState: plan.resetState,
        keptAfter: plan.keptAfter,
      };
    }
    if (!lift?.resetState && state === "warned") {
      const block = warningRestoreBlocker({
        resolutionNotes: report.resolution_notes,
        ownWarnings: ownWarnings(actions, report.id),
        otherReports: otherWarnings,
      });
      if (block) kept.push(keptWarningSentence(block));
      else clearWarning = true;
    }
  }

  const hiddenAt = (post.data as { hidden_at: string | null } | null)?.hidden_at ?? null;
  // A post that is not hidden (or is gone) is not written.
  if (report.post_id && hiddenAt) {
    const block = postRestoreBlocker({
      resolutionNotes: report.resolution_notes,
      reviewedAt: report.reviewed_at,
      hiddenAt,
      ownHides: ownHides(actions, report.id),
      otherReports: otherPostReports(postReports, actions, report.id),
    });
    if (block === RESTORE_KEEPS_HIDDEN.otherReport)
      refused.push(`The post stays hidden: ${block}.`);
    else if (block) kept.push(keptPostSentence(block));
    else unhide = hiddenAt;
  }

  // This report's own action is in force, but another report keeps it: change nothing, keep the report as it is.
  if (refused.length) throw new Error(restoreRefusal(refused));

  const undone: string[] = [];
  const lifted: Record<string, unknown>[] = [];
  let accountLift: Record<string, unknown> | null = null;
  let failed = false;

  if (lift) {
    // Back to 'warned' while another report's warning stands, else 'active'; a moderation_state this report did not set
    // stays as it is. Only while suspended_at and moderation_state still hold what was read: a suspension, ban or lift
    // made since is kept.
    const to = !lift.resetState ? state : otherWarnings > 0 ? "warned" : "active";
    const keptAccountNow = (why: string) =>
      lift.suspendedAt === null ? keptStateSentence(state, why) : keptAccountSentence(state, why);
    let q = looseFrom(admin, "profiles")
      .update({
        ...(lift.suspendedAt !== null ? { suspended_at: null, suspended_reason: null } : {}),
        ...(lift.resetState ? { moderation_state: to } : {}),
      })
      .eq("id", report.reported_id);
    q =
      lift.suspendedAt === null
        ? q.is("suspended_at", null)
        : q.eq("suspended_at", lift.suspendedAt);
    const res = await q.eq("moderation_state", state).select("id");
    if (res.error) {
      failed = true;
      kept.push(
        keptAccountNow(lift.suspendedAt === null ? "resetting it failed" : "lifting it failed"),
      );
    } else if (!rowsOf(res).length) {
      kept.push(
        keptAccountNow(
          lift.suspendedAt === null
            ? RESTORE_KEEPS_STATE.changedSince
            : RESTORE_KEEPS_ACCOUNT.changedSince,
        ),
      );
    } else {
      undone.push(lift.resetState && state === "banned" ? "ban lifted" : "suspension lifted");
      if (lift.resetState && to === "warned") {
        kept.push(keptWarningSentence(RESTORE_KEEPS_WARNING.otherReport));
      }
      if (lift.keptAfter) kept.push(lift.keptAfter);
      accountLift = {
        suspended_at: lift.suspendedAt,
        suspended_reason: lift.reason,
        moderation_state: state,
        moderation_state_after: to,
      };
      lifted.push({ what: "account", ...accountLift });
    }
  }
  if (clearWarning) {
    // Only while the account is still just warned: a suspension or ban that lands meanwhile is never overwritten.
    const res = await looseFrom(admin, "profiles")
      .update({ moderation_state: "active" })
      .eq("id", report.reported_id)
      .eq("moderation_state", "warned")
      .select("id");
    if (res.error) {
      failed = true;
      kept.push(keptWarningSentence("clearing it failed"));
    } else if (rowsOf(res).length) {
      undone.push("warning cleared");
      lifted.push({ what: "warning", moderation_state: "warned" });
    }
  }
  if (unhide && report.post_id) {
    // Only while hidden_at still holds what was read: a hide made since then is kept.
    const res = await looseFrom(admin, "posts")
      .update({ hidden_at: null })
      .eq("id", report.post_id)
      .eq("hidden_at", unhide)
      .select("id");
    if (res.error) {
      failed = true;
      kept.push(keptPostSentence("unhiding it failed"));
    } else if (!rowsOf(res).length) {
      kept.push(keptPostSentence(RESTORE_KEEPS_HIDDEN.hiddenSince));
    } else {
      undone.push("post unhidden");
      lifted.push({ what: "post", hidden_at: unhide });
    }
  }
  const summary = restoreSummary(undone, kept);
  const updateReport = undone.length > 0 && !failed;
  return {
    summary: failed
      ? `${summary} ${RESTORE_LEFT_REPORT}`
      : updateReport
        ? summary
        : `${summary} ${RESTORE_LEFT_AS_IS}`,
    lifted,
    accountLift,
    updateReport,
  };
}

/** What a post report's Suspend or Ban wrote on the author's profile, as its audit entry records it (post-restore.ts). */
type AccountWrite = {
  /** The suspended_at it wrote: on an account nobody had restricted, or filled in where it was empty. */
  suspendedAt?: string;
  /** The moderation_state it wrote: on an account nobody had restricted, or a suspension (or none) raised to a ban. */
  moderationState?: string;
  /** It found the account unrestricted (suspended_at empty, 'active' or 'warned'). */
  fresh: boolean;
  /** Its `now`, before it wrote: entries with it record every profile write they made. */
  actedAt: string;
};

/**
 * Suspend or Ban on a post report: restricts the author only where nobody has (suspended_at empty, moderation_state
 * 'active' or 'warned'), so this report owns only a suspension it made. On an account that is already restricted it
 * keeps that suspension's suspended_at and reason, fills suspended_at only where it is empty (the gates that read only
 * it), raises a suspension to a ban, and never lowers anything. Returns what it wrote: Restore undoes only that.
 */
async function restrictPostAuthor(
  admin: unknown,
  userId: string,
  action: "suspend" | "ban",
  now: string,
  suspendedReason: string,
): Promise<AccountWrite> {
  const state = action === "ban" ? "banned" : "suspended";
  const fresh = await looseFrom(admin, "profiles")
    .update({ suspended_at: now, suspended_reason: suspendedReason, moderation_state: state })
    .eq("id", userId)
    .is("suspended_at", null)
    .in("moderation_state", ["active", "warned"])
    .select("id");
  if (fresh.error) throw new Error(fresh.error.message);
  if (rowsOf(fresh).length) {
    return { suspendedAt: now, moderationState: state, fresh: true, actedAt: now };
  }
  const wrote: AccountWrite = { fresh: false, actedAt: now };
  const fill = await looseFrom(admin, "profiles")
    .update({ suspended_at: now, suspended_reason: suspendedReason })
    .eq("id", userId)
    .is("suspended_at", null)
    .select("id");
  if (fill.error) throw new Error(fill.error.message);
  if (rowsOf(fill).length) wrote.suspendedAt = now;
  const raise = await looseFrom(admin, "profiles")
    .update({ moderation_state: state })
    .eq("id", userId)
    .in(
      "moderation_state",
      action === "ban" ? ["active", "warned", "suspended"] : ["active", "warned"],
    )
    .select("id");
  if (raise.error) throw new Error(raise.error.message);
  if (rowsOf(raise).length) wrote.moderationState = state;
  return wrote;
}

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
      "id, reported_id, subject_type, game_id, message_id, reel_id, reason, resolution_notes, reviewed_at";
    const { data: found, error: rErr } = await withPostIdIfPresent((withPostId) =>
      looseFrom(supabaseAdmin, "user_reports")
        .select(withPostId ? `${ACTION_COLUMNS}, post_id` : ACTION_COLUMNS)
        .eq("id", data.reportId)
        .maybeSingle(),
    );
    if (rErr) throw new Error(rErr.message);
    if (!found) throw new Error("Report not found");
    const report = found as ActionReport;
    const isPost = report.subject_type === "post";

    const reason = data.reason?.trim() || null;
    const now = new Date().toISOString();
    let summary = "";
    // What a post report's action wrote, recorded in its audit entry so Restore knows this report's own changes.
    const wrote: { hiddenAt?: string } & Partial<AccountWrite> = {};
    const targetId =
      report.subject_type === "game"
        ? report.game_id
        : report.subject_type === "message"
          ? report.message_id
          : report.subject_type === "reel"
            ? report.reel_id
            : isPost && report.post_id
              ? report.post_id
              : report.reported_id;

    if (data.action === "restore" && isPost) {
      // A post report (new with 20261205100000) undoes only its own actions, never what anyone else did, whether or not
      // the post still exists (post-restore.ts).
      const out = await restorePostReport(supabaseAdmin, report);
      summary = out.summary;
      let reportUpdated = false;
      if (out.updateReport) {
        // Only while the report is as Restore read it: an action another moderator took on it meanwhile stays its own.
        let q = looseFrom(supabaseAdmin, "user_reports")
          .update({
            status: "dismissed",
            reviewed_by: context.userId,
            reviewed_at: now,
            resolution_notes: [summary, reason].filter(Boolean).join(" — "),
          })
          .eq("id", data.reportId);
        q =
          report.reviewed_at === null
            ? q.is("reviewed_at", null)
            : q.eq("reviewed_at", report.reviewed_at);
        const res = await q.select("id");
        reportUpdated = !res.error && rowsOf(res).length > 0;
        if (res.error) summary = `${summary} ${RESTORE_REPORT_UPDATE_FAILED}`;
        else if (!reportUpdated) summary = `${summary} ${RESTORE_REPORT_CHANGED}`;
      }
      await audit(supabaseAdmin, context.userId, {
        action: MODERATION_AUDIT_ACTION.restore,
        targetType: report.subject_type,
        targetId,
        reason,
        before: { reportId: report.id, reportReason: report.reason },
        after: { summary, reportedUserId: report.reported_id },
        metadata: { restore: { lifted: out.lifted, reportUpdated } },
      });
      if (out.accountLift) {
        // The account lift on the user too, with what it cleared, so it is found under the user and not the post.
        await audit(supabaseAdmin, context.userId, {
          action: MODERATION_AUDIT_ACTION.restore,
          targetType: "user",
          targetId: report.reported_id,
          reason,
          before: { reportId: report.id, ...out.accountLift },
          after: { summary, reportedUserId: report.reported_id },
        });
      }
      return { ok: true, summary };
    }

    if (data.action === "warn") {
      if (isPost) {
        // A post report's Warn never lowers a suspension or ban to a warning.
        const res = await looseFrom(supabaseAdmin, "profiles")
          .update({ moderation_state: "warned" })
          .eq("id", report.reported_id)
          .in("moderation_state", ["active", "warned"]);
        if (res.error) throw new Error(res.error.message);
      } else {
        await supabaseAdmin
          .from("profiles")
          .update({ moderation_state: "warned" })
          .eq("id", report.reported_id);
      }
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
      } else if (isPost && report.post_id) {
        // The same hide the superadmin content queue uses (hidden_at, written with the service role), but only on a
        // post that is not hidden yet: a hide someone else made first stays theirs, and this report owns nothing.
        const res = await looseFrom(supabaseAdmin, "posts")
          .update({ hidden_at: now })
          .eq("id", report.post_id)
          .is("hidden_at", null)
          .select("id");
        if (res.error) throw new Error(res.error.message);
        if (rowsOf(res).length) {
          summary = POST_HIDDEN_SUMMARY;
          wrote.hiddenAt = now;
        } else {
          summary = POST_ALREADY_HIDDEN_SUMMARY;
        }
      } else {
        throw new Error("This report has no removable content attached");
      }
    }

    if (data.action === "suspend" || data.action === "ban") {
      const own = data.action === "ban" ? ACCOUNT_BANNED_SUMMARY : ACCOUNT_SUSPENDED_SUMMARY;
      const suspendedReason = reason ?? `Moderation action: ${data.action}`;
      if (isPost) {
        const account = await restrictPostAuthor(
          supabaseAdmin,
          report.reported_id,
          data.action,
          now,
          suspendedReason,
        );
        Object.assign(wrote, account);
        summary = account.fresh ? own : `${own}${ALREADY_RESTRICTED_NOTE}`;
      } else {
        await supabaseAdmin
          .from("profiles")
          .update({
            suspended_at: now,
            suspended_reason: suspendedReason,
            moderation_state: data.action === "ban" ? "banned" : "suspended",
          })
          .eq("id", report.reported_id);
        summary = own;
      }
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
      targetId,
      reason,
      before: { reportId: report.id, reportReason: report.reason },
      after: { summary, reportedUserId: report.reported_id, ...wrote },
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
