/**
 * Server-only helpers for the superadmin control center.
 * Never import this from client code — it is loaded inside server-fn handlers.
 */

export type SuperadminCtx = { supabase: any; userId: string };

export async function assertSuperadmin(ctx: SuperadminCtx) {
  const { data, error } = await ctx.supabase.rpc("is_superadmin", {
    _user_id: ctx.userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export async function getAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function writeAudit(
  admin: any,
  actorId: string,
  entry: {
    action: string;
    targetType: string;
    targetId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  const { logAdminAction } = await import("@/lib/audit-log.server");
  await logAdminAction(admin, actorId, entry as never);
}

/** Content kinds the moderation tab can act on. */
export const CONTENT_KINDS = {
  games: {
    table: "hosted_games",
    idCol: "id",
    label: "Game",
    select:
      "id, title, sport, date, location, host_id, status, joined, max_players, joins_closed, is_private, hidden_at, created_at",
    searchCols: ["title", "location", "sport", "neighborhood"],
    orderBy: "created_at",
    hideCol: "hidden_at",
  },
  teams: {
    table: "teams",
    idCol: "id",
    label: "Team / trainer",
    select: "id, name, handle, kind, city, owner_id, verified, hidden_at, created_at",
    searchCols: ["name", "handle", "city"],
    orderBy: "created_at",
    hideCol: "hidden_at",
  },
  gyms: {
    table: "trainer_orgs",
    idCol: "id",
    label: "Gym / organization",
    select: "id, name, handle, city, owner_id, verified, category, hidden_at, created_at",
    searchCols: ["name", "handle", "city"],
    orderBy: "created_at",
    hideCol: "hidden_at",
  },
  posts: {
    table: "team_posts",
    idCol: "id",
    label: "Team post",
    select:
      "id, team_id, author_id, kind, title, body, pinned, hidden_at, moderation_status, created_at",
    searchCols: ["title", "body"],
    orderBy: "created_at",
    hideCol: "hidden_at",
    textStatusCol: "moderation_status",
  },
  availability: {
    table: "player_availabilities",
    idCol: "id",
    label: "Availability post",
    select: "id, user_id, sports, skill_level, city, status, note, hidden_at, created_at",
    searchCols: ["city", "note", "skill_level"],
    orderBy: "created_at",
    hideCol: "hidden_at",
  },
  comments: {
    table: "post_comments",
    idCol: "id",
    label: "Comment",
    select:
      "id, subject_type, subject_id, author_id, body, hidden_at, deleted_at, moderation_status, created_at",
    searchCols: ["body"],
    orderBy: "created_at",
    hideCol: "hidden_at",
    textStatusCol: "moderation_status",
  },
  reviews: {
    table: "reviews",
    idCol: "id",
    label: "Review",
    select:
      "id, reviewer_id, reviewee_kind, reviewee_id, reviewee_name, rating, title, body, flagged, verified, created_at",
    searchCols: ["title", "body", "reviewee_name"],
    orderBy: "created_at",
    hideCol: "flagged",
  },
  reports: {
    table: "user_reports",
    idCol: "id",
    label: "User report",
    select: "id, reporter_id, reported_id, reason, details, status, created_at",
    searchCols: ["reason", "details"],
    orderBy: "created_at",
    hideCol: null,
  },
  blocks: {
    table: "user_blocks",
    idCol: "id",
    label: "Block",
    select: "id, blocker_id, blocked_id, created_at",
    searchCols: [],
    orderBy: "created_at",
    hideCol: null,
  },
  messages: {
    table: "messages",
    idCol: "id",
    label: "Message",
    select: "id, conversation_id, sender_id, body, is_request, deleted_at, created_at",
    searchCols: ["body"],
    orderBy: "created_at",
    hideCol: null,
  },
} as const;

export type ContentKind = keyof typeof CONTENT_KINDS;

export function contentConfig(kind: string) {
  const cfg = (CONTENT_KINDS as Record<string, any>)[kind];
  if (!cfg) throw new Error(`Unknown content kind: ${kind}`);
  return cfg;
}

export function buildOrFilter(cols: readonly string[], search: string) {
  const safe = search.replace(/[%,()]/g, " ").trim();
  if (!safe || cols.length === 0) return null;
  return cols.map((c) => `${c}.ilike.%${safe}%`).join(",");
}

/** Profile fields a superadmin may edit. */
export const EDITABLE_PROFILE_FIELDS = [
  "display_name",
  "username",
  "bio",
  "city",
  "sport",
  "account_type",
  "avatar_url",
  "cover_url",
  "graduating_class",
  "search_radius_mi",
] as const;

export async function countRows(admin: any, table: string, apply?: (q: any) => any) {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (apply) q = apply(q);
  const { count } = await q;
  return count ?? 0;
}
