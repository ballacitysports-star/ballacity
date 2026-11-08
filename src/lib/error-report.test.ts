// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  MESSAGE_MAX,
  buildErrorReport,
  fingerprintOf,
  groupErrorRows,
  isIgnorableError,
  scrubMessage,
  scrubRoute,
} from "./error-report";
import { REPORTS_PER_MINUTE, allowReport, saveErrorReport } from "./error-report.server";
import {
  MAX_PER_PAGE,
  reportBrowserError,
  resetBrowserErrorReporting,
} from "./error-report-client";

describe("scrubbing (P0-8: no personal data)", () => {
  it("removes emails, tokens, ids, long numbers and URL query strings", () => {
    const out = scrubMessage(
      "Failed for jane.doe@example.com id 3f2b1c4d-1111-2222-3333-444455556666 phone 5551234567 " +
        "token=abc.def.ghi eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl " +
        "at https://x.supabase.co/rest/v1/profiles?id=eq.42&select=* and deadbeefdeadbeefdeadbeefdeadbeef",
    );
    expect(out).not.toMatch(/jane|example\.com/);
    expect(out).not.toMatch(/3f2b1c4d/);
    expect(out).not.toMatch(/5551234567/);
    expect(out).not.toMatch(/eyJhbGci/);
    expect(out).not.toMatch(/abc\.def\.ghi/);
    expect(out).not.toMatch(/\?id=eq/);
    expect(out).not.toMatch(/deadbeef/);
    expect(out).toContain("[email]");
    expect(out).toContain("https://x.supabase.co/rest/v1/profiles");
  });

  it("caps the message and never sends an empty one", () => {
    expect(scrubMessage("x".repeat(2000)).length).toBe(MESSAGE_MAX);
    expect(scrubMessage("   ")).toBe("Unknown error");
  });

  it("keeps the path only, with ids masked", () => {
    expect(
      scrubRoute(
        "https://ballacity.lovable.app/games/3f2b1c4d-1111-2222-3333-444455556666?tab=chat#x",
      ),
    ).toBe("/games/:id");
    expect(scrubRoute("/players/12345/reviews")).toBe("/players/:id/reviews");
    expect(scrubRoute("/u/jane@example.com")).toBe("/u/:id");
    expect(scrubRoute("/feed")).toBe("/feed");
    expect(scrubRoute(null)).toBeNull();
    // Stateless across calls (no regex lastIndex leaking between segments).
    expect(
      scrubRoute("/a/3f2b1c4d-1111-2222-3333-444455556666/b/3f2b1c4d-1111-2222-3333-444455556667"),
    ).toBe("/a/:id/b/:id");
  });

  it("groups the same error with a stable short fingerprint, ignoring numbers", () => {
    expect(fingerprintOf("Timeout after 300ms", "/feed")).toBe(
      fingerprintOf("Timeout after 900ms", "/feed"),
    );
    expect(fingerprintOf("A", "/feed")).not.toBe(fingerprintOf("B", "/feed"));
    expect(fingerprintOf("A", "/feed")).toMatch(/^[a-z0-9]{1,32}$/);
  });

  it("builds a report with no user id and only a signed-in flag", () => {
    const r = buildErrorReport({
      source: "client",
      kind: "boundary",
      error: new TypeError("x of jane@example.com is undefined"),
      route: "/games/42",
      signedIn: true,
    });
    expect(r).toEqual({
      source: "client",
      kind: "boundary",
      message: "TypeError: x of [email] is undefined",
      route: "/games/:id",
      fingerprint: expect.stringMatching(/^[a-z0-9]+$/),
      release: null,
      signedIn: true,
    });
    expect(Object.keys(r)).not.toContain("userId");
  });

  it("ignores aborts and opaque cross-origin script errors", () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isIgnorableError(abort)).toBe(true);
    expect(isIgnorableError("Script error.")).toBe(true);
    expect(isIgnorableError(new Error("ResizeObserver loop limit exceeded"))).toBe(true);
    expect(isIgnorableError(new TypeError("boom"))).toBe(false);
  });
});

