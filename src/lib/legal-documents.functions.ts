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

export type AdminLegalDocument = PublishedLegalDocument & {
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

async function assertAdmin(supabase: {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
}, userId: string) {
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
    return { id: row.id as string };
  });

export const adminUpdateLegalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => draftSchema.partial().extend({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("legal_documents").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminDeleteLegalDraft = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { error } = await context.supabase
      .from("legal_documents")
      .delete()
      .eq("id", data.id)
      .is("published_at", null);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminPublishLegalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { error } = await context.supabase.rpc("publish_legal_document", { _id: data.id });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const adminUnpublishLegalDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ id: z.string().uuid(), reason: z.string().trim().max(500).optional() }).parse(d),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { error } = await context.supabase.rpc("unpublish_legal_document", {
      _id: data.id,
      _reason: data.reason ?? null,
    });
    if (error) throw new Error(error.message);
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
