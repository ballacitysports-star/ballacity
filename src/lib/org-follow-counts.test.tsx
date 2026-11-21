// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";

const store = vi.hoisted(() => ({ orgs: [] as { id: string }[] }));
vi.mock("@/lib/org-store", () => ({ useAllOrgs: () => store.orgs }));
const calls = vi.hoisted(() => [] as { kind: string; ids: string[] }[]);
vi.mock("@/lib/entity-follows", () => ({
  useEntityFollowCounts: (kind: string, ids: string[]) => {
    calls.push({ kind, ids });
    return new Map([["busy", { followers: 9, following: false }]]);
  },
}));

import { followersDesc, useOrgFollowCounts } from "./org-follow-counts";

afterEach(() => {
  cleanup();
  calls.length = 0;
});

describe("useOrgFollowCounts", () => {
  it("asks for every team and trainer in the store, as team entities", () => {
    store.orgs = [{ id: "t1" }, { id: "c1" }, { id: "busy" }];
    const { result } = renderHook(() => useOrgFollowCounts());
    expect(calls.at(-1)).toEqual({ kind: "team", ids: ["t1", "c1", "busy"] });
    expect(result.current?.get("busy")?.followers).toBe(9);
  });
});

describe("followersDesc", () => {
  const counts = new Map([
    ["a", { followers: 3, following: false }],
    ["b", { followers: 7, following: true }],
  ]);

  it("puts the most followed first", () => {
    expect(["a", "b"].sort((x, y) => followersDesc(counts, x, y))).toEqual(["b", "a"]);
  });

  it("reads a count not known yet (or no counts at all) as 0, leaving the tie to the caller", () => {
    expect(followersDesc(counts, "unknown", "a")).toBe(3);
    expect(followersDesc(null, "a", "b")).toBe(0);
  });
});

describe("the /teams and /trainers lists (P1-1)", () => {
  for (const file of ["src/routes/_tabs.teams.tsx", "src/routes/_tabs.trainers.tsx"]) {
    it(`${file} shows real counts and sorts "Most followers" by them`, () => {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("useOrgFollowCounts()");
      expect(src).toContain("followers={followCounts?.get(o.id)?.followers}");
      expect(src).toContain("followersDesc(followCounts, a.o.id, b.o.id)");
      // teams.followers is not maintained (entity follows live in entity_follows).
      expect(src).not.toMatch(/\bo\.followers\b/);
    });
  }
});