describe("grouping for the superadmin view", () => {
  it("counts by fingerprint, most frequent first, with first and last seen", () => {
    const row = (f: string, at: string, signed = false, source = "client") => ({
      fingerprint: f,
      message: `m-${f}`,
      route: "/x",
      source,
      kind: "window",
      created_at: at,
      signed_in: signed,
    });
    const g = groupErrorRows([
      row("a", "2026-11-08T01:00:00Z"),
      row("b", "2026-11-08T03:00:00Z", true),
      row("a", "2026-11-08T02:00:00Z", true, "server"),
    ]);
    expect(g.map((x) => [x.fingerprint, x.count, x.signedInCount])).toEqual([
      ["a", 2, 1],
      ["b", 1, 1],
    ]);
    expect(g[0].sources).toEqual(["client", "server"]);
    expect([g[0].firstAt, g[0].lastAt]).toEqual(["2026-11-08T01:00:00Z", "2026-11-08T02:00:00Z"]);
  });
});

describe("saving on the server", () => {
  it("caps reports per minute per server instance", () => {
    const t = Date.now() + 10 * 60_000;
    let allowed = 0;
    for (let i = 0; i < REPORTS_PER_MINUTE + 5; i += 1) if (allowReport(t)) allowed += 1;
    expect(allowed).toBe(REPORTS_PER_MINUTE);
    expect(allowReport(t + 61_000)).toBe(true);
  });

  it("inserts only the scrubbed fields, and never throws", async () => {
    const rows: Record<string, unknown>[] = [];
    const ok = await saveErrorReport(
      buildErrorReport({ source: "server", kind: "ssr", error: new Error("x"), route: "/feed" }),
      { from: () => ({ insert: async (r) => (rows.push(r), { error: null }) }) },
    );
    expect(ok).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["fingerprint", "kind", "message", "release", "route", "signed_in", "source"].sort(),
    );
    const failed = await saveErrorReport(
      buildErrorReport({ source: "server", kind: "ssr", error: new Error("y"), route: "/feed" }),
      {
        from: () => {
          throw new Error("db down");
        },
      },
    );
    expect(failed).toBe(false);
  });
});

describe("browser reporting", () => {
  beforeEach(() => resetBrowserErrorReporting());

  it("sends each distinct error once and at most MAX_PER_PAGE per page", async () => {
    const send = vi.fn(async () => undefined);
    const sender = () => Promise.resolve(send);
    expect(reportBrowserError(new Error("same"), "window", sender)).toBe(true);
    expect(reportBrowserError(new Error("same"), "window", sender)).toBe(false);
    for (let i = 0; i < MAX_PER_PAGE + 5; i += 1)
      reportBrowserError(new Error(`e${"x".repeat(i)}`), "window", sender);
    await new Promise((r) => setTimeout(r, 0));
    expect(send).toHaveBeenCalledTimes(MAX_PER_PAGE);
  });

  it("skips ignorable errors and never throws when sending fails", async () => {
    const abort = new Error("a");
    abort.name = "AbortError";
    expect(reportBrowserError(abort, "rejection", () => Promise.reject(new Error("x")))).toBe(
      false,
    );
    expect(
      reportBrowserError(new Error("real"), "rejection", () =>
        Promise.reject(new Error("offline")),
      ),
    ).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
  });
});

describe("wiring", () => {
  it("the error boundary, the root and the server entry all report", () => {
    expect(readFileSync("src/components/GlobalErrorBoundary.tsx", "utf8")).toMatch(
      /reportBrowserError\(error, "boundary"\)/,
    );
    expect(readFileSync("src/routes/__root.tsx", "utf8")).toMatch(
      /installBrowserErrorReporting\(\)/,
    );
    const server = readFileSync("src/server.ts", "utf8");
    expect(server.match(/await reportServerError\(/g)?.length).toBe(2);
  });
});
