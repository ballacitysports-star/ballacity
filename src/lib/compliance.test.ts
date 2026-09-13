import { describe, expect, it, vi } from "vitest";
import {
  assertComplianceAdmin,
  COMPLIANCE_DISCLAIMER,
  COMPLIANCE_LEGAL_TYPES,
  consentSummary,
  dataRightsStatus,
  legalDocumentStatus,
  safetyStatus,
  securityAudit,
  worstStatus,
} from "@/lib/compliance";

function rpcClient(roles: { admin?: boolean; superadmin?: boolean; error?: string }) {
  return {
    rpc: vi.fn(async (fn: string) => {
      if (roles.error) return { data: null, error: { message: roles.error } };
      if (fn === "has_role") return { data: !!roles.admin, error: null };
      if (fn === "is_superadmin") return { data: !!roles.superadmin, error: null };
      return { data: null, error: null };
    }),
  };
}

describe("compliance authorization", () => {
  it("allows admins", async () => {
    await expect(assertComplianceAdmin(rpcClient({ admin: true }), "u1")).resolves.toBeUndefined();
  });

  it("allows superadmins", async () => {
    await expect(
      assertComplianceAdmin(rpcClient({ superadmin: true }), "u1"),
    ).resolves.toBeUndefined();
  });

  it("rejects ordinary members", async () => {
    await expect(assertComplianceAdmin(rpcClient({}), "u1")).rejects.toThrow(
      /Admin access required/,
    );
  });

  it("rejects moderators without admin role", async () => {
    const client = {
      rpc: vi.fn(async (_fn: string, args: Record<string, unknown>) => ({
        data: args["_role"] === "moderator",
        error: null,
      })),
    };
    await expect(assertComplianceAdmin(client, "u1")).rejects.toThrow(/Admin access required/);
  });

  it("surfaces role-check errors instead of granting access", async () => {
    await expect(assertComplianceAdmin(rpcClient({ error: "boom" }), "u1")).rejects.toThrow(/boom/);
  });
});

describe("legal document readiness", () => {
  const live = {
    document_type: "terms",
    version: "2.0",
    published: true,
    published_at: "2026-01-02T00:00:00Z",
    effective_date: "2026-01-10",
    requires_reacceptance: true,
  };

  it("covers all seven required document slots", () => {
    expect(COMPLIANCE_LEGAL_TYPES).toEqual([
      "terms",
      "privacy",
      "community_guidelines",
      "safety_guidelines",
      "payment_policy",
      "ai_disclosure",
      "youth_policy",
    ]);
  });

  it("flags a missing published version as action required", () => {
    const row = legalDocumentStatus({ type: "youth_policy", live: null, hasDraft: false });
    expect(row.status).toBe("action_required");
    expect(row.version).toBeNull();
  });

  it("flags outstanding re-acceptance as needs review", () => {
    const row = legalDocumentStatus({
      type: "terms",
      live,
      hasDraft: false,
      pendingReacceptance: 4,
    });
    expect(row.status).toBe("needs_review");
    expect(row.note).toContain("4 accounts");
  });

  it("flags an unpublished draft as legal review required", () => {
    const row = legalDocumentStatus({
      type: "terms",
      live: { ...live, requires_reacceptance: false },
      hasDraft: true,
    });
    expect(row.status).toBe("legal_review_required");
  });

  it("reports implemented when live and fully accepted", () => {
    const row = legalDocumentStatus({
      type: "terms",
      live,
      hasDraft: false,
      pendingReacceptance: 0,
    });
    expect(row.status).toBe("implemented");
    expect(row.effectiveDate).toBe("2026-01-10");
  });
});

describe("consent summary", () => {
  it("derives pending acceptance from the worst document", () => {
    const s = consentSummary({
      totalUsers: 10,
      termsVersion: "1.0",
      termsAccepted: 9,
      privacyVersion: "1.0",
      privacyAccepted: 6,
    });
    expect(s.pendingAcceptance).toBe(4);
    expect(s.status).toBe("needs_review");
  });

  it("requires action when a consent document is unpublished", () => {
    expect(
      consentSummary({
        totalUsers: 3,
        termsVersion: null,
        termsAccepted: 0,
        privacyVersion: "1.0",
        privacyAccepted: 3,
      }).status,
    ).toBe("action_required");
  });
});

describe("safety and data rights", () => {
  it("escalated reports demand action", () => {
    expect(safetyStatus({ openReports: 0, investigatingReports: 0, escalatedReports: 1 })).toBe(
      "action_required",
    );
    expect(safetyStatus({ openReports: 2, investigatingReports: 0, escalatedReports: 0 })).toBe(
      "needs_review",
    );
    expect(safetyStatus({ openReports: 0, investigatingReports: 0, escalatedReports: 0 })).toBe(
      "implemented",
    );
  });

  it("failed exports demand action", () => {
    expect(
      dataRightsStatus({ exportRequestsPending: 0, exportFailed: 1, aiDeletionRequests: 0 }),
    ).toBe("action_required");
    expect(
      dataRightsStatus({ exportRequestsPending: 1, exportFailed: 0, aiDeletionRequests: 0 }),
    ).toBe("needs_review");
    expect(
      dataRightsStatus({ exportRequestsPending: 0, exportFailed: 0, aiDeletionRequests: 0 }),
    ).toBe("implemented");
  });
});

describe("security audit", () => {
  const clean = {
    tablesWithoutRls: 0,
    publicWritableBuckets: 0,
    adminRoleRows: 2,
    unsignedMediaBuckets: 0,
    privacyRowsMissing: 0,
  };

  it("stays at needs review until a human review is recorded", () => {
    const rows = securityAudit(clean);
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.status === "needs_review")).toBe(true);
  });

  it("reports implemented once reviewed", () => {
    const rows = securityAudit({ ...clean, lastReviewedAt: "2026-02-01T00:00:00Z" });
    expect(rows.every((r) => r.status === "implemented")).toBe(true);
  });

  it("escalates broken controls", () => {
    const rows = securityAudit({
      ...clean,
      tablesWithoutRls: 2,
      unsignedMediaBuckets: 1,
      adminRoleRows: 0,
      privacyRowsMissing: 3,
      lastReviewedAt: "2026-02-01T00:00:00Z",
    });
    const byArea = Object.fromEntries(rows.map((r) => [r.area, r.status]));
    expect(byArea["rls"]).toBe("action_required");
    expect(byArea["private_media"]).toBe("action_required");
    expect(byArea["admin_authorization"]).toBe("action_required");
    expect(byArea["sensitive_data_access"]).toBe("needs_review");
  });
});

describe("overall status", () => {
  it("takes the most severe status", () => {
    expect(worstStatus(["implemented", "needs_review", "action_required"])).toBe("action_required");
    expect(worstStatus(["implemented", "legal_review_required"])).toBe("legal_review_required");
    expect(worstStatus(["implemented"])).toBe("implemented");
  });

  it("never claims legal compliance", () => {
    expect(COMPLIANCE_DISCLAIMER).not.toMatch(/legally compliant/i);
    expect(COMPLIANCE_DISCLAIMER).toMatch(/not a legal opinion/i);
  });
});
