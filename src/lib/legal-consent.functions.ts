import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ConsentRecord, LegalDocumentType } from "@/lib/legal-documents";

const typeSchema = z.enum(["terms", "privacy"]);

/** The signed-in user's full consent history (newest first). */
export const getMyLegalConsents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ConsentRecord[]> => {
    const { data, error } = await context.supabase
      .from("legal_consents")
      .select("document_type, document_version, accepted_at")
      .eq("user_id", context.userId)
      .order("accepted_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as ConsentRecord[];
  });

/**
 * Records explicit acceptance of one or more documents at a specific version.
 * Re-accepting the same version is a no-op (unique constraint + upsert), so
 * retries never duplicate rows and nothing is ever accepted implicitly.
 */
export const recordLegalConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { acceptances: { type: LegalDocumentType; version: string }[] }) =>
    z
      .object({
        acceptances: z
          .array(z.object({ type: typeSchema, version: z.string().min(1).max(64) }))
          .min(1)
          .max(10),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    let userAgent: string | null = null;
    try {
      userAgent = getRequest().headers.get("user-agent")?.slice(0, 500) ?? null;
    } catch {
      /* no request context */
    }
    const rows = data.acceptances.map((a) => ({
      user_id: context.userId,
      document_type: a.type,
      document_version: a.version,
      accepted_at: new Date().toISOString(),
      user_agent: userAgent,
    }));
    const { error } = await context.supabase.from("legal_consents").upsert(rows, {
      onConflict: "user_id,document_type,document_version",
      ignoreDuplicates: true,
    });
    if (error) throw new Error(error.message);
    return { ok: true, recorded: rows.length };
  });

/** Admin-only acceptance statistics per document version. */
export const getLegalConsentStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("legal_consent_stats");
    if (error) throw new Error(error.message);
    return (data ?? []) as {
      document_type: LegalDocumentType;
      document_version: string;
      accepted_count: number;
      latest_accepted_at: string | null;
    }[];
  });
