/**
 * Compliance-readiness model for Admin → Compliance.
 *
 * IMPORTANT: nothing in this module ever asserts that the product is
 * "legally compliant". Every check reports a readiness status only, and the
 * dashboard renders the disclaimer below.
 */

import { MANAGED_LEGAL_META, type ManagedLegalType } from "@/lib/legal-catalog";

export const COMPLIANCE_STATUSES = [
  "implemented",
  "needs_review",
  "action_required",
  "legal_review_required",
] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

export const COMPLIANCE_STATUS_META: Record<
  ComplianceStatus,
  { label: string; tone: "ok" | "warn" | "danger" | "info" }
> = {
  implemented: { label: "Implemented", tone: "ok" },
  needs_review: { label: "Needs Review", tone: "warn" },
  action_required: { label: "Action Required", tone: "danger" },
  legal_review_required: { label: "Legal Review Required", tone: "info" },
};

export const COMPLIANCE_DISCLAIMER =
  "This is a compliance-readiness tool. It tracks whether controls are implemented and reviewed — it is not a legal opinion and does not certify compliance. Have qualified counsel review every policy before launch.";

export function complianceStatusLabel(status: ComplianceStatus): string {
  return COMPLIANCE_STATUS_META[status].label;
}

/* ------------------------------------------------------------------ *
 * Authorization
 * ------------------------------------------------------------------ */

type RpcClient = {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
};

/**
 * Server-side authorization for every compliance read. Admins and
 * superadmins pass; everyone else is rejected. Roles are read through
 * `has_role`/`is_superadmin` (security definer), never from client input.
 */
export async function assertComplianceAdmin(supabase: RpcClient, userId: string): Promise<void> {
  const [admin, superadmin] = await Promise.all([
    supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
    supabase.rpc("is_superadmin", { _user_id: userId }),
  ]);
  if (admin.error) throw new Error(admin.error.message);
  if (superadmin.error) throw new Error(superadmin.error.message);
  if (admin.data !== true && superadmin.data !== true) {
    throw new Error("Admin access required");
  }
}

/* ------------------------------------------------------------------ *
 * Legal documents
 * ------------------------------------------------------------------ */

/** Document slots surfaced on the dashboard, in display order. */
export const COMPLIANCE_LEGAL_TYPES: ManagedLegalType[] = [
  "terms",
  "privacy",
  "community_guidelines",
  "safety_guidelines",
  "payment_policy",
  "ai_disclosure",
  "youth_policy",
];

export type LegalDocumentStatusRow = {
  type: ManagedLegalType;
  label: string;
  version: string | null;
  publishedAt: string | null;
  effectiveDate: string | null;
  requiresReacceptance: boolean;
  pendingReacceptance: number | null;
  hasDraft: boolean;
  status: ComplianceStatus;
  note: string;
};

export type LegalDocSnapshot = {
  document_type: string;
  version: string;
  published: boolean;
  published_at: string | null;
  effective_date: string | null;
  requires_reacceptance: boolean;
};

/**
 * Readiness of one document slot:
 * - no published version → Action Required
 * - published but users still owe re-acceptance → Needs Review
 * - published with a newer unpublished draft → Legal Review Required
 * - otherwise → Implemented
 */
export function legalDocumentStatus(input: {
  type: ManagedLegalType;
  live: LegalDocSnapshot | null;
  hasDraft: boolean;
  pendingReacceptance?: number | null;
}): LegalDocumentStatusRow {
  const meta = MANAGED_LEGAL_META[input.type];
  const pending = input.pendingReacceptance ?? null;
  let status: ComplianceStatus = "implemented";
  let note = "Published version is live.";

  if (!input.live) {
    status = "action_required";
    note = "No published version. Users have nothing to read or accept.";
  } else if (input.live.requires_reacceptance && (pending ?? 0) > 0) {
    status = "needs_review";
    note = `${pending} account${pending === 1 ? "" : "s"} have not accepted this version yet.`;
  } else if (input.hasDraft) {
    status = "legal_review_required";
    note = "A newer draft is waiting on review before publishing.";
  }

  return {
    type: input.type,
    label: meta.label,
    version: input.live?.version ?? null,
    publishedAt: input.live?.published_at ?? null,
    effectiveDate: input.live?.effective_date ?? null,
    requiresReacceptance: input.live?.requires_reacceptance ?? meta.requiresConsent,
    pendingReacceptance: pending,
    hasDraft: input.hasDraft,
    status,
    note,
  };
}

/* ------------------------------------------------------------------ *
 * Consent
 * ------------------------------------------------------------------ */

export type ConsentSummary = {
  totalUsers: number;
  termsVersion: string | null;
  termsAccepted: number;
  privacyVersion: string | null;
  privacyAccepted: number;
  pendingAcceptance: number;
  status: ComplianceStatus;
};

export function consentSummary(input: {
  totalUsers: number;
  termsVersion: string | null;
  termsAccepted: number;
  privacyVersion: string | null;
  privacyAccepted: number;
}): ConsentSummary {
  const pendingTerms = Math.max(0, input.totalUsers - input.termsAccepted);
  const pendingPrivacy = Math.max(0, input.totalUsers - input.privacyAccepted);
  const pendingAcceptance = Math.max(pendingTerms, pendingPrivacy);
  let status: ComplianceStatus = "implemented";
  if (!input.termsVersion || !input.privacyVersion) status = "action_required";
  else if (pendingAcceptance > 0) status = "needs_review";
  return {
    totalUsers: input.totalUsers,
    termsVersion: input.termsVersion,
    termsAccepted: input.termsAccepted,
    privacyVersion: input.privacyVersion,
    privacyAccepted: input.privacyAccepted,
    pendingAcceptance,
    status,
  };
}

