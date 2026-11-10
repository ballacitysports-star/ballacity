import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BUSINESS_CATEGORIES,
  ORG_CATEGORIES,
  categoriesForType,
  parseOrgType,
} from "@/lib/org-listing";

describe("business listings (P2-4)", () => {
  it("treats anything but 'business' as a venue", () => {
    expect(parseOrgType("business")).toBe("business");
    expect(parseOrgType("facility")).toBe("facility");
    expect(parseOrgType(null)).toBe("facility");
    expect(parseOrgType("restaurant")).toBe("facility");
  });

  it("offers each type its own categories, all within the 60-character limit", () => {
    expect(categoriesForType("facility")).toBe(ORG_CATEGORIES);
    expect(categoriesForType("business")).toBe(BUSINESS_CATEGORIES);
    for (const c of [...ORG_CATEGORIES, ...BUSINESS_CATEGORIES])
      expect(c.length).toBeLessThanOrEqual(60);
  });

  it("saves the type on create and edit, and the directory filters by it", () => {
    const fns = readFileSync("src/lib/trainer-orgs.functions.ts", "utf8");
    expect(fns).toMatch(/org_type: data\.orgType \?\? "facility"/);
    expect(fns).toMatch(/if \(data\.orgType !== undefined\) extra\.org_type = data\.orgType;/);
    expect(fns).toMatch(/if \(data\.type\) query = query\.eq\("org_type", data\.type\);/);
    expect(readFileSync("src/routes/orgs.create.tsx", "utf8")).toMatch(/orgType: value\.orgType/);
    expect(readFileSync("src/routes/orgs.$orgId.edit.tsx", "utf8")).toMatch(/orgType: v\.orgType/);
    const index = readFileSync("src/routes/orgs.index.tsx", "utf8");
    expect(index).toMatch(/s\.t === "facility" \|\| s\.t === "business"/);
    expect(index).toMatch(/type: search\.t/);
  });

  it("the live team and trainer lists carry the card actions (P2-5)", () => {
    expect(readFileSync("src/routes/_tabs.teams.tsx", "utf8")).toMatch(
      /<DiscoverCardActions org=\{o\} \/>/,
    );
    expect(readFileSync("src/routes/_tabs.trainers.tsx", "utf8")).toMatch(
      /<DiscoverCardActions org=\{o\} followOnly \/>/,
    );
  });
});
