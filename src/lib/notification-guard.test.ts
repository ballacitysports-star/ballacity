import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_NOTIFICATION_TYPES,
  appPathOf,
  guardNotificationForOther,
} from "./notification-guard";

/**
 * A notification the app writes for another member keeps the types, in-app links and lengths the app's own screens use, and
 * nothing else: no safety-looking type, no link to another site.
 */
describe("appPathOf", () => {
  it("keeps in-app paths under /games/, /messages/ and /players", () => {
    expect(appPathOf("/games/g1")).toBe("/games/g1");
    expect(appPathOf("/games/g1/pay?invite=1&from=u")).toBe("/games/g1/pay?invite=1&from=u");
    expect(appPathOf("/messages/c1")).toBe("/messages/c1");
    expect(appPathOf("/players?post=p1")).toBe("/players?post=p1");
    expect(appPathOf("https://ballacity.lovable.app/games/g1")).toBe("/games/g1");
    expect(appPathOf("https://id-preview--x.lovable.app/players?tab=mine")).toBe(
      "/players?tab=mine",
    );
    expect(appPathOf("http://localhost:8080/games/g1")).toBe("/games/g1");
  });

  it("refuses other sites, schemes and tricks", () => {
    for (const bad of [
      "https://evil.example/games/g1",
      "http://ballacity.lovable.app/games/g1",
      "//evil.example/games/g1",
      "javascript:alert(1)",
      "data:text/html,hi",
      "/\\evil.example",
      "/games/../settings",
      "/games//evil.example",
      "games/g1",
      "/settings",
      "/auth?next=https://evil.example",
      "/games/g1 onclick",
      "/games/g1\u0000x",
      "/games/g1\u007f",
      `/games/${"x".repeat(400)}`,
    ]) {
      expect(appPathOf(bad), bad).toBeNull();
    }
    expect(appPathOf(null)).toBeNull();
    expect(appPathOf("")).toBeNull();
  });
});

describe("guardNotificationForOther", () => {
  it("passes what the app's screens send, trimmed and cut to length", () => {
    const r = guardNotificationForOther({
      type: "payment_reminder",
      title: `  ${"T".repeat(200)}  `,
      body: "  Pay before Thursday  ",
      link: "/games/g1/pay",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.title).toHaveLength(120);
    expect(r.value.body).toBe("Pay before Thursday");
    expect(r.value.link).toBe("/games/g1/pay");
  });

  it("allows no link", () => {
    expect(guardNotificationForOther({ type: "message", title: "Hi", link: null })).toEqual({
      ok: true,
      value: { type: "message", title: "Hi", body: null, link: null },
    });
  });

  it("refuses safety, account, marketing and invitation types", () => {
    for (const type of [
      "safety_alert",
      "account_suspended",
      "account_warning",
      "moderation",
      "security_notice",
      "guardian_approval_needed",
      "marketing",
      "announcement",
      "game_invite",
      "availability_reconfirm",
    ]) {
      expect(guardNotificationForOther({ type, title: "x" }), type).toEqual({
        ok: false,
        code: "NOTIFICATION_TYPE_NOT_ALLOWED",
      });
    }
  });

  it("refuses a link outside the app", () => {
    expect(
      guardNotificationForOther({
        type: "message",
        title: "x",
        link: "https://evil.example/login",
      }),
    ).toEqual({ ok: false, code: "NOTIFICATION_LINK_NOT_ALLOWED" });
  });

  it("every allowed type is one a screen actually sends (no safety category among them)", () => {
    for (const t of CLIENT_NOTIFICATION_TYPES) {
      expect(t).not.toMatch(/^(safety|security|account_|moderation|report|marketing|announcement)/);
    }
  });
});

/** Every createNotification call in the app, as { file, type expression, link expression }. */
function callSites() {
  const out: { file: string; type: string; link: string | null }[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const src = readFileSync(p, "utf8");
        for (const m of src.matchAll(/createNotification\(\{([\s\S]*?)\n\s*\}\)/g)) {
          const obj = `${m[1]}\n`;
          const type = /\btype:\s*([^\n]+?),?\n/.exec(obj)?.[1] ?? "";
          const link = /\blink:\s*([^\n]+?),?\n/.exec(obj)?.[1] ?? null;
          out.push({ file: p, type, link });
        }
      }
    }
  };
  walk(join(__dirname, ".."));
  return out;
}

describe("the app's call sites stay inside the guard", () => {
  const sites = callSites();
  // the string literals a type expression can produce (not the ones it compares against)
  const literals = (expr: string) =>
    [...expr.replace(/[!=]==\s*"[^"]*"/g, "").matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);

  it("finds the call sites", () => {
    expect(sites.length).toBeGreaterThanOrEqual(20);
  });

  it("every type a call site sends is allowed", () => {
    for (const s of sites) {
      // RosterPlayerRow passes a typed variable whose union is payment_verified | payment_rejected
      if (s.type === "notifyType") continue;
      const types = literals(s.type);
      expect(types.length, `${s.file}: ${s.type}`).toBeGreaterThan(0);
      for (const t of types) expect(CLIENT_NOTIFICATION_TYPES.has(t), `${s.file}: ${t}`).toBe(true);
    }
  });

  it("every link a call site sends is an allowed in-app path", () => {
    for (const s of sites) {
      expect(s.link, `${s.file}: no link`).not.toBeNull();
      for (const m of s.link!.matchAll(/`([^`]*)`/g)) {
        const sample = m[1].replace(/\$\{[^}]+\}/g, "x1");
        expect(appPathOf(sample), `${s.file}: ${m[1]}`).not.toBeNull();
      }
    }
  });
});