/* ------------------------------------------------------------------ *
 * Safety
 * ------------------------------------------------------------------ */

export type SafetySummary = {
  openReports: number;
  investigatingReports: number;
  escalatedReports: number;
  suspendedUsers: number;
  bannedUsers: number;
  status: ComplianceStatus;
};

export function safetyStatus(input: {
  openReports: number;
  investigatingReports: number;
  escalatedReports: number;
}): ComplianceStatus {
  if (input.escalatedReports > 0) return "action_required";
  if (input.openReports > 0 || input.investigatingReports > 0) return "needs_review";
  return "implemented";
}

/* ------------------------------------------------------------------ *
 * Security audit areas
 * ------------------------------------------------------------------ */

export const SECURITY_AREAS = [
  "rls",
  "storage",
  "admin_authorization",
  "private_media",
  "sensitive_data_access",
] as const;
export type SecurityArea = (typeof SECURITY_AREAS)[number];

export type SecurityAreaRow = {
  area: SecurityArea;
  label: string;
  description: string;
  status: ComplianceStatus;
  evidence: string;
};

export const SECURITY_AREA_META: Record<SecurityArea, { label: string; description: string }> = {
  rls: {
    label: "Row Level Security",
    description: "Every table in the app schema has RLS on with owner-scoped policies.",
  },
  storage: {
    label: "Storage policies",
    description: "Uploads are ownership-checked per bucket path; no blanket write access.",
  },
  admin_authorization: {
    label: "Admin authorization",
    description: "Admin reads and writes verify roles server-side via security-definer checks.",
  },
  private_media: {
    label: "Private media",
    description: "Reels, exports and private avatars are served through short-lived signed URLs.",
  },
  sensitive_data_access: {
    label: "Sensitive data access",
    description: "Birthdays, precise location and contact details are gated by privacy settings.",
  },
};

/**
 * Turns live signals into per-area readiness. Anything we cannot verify
 * automatically stays at "Needs Review" rather than claiming success.
 */
export function securityAudit(signals: {
  tablesWithoutRls: number;
  publicWritableBuckets: number;
  adminRoleRows: number;
  unsignedMediaBuckets: number;
  privacyRowsMissing: number;
  lastReviewedAt?: string | null;
}): SecurityAreaRow[] {
  const stale = !signals.lastReviewedAt;
  const row = (
    area: SecurityArea,
    ok: boolean,
    evidence: string,
    failStatus: ComplianceStatus = "action_required",
  ): SecurityAreaRow => ({
    area,
    label: SECURITY_AREA_META[area].label,
    description: SECURITY_AREA_META[area].description,
    status: ok ? (stale ? "needs_review" : "implemented") : failStatus,
    evidence,
  });

  return [
    row(
      "rls",
      signals.tablesWithoutRls === 0,
      signals.tablesWithoutRls === 0
        ? "All app tables report RLS enabled."
        : `${signals.tablesWithoutRls} table(s) without RLS.`,
    ),
    row(
      "storage",
      signals.publicWritableBuckets === 0,
      signals.publicWritableBuckets === 0
        ? "No bucket allows unrestricted writes."
        : `${signals.publicWritableBuckets} bucket(s) allow unrestricted writes.`,
    ),
    row(
      "admin_authorization",
      signals.adminRoleRows > 0,
      signals.adminRoleRows > 0
        ? `${signals.adminRoleRows} role grant(s) recorded; every admin call re-checks roles server-side.`
        : "No admin role grants found — admin surfaces would be unreachable.",
    ),
    row(
      "private_media",
      signals.unsignedMediaBuckets === 0,
      signals.unsignedMediaBuckets === 0
        ? "Reel, export and private-avatar buckets are private."
        : `${signals.unsignedMediaBuckets} media bucket(s) are publicly readable.`,
    ),
    row(
      "sensitive_data_access",
      signals.privacyRowsMissing === 0,
      signals.privacyRowsMissing === 0
        ? "Privacy preferences resolve for every account."
        : `${signals.privacyRowsMissing} account(s) fall back to defaults.`,
      "needs_review",
    ),
  ];
}

/* ------------------------------------------------------------------ *
 * Data rights
 * ------------------------------------------------------------------ */

export type DataRightsSummary = {
  deletionRequests: number | null;
  deletionNote: string;
  exportRequestsPending: number;
  exportRequestsTotal: number;
  exportFailed: number;
  aiDeletionRequests: number;
  aiOptOuts: number;
  status: ComplianceStatus;
};

export function dataRightsStatus(input: {
  exportRequestsPending: number;
  exportFailed: number;
  aiDeletionRequests: number;
}): ComplianceStatus {
  if (input.exportFailed > 0) return "action_required";
  if (input.exportRequestsPending > 0 || input.aiDeletionRequests > 0) return "needs_review";
  return "implemented";
}

/** Overall readiness = the most severe section status. */
export function worstStatus(statuses: ComplianceStatus[]): ComplianceStatus {
  const order: ComplianceStatus[] = [
    "action_required",
    "legal_review_required",
    "needs_review",
    "implemented",
  ];
  for (const s of order) if (statuses.includes(s)) return s;
  return "implemented";
}
