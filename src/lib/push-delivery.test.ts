import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  isDeliveryIssue,
  loadPushDeliveryIssues,
  type DeliveryIssue,
  type DeliveryLogReader,
} from "./push-delivery";

const NOW = Date.parse("2026-11-08T12:00:00Z");

/** A Supabase client stub that records the query and answers with `rows` as stored. */
function fakeClient(rows: (DeliveryIssue & { status: string; channel: string })[]) {
  const calls: [string, ...unknown[]][] = [];
  const q = {
    select: (...a: unknown[]) => (calls.push(["select", ...a]), q),
    eq: (...a: unknown[]) => (calls.push(["eq", ...a]), q),
    in: (...a: unknown[]) => (calls.push(["in", ...a]), q),
    or: (...a: unknown[]) => (calls.push(["or", ...a]), q),
    gte: (...a: unknown[]) => (calls.push(["gte", ...a]), q),
    order: (...a: unknown[]) => (calls.push(["order", ...a]), q),
    limit: (...a: unknown[]) => (calls.push(["limit", ...a]), q),
    then: (ok: (r: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok),
  };
  const client = {
    from: (table: string) => (calls.push(["from", table]), q),
  } as unknown as DeliveryLogReader;
  return { client, calls };
}

const row = (id: string, status: string, error: string | null) => ({
  id,
  created_at: "2026-11-08T11:00:00Z",
  error,
  notification_id: null,
  status,
  channel: "push",
});

describe("the Push delivery issue banner's rows (P2-7 review)", () => {
  it("leaves out pushes held for quiet hours or a settings check and expired ones; keeps failures and 'no subscribers'", async () => {
    const { client } = fakeClient([
      row("held", "skipped", "minor_notification_curfew"),
      row("held-check", "skipped", "curfew_check_failed"),
      row("expired", "skipped", "expired"),
      row("no-device", "skipped", "no_subscribers"),
      row("provider", "failed", "http_503"),
      row("lost", "failed", "queue_failed"),
      row("guardian", "skipped", "guardian_notifications_off"),
    ]);
    const issues = await loadPushDeliveryIssues(client, "u1", NOW);
    expect(issues.map((i) => i.id)).toEqual(["no-device", "provider", "lost", "guardian"]);
  });

  it("asks the database for the same rows, so held pushes cannot crowd failures out of the 10 it reads", async () => {
    const { client, calls } = fakeClient([]);
    await loadPushDeliveryIssues(client, "u1", NOW);
    expect(calls).toEqual([
      ["from", "notification_delivery_log"],
      ["select", "id, created_at, error, notification_id, status, channel"],
      ["eq", "user_id", "u1"],
      ["eq", "channel", "push"],
      ["in", "status", ["failed", "skipped"]],
      ["or", "error.is.null,error.not.in.(minor_notification_curfew,curfew_check_failed,expired)"],
      ["gte", "created_at", "2026-11-01T12:00:00.000Z"],
      ["order", "created_at", { ascending: false }],
      ["limit", 10],
    ]);
  });

  it("counts a failed push with no reason recorded", () => {
    expect(isDeliveryIssue({ error: null })).toBe(true);
    expect(isDeliveryIssue({ error: "minor_notification_curfew" })).toBe(false);
  });

  it("is what the notifications panel shows", () => {
    const panel = readFileSync("src/components/NotificationsPanel.tsx", "utf8");
    expect(panel).toMatch(
      /loadPushDeliveryIssues\(supabase as unknown as DeliveryLogReader, userId\)/,
    );
    expect(panel).not.toMatch(/from\("notification_delivery_log"/);
  });
});
