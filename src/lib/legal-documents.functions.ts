import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { MANAGED_LEGAL_TYPES } from "@/lib/legal-catalog";
import type { PublishedLegalDocument } from "@/lib/legal-documents";

const PUBLIC_COLUMNS =
  "id, document_type, title, version, content, summary, requires_reacceptance, effective_date, published, published_at, archived_at";
const ADMIN_COLUMNS = `${PUBLIC_COLUMNS}, created_by, created_at, updated_at`;

const typeSchema = z.enum(MANAGED_LEGAL_TYPES);

/**
 * Public read: the live published version of each document plus previously
 * published versions (history). Drafts are never returned — RLS enforces it.
 */
export const getPublishedLegalDocuments = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublishedLegalDocument[]> => {
    const supabase = createClient<Database>(
      process.env["SUPABASE_URL"]!,
      process.env["SUPABASE_PUBLISHABLE_KEY"]!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase
      .from("legal_documents")
      .select(PUBLIC_COLUMNS)
      .not("published_at", "is", null)
      .order("effective_date", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PublishedLegalDocument[];
  },
);

/**
 * Loader for informational legal pages. The published rows only supply the
 * version history and any newer text; the document itself is bundled, and
 * `effectiveVersion` already falls back to that when nothing is published. So
 * a failed fetch must not fail the route — these pages have to stay readable.
 */
export async function loadPublishedLegalDocuments(): Promise<{
  published: PublishedLegalDocument[];
}> {
  try {
    return { published: await getPublishedLegalDocuments() };
  } catch {
    return { published: [] };
  }
}

export type AdminLegalDocument = PublishedLegalDocument & {
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Append an entry to the admin audit log for a legal-document change. */
async function auditLegal(
  actorId: string,
  entry: {
    action:
      | "legal.draft_create"
      | "legal.draft_update"
      | "legal.draft_delete"
      | "legal.publish"
      | "legal.unpublish";
    targetId?: string | null;
    reason?: string | null;
    before?: unknown;
    after?: unknown;
    metadata?: Record<string, unknown>;
  },
) {
  const [{ supabaseAdmin }, { logAdminAction }] = await Promise.all([
    import("@/integrations/supabase/client.server"),
    import("@/lib/audit-log.server"),
  ]);
  await logAdminAction(supabaseAdmin as never, actorId, {
    action: entry.action,
    targetType: "legal_document",
    targetId: entry.targetId ?? null,
    reason: entry.reason ?? null,
    before: entry.before,
    after: entry.after,
    metadata: entry.metadata,
  });
}

async function assertAdmin(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  },
  userId: string,
) {
  const [admin, superadmin] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("has_role", { _user_id: userId, _role: "superadmin" }),
  ]);
  if (admin.data !== true && superadmin.data !== true) throw new Error("Admin access required");
}

/** Every version of every document, newest first (admin only). */
export const adminListLegalDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminLegalDocument[]> => {
    await assertAdmin(context.supabase as never, context.userId);
    const { data, error } = await context.supabase
      .from("legal_documents")
      .select(ADMIN_COLUMNS)
      .order("document_type", { ascending: true })
      .order("effective_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as AdminLegalDocument[];
  });

const draftSchema = z.object({
  document_type: typeSchema,
  title: z.string().trim().min(1).max(200),
  version: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/, "Use letters, numbers, dots, dashes or underscores"),
  content: z.string().trim().min(1).max(200_000),
  summary: z.string().trim().max(1000).default(""),
  requires_reacceptance: z.boolean().default(false),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const adminCreateLegalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => draftSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { data: row, error } = await context.supabase
      .from("legal_documents")
      .insert({ ...data, published: false, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    await auditLegal(context.userId, {
      action: "legal.draft_create",
      targetId: row.id as string,
      after: {
        document_type: data.document_type,
        version: data.version,
        effective_date: data.effective_date,
        requires_reacceptance: data.requires_reacceptance,
      },
      metadata: { contentLength: data.content.length },
    });
    return { id: row.id as string };
  });

export const adminUpdateLegalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => draftSchema.partial().extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { id, ...patch } = data;
    const { data: before } = await context.supabase
      .from("legal_documents")
      .select("document_type, version, effective_date, requires_reacceptance, published")
      .eq("id", id)
      .maybeSingle();
    const { error } = await context.supabase.from("legal_documents").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    const { content: _content, ...changed } = patch;
    await auditLegal(context.userId, {
      action: "legal.draft_update",
      targetId: id,
      before,
      after: changed,
      metadata: _content ? { contentLength: _content.length } : {},
    });
    return { ok: true };
  });

export const adminDeleteLegalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { data: before } = await context.supabase
      .from("legal_documents")
      .select("document_type, version, effective_date")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase
      .from("legal_documents")
      .delete()
      .eq("id", data.id)
      .is("published_at", null);
    if (error) throw new Error(error.message);
    await auditLegal(context.userId, {
      action: "legal.draft_delete",
      targetId: data.id,
      before,
    });
    return { ok: true };
  });

export const adminPublishLegalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { data: doc } = await context.supabase
      .from("legal_documents")
      .select("document_type, version, effective_date, requires_reacceptance")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.rpc("publish_legal_document", { _id: data.id });
    if (error) throw new Error(error.message);
    await auditLegal(context.userId, {
      action: "legal.publish",
      targetId: data.id,
      after: doc,
      metadata: { materialChange: doc?.requires_reacceptance === true },
    });
    return { ok: true };
  });

export const adminUnpublishLegalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { data: doc } = await context.supabase
      .from("legal_documents")
      .select("document_type, version, effective_date")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.rpc("unpublish_legal_document", {
      _id: data.id,
      _reason: data.reason ?? undefined,
    });
    if (error) throw new Error(error.message);
    await auditLegal(context.userId, {
      action: "legal.unpublish",
      targetId: data.id,
      reason: data.reason ?? null,
      before: doc,
    });
    return { ok: true };
  });

/** How many accounts have not yet accepted a given document version. */
export const adminLegalReacceptancePending = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ document_type: typeSchema, version: z.string().min(1).max(64) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { data: count, error } = await context.supabase.rpc("legal_reacceptance_pending", {
      _document_type: data.document_type,
      _version: data.version,
    });
    if (error) throw new Error(error.message);
    return { pending: Number(count ?? 0) };
  });
