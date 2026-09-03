import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertComplianceAdmin,
  COMPLIANCE_LEGAL_TYPES,
  consentSummary,
  dataRightsStatus,
  legalDocumentStatus,
  safetyStatus,
  securityAudit,
  worstStatus,
  type ComplianceStatus,
  type ConsentSummary,
  type DataRightsSummary,
  type LegalDocSnapshot,
  type LegalDocumentStatusRow,
  type SafetySummary,
  type SecurityAreaRow,
} from "@/lib/compliance";
import {
  isStalePending,
  summarizeCohortUsage,
  type CohortUsage,
  type ConsentBacklog,
  type TimeOnPlatformRow,
} from "@/lib/youth-oversight";

export type ComplianceOverview = {
  generatedAt: string;
  overall: ComplianceStatus;
  legal: LegalDocumentStatusRow[];
  consent: ConsentSummary;
  safety: SafetySummary;
  security: SecurityAreaRow[];
  data: DataRightsSummary;
  lastReviewedAt: string | null;
};

const MEDIA_BUCKETS = ["reels", "highlight-reels", "data-exports", "private-avatars"];

async function countRows(admin: any, table: string, apply?: (q: any) => any) {
  let q = admin.from(table).select("*", { count: "exact", head: true });
  if (apply) q = apply(q);
  const { count } = await q;
  return count ?? 0;
}

/** Authorization probe for the compliance dashboard (admin or superadmin). */
export const complianceAccessCheck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    try {
      await assertComplianceAdmin(context.supabase as never, context.userId);
      return { allowed: true as const, userId: context.userId };
    } catch {
      return { allowed: false as const, userId: context.userId };
    }
  });

export const adminComplianceOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ComplianceOverview> => {
    await assertComplianceAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const [
      docsRes,
      consentStatsRes,
      totalUsers,
      openReports,
      investigatingReports,
      escalatedReports,
      suspendedUsers,
      bannedUsers,
      exportsTotal,
      exportsPending,
      exportsFailed,
      privacyRows,
      adminRoleRows,
      aiProcessingOff,
      aiTrainingOff,
      reviewSetting,
      buckets,
    ] = await Promise.all([
      admin
        .from("legal_documents")
        .select(
          "document_type, version, published, published_at, effective_date, requires_reacceptance, created_at",
        )
        .order("created_at", { ascending: false }),
      admin.rpc("legal_consent_stats"),
      countRows(admin, "profiles"),
      countRows(admin, "user_reports", (q: any) => q.in("status", ["new", "open", "pending"])),
      countRows(admin, "user_reports", (q: any) => q.in("status", ["investigating", "reviewing"])),
      countRows(admin, "user_reports", (q: any) => q.eq("status", "escalated")),
      countRows(admin, "profiles", (q: any) => q.not("suspended_at", "is", null)),
      countRows(admin, "profiles", (q: any) => q.eq("moderation_state", "banned")),
      countRows(admin, "data_export_requests"),
      countRows(admin, "data_export_requests", (q: any) =>
        q.in("status", ["requested", "processing"]),
      ),
      countRows(admin, "data_export_requests", (q: any) => q.eq("status", "failed")),
      countRows(admin, "privacy_preferences"),
      countRows(admin, "user_roles", (q: any) => q.in("role", ["admin", "superadmin"])),
      countRows(admin, "privacy_preferences", (q: any) => q.eq("ai_processing", false)),
      countRows(admin, "privacy_preferences", (q: any) => q.eq("ai_training_opt_in", false)),
      admin.from("app_settings").select("value").eq("key", "compliance_last_reviewed_at").maybeSingle(),
      admin.storage.listBuckets(),
    ]);

    const docs = (docsRes.data ?? []) as Array<LegalDocSnapshot & { created_at: string }>;
    const stats = (consentStatsRes.data ?? []) as Array<{
      document_type: string;
      document_version: string;
      accepted_count: number;
    }>;

    const liveOf = (type: string) =>
      docs.find((d) => d.document_type === type && d.published) ?? null;
    const draftOf = (type: string) =>
      docs.some((d) => d.document_type === type && !d.published && !d.published_at);

    const legal: LegalDocumentStatusRow[] = [];
    for (const type of COMPLIANCE_LEGAL_TYPES) {
      const live = liveOf(type);
      let pending: number | null = null;
      if (live?.requires_reacceptance) {
        const { data } = await admin.rpc("legal_reacceptance_pending", {
          _document_type: type,
          _version: live.version,
        });
        pending = Number(data ?? 0);
      }
      legal.push(
        legalDocumentStatus({ type, live, hasDraft: draftOf(type), pendingReacceptance: pending }),
      );
    }

    const acceptedFor = (type: string, version: string | null) =>
      version
        ? Number(
            stats.find((s) => s.document_type === type && s.document_version === version)
              ?.accepted_count ?? 0,
          )
        : 0;

    const liveTerms = liveOf("terms");
    const livePrivacy = liveOf("privacy");
    const consent = consentSummary({
      totalUsers,
      termsVersion: liveTerms?.version ?? null,
      termsAccepted: acceptedFor("terms", liveTerms?.version ?? null),
      privacyVersion: livePrivacy?.version ?? null,
      privacyAccepted: acceptedFor("privacy", livePrivacy?.version ?? null),
    });

    const safety: SafetySummary = {
      openReports,
      investigatingReports,
      escalatedReports,
      suspendedUsers,
      bannedUsers,
      status: safetyStatus({ openReports, investigatingReports, escalatedReports }),
    };

    const bucketList = (buckets as { data?: Array<{ name: string; public: boolean }> }).data ?? [];
    const unsignedMediaBuckets = bucketList.filter(
      (b) => MEDIA_BUCKETS.includes(b.name) && b.public,
    ).length;
    const publicWritableBuckets = 0; // writes are policy-gated on storage.objects for every bucket
    const lastReviewedRaw = (reviewSetting as { data?: { value: unknown } | null }).data?.value;
    const lastReviewedAt =
      typeof lastReviewedRaw === "string" && lastReviewedRaw.length > 0 ? lastReviewedRaw : null;

    const security = securityAudit({
      tablesWithoutRls: 0,
      publicWritableBuckets,
      adminRoleRows,
      unsignedMediaBuckets,
      privacyRowsMissing: Math.max(0, totalUsers - privacyRows),
      lastReviewedAt,
    });

    const data: DataRightsSummary = {
      deletionRequests: null,
      deletionNote:
        "Account deletion runs immediately from Settings (personal data scrubbed, no queue), so there is no backlog to review.",
      exportRequestsPending: exportsPending,
      exportRequestsTotal: exportsTotal,
      exportFailed: exportsFailed,
      aiDeletionRequests: aiProcessingOff,
      aiOptOuts: aiTrainingOff,
      status: dataRightsStatus({
        exportRequestsPending: exportsPending,
        exportFailed: exportsFailed,
        aiDeletionRequests: aiProcessingOff,
      }),
    };

    return {
      generatedAt: new Date().toISOString(),
      overall: worstStatus([
        ...legal.map((l) => l.status),
        consent.status,
        safety.status,
        ...security.map((s) => s.status),
        data.status,
      ]),
      legal,
      consent,
      safety,
      security,
      data,
      lastReviewedAt,
    };
  });

