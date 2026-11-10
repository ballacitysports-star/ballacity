import { describe, expect, it } from "vitest";
import { isRedirect } from "@tanstack/react-router";
import { MANAGE_TABS, isManageTab, validateManageSearch } from "./team-manage-tabs";
import { Route as InvitesRoute } from "@/routes/teams.$teamId.invites";
import { Route as WaiverRoute } from "@/routes/teams.$teamId.waiver";

describe("Manage page tabs", () => {
  it("keeps a known tab in the URL and drops the default or anything unknown", () => {
    expect(validateManageSearch({ tab: "waiver" })).toEqual({ tab: "waiver" });
    expect(validateManageSearch({ tab: "invites" })).toEqual({ tab: "invites" });
    expect(validateManageSearch({ tab: "dashboard" })).toEqual({});
    expect(validateManageSearch({ tab: "../admin" })).toEqual({});
    expect(validateManageSearch({})).toEqual({});
  });

  it("has a tab for each page the redirects point at", () => {
    expect(isManageTab("invites")).toBe(true);
    expect(isManageTab("waiver")).toBe(true);
    expect(MANAGE_TABS).toContain("roster");
  });

  it("matches the tabs the Manage page renders", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/routes/teams.$teamId.manage.tsx", "utf8");
    const rendered = [...src.matchAll(/<TabsTrigger value="([a-z]+)">/g)].map((m) => m[1]);
    expect(rendered).toEqual([...MANAGE_TABS]);
  });
});

describe("standalone manager pages redirect into Manage (P2-8)", () => {
  const thrown = (route: { options: { beforeLoad?: unknown } }) => {
    const beforeLoad = route.options.beforeLoad as (ctx: unknown) => unknown;
    try {
      beforeLoad({ params: { teamId: "team-123" } });
    } catch (e) {
      return e;
    }
    throw new Error("expected a redirect");
  };

  for (const [name, route, tab] of [
    ["invites", InvitesRoute, "invites"],
    ["waiver", WaiverRoute, "waiver"],
  ] as const) {
    it(`/teams/$teamId/${name} → /teams/$teamId/manage?tab=${tab}`, () => {
      const r = thrown(route as never);
      expect(isRedirect(r)).toBe(true);
      const opts = (r as { options: Record<string, unknown> }).options;
      expect(opts.to).toBe("/teams/$teamId/manage");
      expect(opts.params).toEqual({ teamId: "team-123" });
      expect(opts.search).toEqual({ tab });
      expect(opts.replace).toBe(true);
    });
  }
});
