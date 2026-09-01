import { describe, it, expect, vi } from "vitest";
import { sanitizeAuditValue, logAdminAction } from "./audit-log.server";
import {
  AUDIT_ACTIONS,
  auditActionCategory,
  auditActionLabel,
  auditActionsInCategory,
  auditTargetLabel,
} from "./audit-actions";

describe("sanitizeAuditValue", () => {
  it("redacts credential-shaped keys at any depth", () => {
    const out = sanitizeAuditValue({
      email: "a@b.com",
      password: "hunter2",
      nested: { access_token: "abc", apiKey: "k", card_number: "4111", ok: 1 },
    }) as any;
    expect(out.email).toBe("a@b.com");
    expect(out.password).toBe("[redacted]");
    expect(out.nested.access_token).toBe("[redacted]");
    expect(out.nested.apiKey).toBe("[redacted]");
    expect(out.nested.card_number).toBe("[redacted]");
    expect(out.nested.ok).toBe(1);
  });

  it("truncates very long strings and caps arrays", () => {
    const long = sanitizeAuditValue("x".repeat(5000)) as string;
    expect(long.endsWith("[truncated]")).toBe(true);
    const arr = sanitizeAuditValue(Array.from({ length: 100 }, (_, i) => i)) as number[];
    expect(arr.length).toBe(40);
  });

  it("normalises nullish values and dates", () => {
    expect(sanitizeAuditValue(undefined)).toBeNull();
    const iso = sanitizeAuditValue(new Date("2026-01-02T03:04:05.000Z"));
    expect(iso).toBe("2026-01-02T03:04:05.000Z");
  });
});

function fakeAdmin(error: { message: string } | null = null) {
  const insert = vi.fn(async () => ({ error }));
  return { client: { from: vi.fn(() => ({ insert })) }, insert };
}

describe("logAdminAction", () => {
  it("writes a sanitized append-only row", async () => {
    const { client, insert } = fakeAdmin();
    const res = await logAdminAction(client as never, "actor-1", {
      action: "user.suspend",
      targetType: "user",
      targetId: "u1",
      reason: "spam",
      before: { suspended_at: null },
      after: { suspended_at: "now", token: "secret" },
      metadata: { source: "admin_ui" },
    });
    expect(res.logged).toBe(true);
    expect(client.from).toHaveBeenCalledWith("admin_audit_log");
    const row = (insert.mock.calls as any[])[0][0] as any;
    expect(row.actor_id).toBe("actor-1");
    expect(row.action).toBe("user.suspend");
    expect(row.after.token).toBe("[redacted]");
    expect(row.metadata).toEqual({ source: "admin_ui" });
  });

  it("never throws when the write fails", async () => {
    const { client } = fakeAdmin({ message: "denied" });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      logAdminAction(client as never, null, { action: "report.resolve", targetType: "report" }),
    ).resolves.toEqual({ logged: false });
  });
});

describe("audit action catalog", () => {
  it("labels known and unknown actions", () => {
    expect(auditActionLabel("legal.publish")).toBe("Legal document published");
    expect(auditActionLabel("something.new")).toBe("something.new");
    expect(auditActionCategory("role.grant")).toBe("permissions");
    expect(auditActionCategory("nope")).toBeNull();
  });

  it("keeps legacy moderation keys readable", () => {
    expect(auditActionLabel("moderation_suspend")).toBe("User suspended");
    expect(auditActionLabel("report_status_resolved")).toBe("Report resolved");
  });

  it("groups actions by category and labels targets", () => {
    expect(auditActionsInCategory("legal")).toContain("legal.unpublish");
    expect(auditTargetLabel("legal_document")).toBe("Legal document");
    expect(auditTargetLabel("weird")).toBe("weird");
    expect(Object.keys(AUDIT_ACTIONS).length).toBeGreaterThan(20);
  });
});
