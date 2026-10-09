import { describe, expect, it } from "vitest";
import { matchesOrgQuery } from "./org-search";

const org = {
  name: "BallaCity 14U",
  handle: "@balacity14",
  tagline: "Travel ball",
  city: "Atlanta, GA",
  sports: ["Baseball"],
};

describe("matchesOrgQuery", () => {
  it("matches everything for a blank query", () => {
    expect(matchesOrgQuery(org, "  ")).toBe(true);
  });

  it("matches name, city and sport case-insensitively", () => {
    expect(matchesOrgQuery(org, "balacity")).toBe(true);
    expect(matchesOrgQuery(org, "ATLANTA")).toBe(true);
    expect(matchesOrgQuery(org, "baseball")).toBe(true);
  });

  it("rejects unrelated text", () => {
    expect(matchesOrgQuery(org, "pickleball")).toBe(false);
  });
});
