import { describe, expect, it } from "vitest";
import {
  ALL_EXPORT_CATEGORIES,
  EXPORT_CATEGORIES,
  EXPORT_DAILY_LIMIT,
  EXPORT_EXCLUSIONS,
  EXPORT_STATUS_META,
  EXPORT_TTL_HOURS,
  effectiveExportStatus,
  exportCategoryLabel,
  formatBytes,
  isExportExpired,
} from "@/lib/data-export";
import { RETAINED_AFTER_DELETION, RETENTION_RULES, retentionRule } from "@/lib/retention";

describe("data export categories", () => {
  it("has a unique id and copy for every category", () => {
    const ids = EXPORT_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of EXPORT_CATEGORIES) {
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(10);
    }
  });

  it("covers the required export areas", () => {
    for (const id of [
      "profile",
      "games_created",
      "games_joined",
      "reviews",
      "media_metadata",
      "preferences",
    ] as const) {
      expect(ALL_EXPORT_CATEGORIES).toContain(id);
    }
  });

  it("labels unknown ids without throwing", () => {
    expect(exportCategoryLabel("profile")).toBe("Profile information");
    expect(exportCategoryLabel("nope")).toBe("nope");
  });

  it("documents the sensitive exclusions", () => {
    const all = EXPORT_EXCLUSIONS.join(" ").toLowerCase();
    expect(all).toContain("password");
    expect(all).toContain("token");
    expect(all).toContain("other members'");
    expect(all).toContain("admin");
  });

  it("keeps limits conservative", () => {
    expect(EXPORT_DAILY_LIMIT).toBe(3);
    expect(EXPORT_TTL_HOURS).toBeLessThanOrEqual(48);
  });
});

describe("export status", () => {
  it("describes every status", () => {
    for (const s of ["requested", "processing", "ready", "expired", "failed"] as const) {
      expect(EXPORT_STATUS_META[s].label.length).toBeGreaterThan(0);
    }
  });

  it("treats a lapsed ready export as expired", () => {
    const now = new Date("2026-01-02T00:00:00Z");
    expect(isExportExpired({ status: "ready", expires_at: "2026-01-01T00:00:00Z" }, now)).toBe(
      true,
    );
    expect(
      effectiveExportStatus({ status: "ready", expires_at: "2026-01-01T00:00:00Z" }, now),
    ).toBe("expired");
    expect(
      effectiveExportStatus({ status: "ready", expires_at: "2026-01-03T00:00:00Z" }, now),
    ).toBe("ready");
  });

  it("never marks a failed export as expired", () => {
    expect(
      isExportExpired(
        { status: "failed", expires_at: "2020-01-01T00:00:00Z" },
        new Date("2026-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });

  it("formats sizes", () => {
    expect(formatBytes(null)).toBe("—");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("retention rules", () => {
  it("documents every required category", () => {
    for (const c of [
      "account",
      "messages",
      "reports",
      "media",
      "ai_analysis",
      "logs",
      "payments",
    ] as const) {
      const rule = retentionRule(c);
      expect(rule.retention.length).toBeGreaterThan(5);
      expect(rule.onAccountDeletion.length).toBeGreaterThan(5);
      expect(rule.sources.length).toBeGreaterThan(0);
    }
  });

  it("explains why anything survives account deletion", () => {
    expect(RETAINED_AFTER_DELETION.length).toBeGreaterThan(0);
    for (const rule of RETAINED_AFTER_DELETION) {
      expect(rule.reason.length).toBeGreaterThan(10);
    }
  });

  it("does not retain profile or AI data after deletion", () => {
    expect(retentionRule("account").survivesDeletion).toBe(false);
    expect(retentionRule("ai_analysis").survivesDeletion).toBe(false);
    expect(retentionRule("media").survivesDeletion).toBe(false);
  });

  it("has unique categories", () => {
    const ids = RETENTION_RULES.map((r) => r.category);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