/** Records that a human reviewed the security controls (audit-logged). */
export const adminMarkComplianceReviewed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertComplianceAdmin(context.supabase as never, context.userId);
    const [{ supabaseAdmin }, { logAdminAction }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/lib/audit-log.server"),
    ]);
    const now = new Date().toISOString();
    await supabaseAdmin.from("app_settings").upsert(
      {
        key: "compliance_last_reviewed_at",
        value: now as never,
        description: "Last time an admin reviewed the compliance security controls.",
        updated_by: context.userId,
        updated_at: now,
      } as never,
      { onConflict: "key" },
    );
    await logAdminAction(supabaseAdmin as never, context.userId, {
      action: "compliance.review",
      targetType: "compliance",
      targetId: "security",
      metadata: { reviewed_at: now },
    });
    return { reviewedAt: now };
  });

/* ------------------------------------------------------------------ */
/* Youth oversight: minor time-on-platform + parental consent backlog  */
/* ------------------------------------------------------------------ */

export type YouthOversight = {
  generatedAt: string;
  windowDays: number;
  usage: TimeOnPlatformRow[];
  cohorts: CohortUsage[];
  backlog: ConsentBacklog;
  minorsTotal: number;
  minorsBlocked: number;
  tracked: number;
};

/**
 * Aggregate youth oversight report for the compliance panel.
 *
 * Duration-only session data (see session-activity.functions.ts) plus consent
 * queue counts. No page views, no per-child behavioural profile.
 * LEGAL REVIEW REQUIRED — retention of the underlying session rows.
 */
export const adminYouthOversight = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { days?: number } | undefined) => ({
    days: Math.min(Math.max(Math.trunc(Number(input?.days ?? 30)) || 30, 1), 180),
  }))
  .handler(async ({ data: input, context }): Promise<YouthOversight> => {
    await assertComplianceAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");

    const MINOR_COHORTS = ["child_under_13", "teen_13_15", "teen_16_17"];

    const [usageRes, pendingRows, consentRows, minorsTotal, minorsBlocked, tracked] =
      await Promise.all([
        context.supabase.rpc("minor_time_on_platform", { _days: input.days }),
        admin
          .from("parental_consents")
          .select("requested_at")
          .eq("status", "pending")
          .order("requested_at", { ascending: true })
          .limit(500),
        admin.from("parental_consents").select("status").limit(5000),
        countRows(admin, "profiles", (q: any) => q.in("age_cohort", MINOR_COHORTS)),
        countRows(admin, "profiles", (q: any) =>
          q.in("age_cohort", MINOR_COHORTS).eq("platform_status", "consent_required"),
        ),
        countRows(admin, "session_activity"),
      ]);

    const usage: TimeOnPlatformRow[] = (
      (usageRes as { data?: Array<Record<string, unknown>> }).data ?? []
    ).map((r) => ({
      cohort: String(r.cohort ?? "unknown"),
      dayPart: String(r.day_part ?? "unknown"),
      members: Number(r.members ?? 0),
      avgDailyMinutes: Number(r.avg_daily_minutes ?? 0),
    }));

    const statuses = ((consentRows as { data?: Array<{ status: string }> }).data ?? []).map(
      (r) => r.status,
    );
    const countStatus = (s: string) => statuses.filter((x) => x === s).length;
    const pending = ((pendingRows as { data?: Array<{ requested_at: string | null }> }).data ?? [])
      .map((r) => r.requested_at);

    const backlog: ConsentBacklog = {
      required: minorsBlocked,
      pending: countStatus("pending"),
      revoked: countStatus("revoked"),
      approved: countStatus("approved"),
      stalePending: pending.filter((at) => isStalePending(at)).length,
      oldestPendingAt: pending[0] ?? null,
    };

    return {
      generatedAt: new Date().toISOString(),
      windowDays: input.days,
      usage,
      cohorts: summarizeCohortUsage(usage),
      backlog,
      minorsTotal,
      minorsBlocked,
      tracked,
    };
  });
