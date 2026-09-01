import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Audit log reads run through the caller's own Supabase session, so RLS
 * ("moderators and superadmins only") is the enforcement point. The explicit
 * role check below produces a clean error instead of an empty list.
 */
async function assertAuditReader(ctx: { supabase: any; userId: string }) {
  const { data, error } = await ctx.supabase.rpc("is_moderator", { _user_id: ctx.userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Admin access required");
}

async function assertAuditExporter(ctx: { supabase: any; userId: string }) {
  const [admin, superadmin] = await Promise.all([
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
    ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "superadmin" }),
  ]);
  if (admin.data !== true && superadmin.data !== true)
    throw new Error("Admin access required to export audit history");
}

export type AuditLogEntry = {
  id: string;
  createdAt: string;
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  summary: string | null;
  before: unknown;
  after: unknown;
  metadata: unknown;
};

const filterSchema = z.object({
  search: z.string().trim().max(200).optional(),
  actions: z.array(z.string().max(80)).max(40).optional(),
  targetType: z.string().max(60).optional(),
  actorId: z.string().uuid().optional(),
  /** Inclusive calendar day bounds, YYYY-MM-DD. */
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

export type AuditLogFilters = z.infer<typeof filterSchema>;

const SELECT =
  "id, created_at, actor_id, action, target_type, target_id, reason, before, after, metadata";

function escapeOr(term: string) {
  return term.replace(/[%,()]/g, " ").trim();
}

function applyFilters(query: any, f: AuditLogFilters) {
  let q = query;
  if (f.actions?.length) q = q.in("action", f.actions);
  if (f.targetType) q = q.eq("target_type", f.targetType);
  if (f.actorId) q = q.eq("actor_id", f.actorId);
  if (f.from) q = q.gte("created_at", `${f.from}T00:00:00.000Z`);
  if (f.to) q = q.lte("created_at", `${f.to}T23:59:59.999Z`);
  const search = escapeOr(f.search ?? "");
  if (search) {
    q = q.or(
      [
        `action.ilike.%${search}%`,
        `target_type.ilike.%${search}%`,
        `target_id.ilike.%${search}%`,
        `reason.ilike.%${search}%`,
      ].join(","),
    );
  }
  return q;
}

async function actorNames(supabase: any, rows: any[]) {
  const ids = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean))) as string[];
  if (!ids.length) return new Map<string, string>();
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", ids);
  return new Map<string, string>(
    (data ?? []).map((p: any) => [String(p.id), String(p.display_name ?? "Unknown admin")]),
  );
}

function toEntry(r: any, names: Map<string, string>): AuditLogEntry {
  return {
    id: r.id,
    createdAt: r.created_at,
    actorId: r.actor_id,
    actorName: r.actor_id ? (names.get(r.actor_id) ?? "Unknown admin") : "System",
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    reason: r.reason,
    summary: (r.after as any)?.summary ?? null,
    before: r.before,
    after: r.after,
    metadata: r.metadata ?? {},
  };
}

/** Filtered, paginated audit history (moderators, admins, superadmins). */
export const listAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filterSchema.parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await assertAuditReader(context);
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;
    const base = context.supabase
      .from("admin_audit_log")
      .select(SELECT, { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    const { data: rows, count, error } = await applyFilters(base, data);
    if (error) throw new Error(error.message);
    const names = await actorNames(context.supabase, rows ?? []);
    return {
      entries: (rows ?? []).map((r: any) => toEntry(r, names)),
      total: count ?? 0,
      limit,
      offset,
    };
  });

/** Distinct actions, target types and admins present in the log, for filters. */
export const auditLogFacets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAuditReader(context);
    const { data, error } = await context.supabase.rpc("admin_audit_log_facets");
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { kind: string; value: string; label: string; uses: number }[];
    const pick = (kind: string) =>
      rows
        .filter((r) => r.kind === kind)
        .map((r) => ({ value: r.value, label: r.label, uses: Number(r.uses) }))
        .sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label));
    return { actions: pick("action"), targetTypes: pick("target_type"), actors: pick("actor") };
  });

function csvCell(v: unknown) {
  const s =
    v === null || v === undefined
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** CSV export of the current filter selection (admins and superadmins only). */
export const exportAuditLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => filterSchema.omit({ limit: true, offset: true }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    await assertAuditReader(context);
    await assertAuditExporter(context);
    const base = context.supabase
      .from("admin_audit_log")
      .select(SELECT)
      .order("created_at", { ascending: false })
      .limit(5000);
    const { data: rows, error } = await applyFilters(base, data);
    if (error) throw new Error(error.message);
    const names = await actorNames(context.supabase, rows ?? []);
    const header = [
      "created_at",
      "admin",
      "admin_id",
      "action",
      "target_type",
      "target_id",
      "reason",
      "before",
      "after",
      "metadata",
    ];
    const lines = [header.join(",")];
    for (const r of rows ?? []) {
      const e = toEntry(r, names);
      lines.push(
        [
          e.createdAt,
          e.actorName,
          e.actorId,
          e.action,
          e.targetType,
          e.targetId,
          e.reason,
          e.before,
          e.after,
          e.metadata,
        ]
          .map(csvCell)
          .join(","),
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { logAdminAction } = await import("@/lib/audit-log.server");
    await logAdminAction(supabaseAdmin as never, context.userId, {
      action: "security.audit_export",
      targetType: "audit_log",
      metadata: { rows: rows?.length ?? 0, filters: data },
    });

    return { csv: lines.join("\n"), rows: rows?.length ?? 0 };
  });
